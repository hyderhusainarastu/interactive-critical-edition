import { db, documents, passageAnnotations, processingRuns, works } from "@ice/db";
import { and, desc, eq, isNull } from "drizzle-orm";

/**
 * Owner-scoped reads over `passage_annotation`, aggregated ACROSS a
 * reader's works (Knowledge Map rebuild, spec §2.1/§2.3's first
 * genuinely-additive endpoint — `GET /api/passages/recent`). No existing
 * route aggregates this table across works — every current consumer is
 * scoped to one document's own reader (`getOwnedDocument()` + a
 * `document`-scoped query) — so this is a real, new, owner-scoped,
 * no-new-table read, per the charter §3 allowance the spec cites.
 *
 * Ownership is proved by joining `passage_annotation -> processing_run ->
 * document`, scoped to `document.user_id = <caller>` (mirrors the PATCH
 * route's own ownership chain at
 * `apps/web/src/app/api/works/[workId]/reader/passage-annotations/[annotationId]/route.ts`)
 * and `work.deleted_at IS NULL` (a trashed work's passages are not a valid
 * context to open, same as the work itself isn't — `getOwnedDocument`'s own
 * exclusion rule).
 */
export interface PassageContextRow {
  id: string;
  workId: string;
  workTitle: string;
  quote: string | null;
  summary: string;
  updatedAt: Date;
}

export async function listRecentPassageContexts(userId: string, limit = 20): Promise<PassageContextRow[]> {
  const cappedLimit = Math.min(50, Math.max(1, limit));
  return db
    .select({
      id: passageAnnotations.id,
      workId: works.id,
      workTitle: works.title,
      quote: passageAnnotations.quote,
      summary: passageAnnotations.summary,
      updatedAt: passageAnnotations.updatedAt,
    })
    .from(passageAnnotations)
    .innerJoin(processingRuns, eq(processingRuns.id, passageAnnotations.runId))
    .innerJoin(documents, eq(documents.id, processingRuns.documentId))
    .innerJoin(works, eq(works.id, documents.workId))
    .where(and(eq(documents.userId, userId), eq(passageAnnotations.hidden, false), isNull(works.deletedAt)))
    .orderBy(desc(passageAnnotations.updatedAt))
    .limit(cappedLimit);
}

/** By-id lookup (Knowledge Map URL-state reconstruction — a passage context
 *  id read back from the URL may be older than the "recent" window
 *  `listRecentPassageContexts` caps at). Same ownership chain as the list
 *  above; returns `null` (never a distinguishable 403) for anything the
 *  caller doesn't own. */
export async function getPassageContextById(userId: string, passageAnnotationId: string): Promise<PassageContextRow | null> {
  const [row] = await db
    .select({
      id: passageAnnotations.id,
      workId: works.id,
      workTitle: works.title,
      quote: passageAnnotations.quote,
      summary: passageAnnotations.summary,
      updatedAt: passageAnnotations.updatedAt,
    })
    .from(passageAnnotations)
    .innerJoin(processingRuns, eq(processingRuns.id, passageAnnotations.runId))
    .innerJoin(documents, eq(documents.id, processingRuns.documentId))
    .innerJoin(works, eq(works.id, documents.workId))
    .where(and(eq(passageAnnotations.id, passageAnnotationId), eq(documents.userId, userId), isNull(works.deletedAt)))
    .limit(1);
  return row ?? null;
}
