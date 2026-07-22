import {
  annotations,
  citationLibraryLinks,
  citations,
  db,
  graphEdges,
  learningResources,
  ragMessageCitations,
  readingRecords,
  roadmapOverrides,
  understandingRatings,
  workIdentities,
  works,
} from "@ice/db";
import type { ConsistencyRepair } from "@ice/consistency";
import { reportEvent } from "@ice/observability";
import { eq } from "drizzle-orm";

/**
 * Phase 20.7 — the DB side of `@ice/consistency`'s repair actions. Applies
 * every repair in ONE transaction (plan §20.7: "repair references
 * transactionally") so a partial repair pass can never leave the database in
 * a state worse than either the pre-repair or fully-repaired one — if any
 * single repair fails (a row disappeared between snapshot and apply, a
 * constraint rejects it), the whole batch rolls back and nothing is half
 * applied.
 *
 * Idempotent by construction for every repair kind the pure checks currently
 * emit:
 *  - `update` sets an id's column(s) to a value derived from that id's own
 *    real FK target — applying the identical patch twice leaves the row in
 *    the same state both times, no different the second time;
 *  - `delete` matches by primary key — deleting an already-deleted (or
 *    never-existed) id affects zero rows rather than erroring;
 *  - `insert` is the one kind that is NOT naturally idempotent as a bare
 *    INSERT (a repeat would violate `citation_library_link`'s unique
 *    `citation_id` constraint) — handled with `onConflictDoNothing` on that
 *    exact unique column, so re-applying an already-applied insert repair is
 *    a no-op rather than a constraint violation.
 *
 * Every applied repair is also logged via `reportEvent` (`@ice/observability`)
 * as the reconciliation-provenance record plan §20.7 requires ("record
 * merge/reconciliation provenance") — no new table exists for this (out of
 * this task's migration scope), so the structured operational-event log is
 * the audit trail, same precedent as every other cost/error event in this
 * codebase.
 */

type RepairTable =
  | "citation_library_link"
  | "learning_resource"
  | "work"
  | "annotation"
  | "roadmap_override"
  | "reading_record"
  | "understanding_rating"
  | "citation"
  | "graph_edge"
  | "rag_message_citation"
  | "work_identity";

const KNOWN_TABLES = new Set<RepairTable>([
  "citation_library_link", "learning_resource", "work", "annotation",
  "roadmap_override", "reading_record", "understanding_rating", "citation",
  "graph_edge", "rag_message_citation", "work_identity",
]);

export interface ApplyResult {
  /** Count of repairs actually executed against the database. */
  applied: number;
  /** Repairs this applier declined to run, each with why — never silently dropped. */
  skipped: Array<{ repair: ConsistencyRepair; reason: string }>;
}

/** Applies every repair in `repairs` inside one transaction. Repairs
 *  targeting a table/kind this applier doesn't yet handle are skipped (never
 *  thrown away silently — reported back in `skipped`) rather than attempted
 *  against an unknown shape. */
export async function applyConsistencyRepairs(repairs: ConsistencyRepair[]): Promise<ApplyResult> {
  const skipped: ApplyResult["skipped"] = [];
  let applied = 0;

  const runnable = repairs.filter((r) => {
    if (KNOWN_TABLES.has(r.table as RepairTable)) return true;
    skipped.push({ repair: r, reason: `Unrecognized repair table "${r.table}"` });
    return false;
  });

  if (runnable.length === 0) return { applied: 0, skipped };

  await db.transaction(async (tx) => {
    for (const repair of runnable) {
      const table = repair.table as RepairTable;
      let handled = false;

      if (repair.kind === "update") {
        switch (table) {
          case "citation_library_link":
            await tx.update(citationLibraryLinks).set(repair.patch as Partial<typeof citationLibraryLinks.$inferInsert>).where(eq(citationLibraryLinks.id, repair.id));
            handled = true;
            break;
          case "learning_resource":
            await tx.update(learningResources).set(repair.patch as Partial<typeof learningResources.$inferInsert>).where(eq(learningResources.id, repair.id));
            handled = true;
            break;
          case "work":
            await tx.update(works).set(repair.patch as Partial<typeof works.$inferInsert>).where(eq(works.id, repair.id));
            handled = true;
            break;
          case "annotation":
            await tx.update(annotations).set(repair.patch as Partial<typeof annotations.$inferInsert>).where(eq(annotations.id, repair.id));
            handled = true;
            break;
          case "roadmap_override":
            await tx.update(roadmapOverrides).set(repair.patch as Partial<typeof roadmapOverrides.$inferInsert>).where(eq(roadmapOverrides.id, repair.id));
            handled = true;
            break;
          case "reading_record":
            await tx.update(readingRecords).set(repair.patch as Partial<typeof readingRecords.$inferInsert>).where(eq(readingRecords.id, repair.id));
            handled = true;
            break;
          case "understanding_rating":
            await tx.update(understandingRatings).set(repair.patch as Partial<typeof understandingRatings.$inferInsert>).where(eq(understandingRatings.id, repair.id));
            handled = true;
            break;
          case "citation":
            await tx.update(citations).set(repair.patch as Partial<typeof citations.$inferInsert>).where(eq(citations.id, repair.id));
            handled = true;
            break;
          case "work_identity":
            await tx.update(workIdentities).set(repair.patch as Partial<typeof workIdentities.$inferInsert>).where(eq(workIdentities.id, repair.id));
            handled = true;
            break;
          default:
            // graph_edge/rag_message_citation currently only ever emit
            // "delete" repairs — an "update" for either would be new
            // behavior this applier doesn't recognize yet.
            break;
        }
      } else if (repair.kind === "delete") {
        switch (table) {
          case "graph_edge":
            await tx.delete(graphEdges).where(eq(graphEdges.id, repair.id));
            handled = true;
            break;
          case "rag_message_citation":
            await tx.delete(ragMessageCitations).where(eq(ragMessageCitations.id, repair.id));
            handled = true;
            break;
          default:
            break;
        }
      } else if (repair.kind === "insert") {
        switch (table) {
          case "citation_library_link":
            await tx
              .insert(citationLibraryLinks)
              .values(repair.values as typeof citationLibraryLinks.$inferInsert)
              .onConflictDoNothing({ target: citationLibraryLinks.citationId });
            handled = true;
            break;
          default:
            break;
        }
      }

      if (!handled) {
        skipped.push({ repair, reason: `No ${repair.kind} handler wired for table "${table}" yet` });
        continue;
      }

      applied++;
      reportEvent("consistency.repair_applied", {
        kind: repair.kind,
        table: repair.table,
        entityId: repair.kind === "insert" ? undefined : repair.id,
        reason: repair.reason,
      });
    }
  });

  return { applied, skipped };
}
