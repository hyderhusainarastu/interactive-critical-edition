import { db, enqueueImportResearchCorpus, researchCorpusItems, researchJobRequests, researchProjectMembers } from "@ice/db";
import type { CorpusProvider } from "@ice/research";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getOwnedResearchProject } from "./projects";

/**
 * The Corpus surface (plan §route-map `/research/[projectId]/corpus`, Phase
 * 30 fix lane — 28.1 built projects/claims and 28.2 built the worker/service
 * side of corpus import, but the page itself was never built). Two
 * responsibilities:
 *
 *  - `listCorpusItemsForProject` — read the `research_corpus_item` rows
 *    already linked into this project as `research_project_member` rows
 *    (`memberType = "corpus_item"`), the same join `listResearchProjectMembers`
 *    (projects.ts) does but widened to the corpus item's own display columns.
 *  - `dispatchImportCorpusJob` — enqueue an `import_corpus` job scoped to a
 *    batch of `{provider, externalId}` picks from a real, honest provider
 *    search (`/api/research/corpus/search`, backed by `searchCorpusCandidates`).
 *    Zero AI cost (the `dispatchScanMonitorJob` precedent in `monitors.ts`):
 *    every step is a real network metadata lookup or a plain DB write, so
 *    this bypasses `planResearchJob` entirely rather than mis-typing it — that
 *    helper's own `ResearchJobType` union (`claim_extraction` |
 *    `judge_scan` | `cluster_naming` | `chamber_synthesis` |
 *    `hypothesis_generation`) has no `import_corpus`/`run_monitor` member,
 *    exactly the same reason `dispatchScanMonitorJob` bypasses it. The
 *    idempotency key is a manual sha256 of job type + projectId + the sorted
 *    item list, mirroring `computeIdempotencyKey`'s own shape without
 *    reusing a type it doesn't cover.
 */

export interface CorpusItemRow {
  memberId: string;
  id: string;
  source: string;
  externalId: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  url: string | null;
  venue: string | null;
  createdAt: Date;
  /** Whether this item's provider payload included an abstract — the only
   *  source text `extract_claims`'s corpus-item path can ever cite from
   *  (Phase 30 fix lane, D-25-13). The Corpus page uses this to disable/hide
   *  its "Extract claims" affordance honestly rather than let a dispatch
   *  fail server-side on an item with nothing to extract from. */
  hasAbstract: boolean;
}

/** Owner-scoped by BOTH the project (via `getOwnedResearchProject`) and the
 *  corpus item's own `user_id` — belt-and-suspenders against a mismatched
 *  member row, the same doubled ownership check `listCorpusItemsForProject`'s
 *  sibling reads elsewhere in this package use. Returns `null` (not `[]`)
 *  when the project isn't the caller's own, so the calling route can 404. */
export async function listCorpusItemsForProject(userId: string, projectId: string): Promise<CorpusItemRow[] | null> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return null;
  const rows = await db
    .select({
      memberId: researchProjectMembers.id,
      id: researchCorpusItems.id,
      source: researchCorpusItems.source,
      externalId: researchCorpusItems.externalId,
      title: researchCorpusItems.title,
      authors: researchCorpusItems.authors,
      year: researchCorpusItems.year,
      doi: researchCorpusItems.doi,
      url: researchCorpusItems.url,
      venue: researchCorpusItems.venue,
      abstract: researchCorpusItems.abstract,
      createdAt: researchProjectMembers.createdAt,
    })
    .from(researchProjectMembers)
    .innerJoin(researchCorpusItems, eq(researchCorpusItems.id, researchProjectMembers.corpusItemId))
    .where(
      and(
        eq(researchProjectMembers.projectId, projectId),
        eq(researchProjectMembers.memberType, "corpus_item"),
        eq(researchCorpusItems.userId, userId),
      ),
    )
    .orderBy(desc(researchProjectMembers.createdAt));
  // The raw abstract text itself is never returned to the client — this
  // page never renders it, only whether extraction has something to work
  // with (`hasAbstract`).
  return rows.map(({ abstract, ...rest }) => ({ ...rest, hasAbstract: Boolean(abstract && abstract.trim()) })) as CorpusItemRow[];
}

export interface ImportCorpusItemInput {
  provider: CorpusProvider;
  externalId: string;
}

export type DispatchImportCorpusResult = { action: "not_found" } | { action: "reused"; requestId: string } | { action: "queued"; requestId: string };

/** Dispatch an `import_corpus` job for one or more search-result picks,
 *  scoped to this project (`ImportCorpusScope`, `apps/worker/src/research/importCorpus.ts`)
 *  so the worker links each imported item into it as a `corpus_item` member
 *  on completion — the page re-reads `listCorpusItemsForProject` on next load
 *  to pick that up, same async "queue now, reflect later" shape the monitors
 *  hits feed already uses for "Add to corpus". */
export async function dispatchImportCorpusJob(userId: string, projectId: string, items: ImportCorpusItemInput[]): Promise<DispatchImportCorpusResult> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return { action: "not_found" };
  if (items.length === 0) return { action: "not_found" };

  const sortedItemsKey = items.map((i) => `${i.provider}:${i.externalId}`).sort().join(",");
  const idempotencyKey = createHash("sha256").update(`import_corpus:${projectId}:${sortedItemsKey}`).digest("hex");

  const [created] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "import_corpus",
      scope: { projectId, items },
      idempotencyKey,
      status: "queued",
      estimatedCostUsd: 0,
      requiresConfirmation: false,
      confirmedAt: new Date(),
    })
    .onConflictDoNothing({
      // Partial unique index (in-flight statuses only) — same target/predicate
      // as `dispatchScanMonitorJob`/`dispatchExtractClaimsJob` above it.
      target: [researchJobRequests.userId, researchJobRequests.idempotencyKey],
      where: sql`${researchJobRequests.status} in ('planned', 'queued', 'running')`,
    })
    .returning({ id: researchJobRequests.id });

  if (!created) {
    const [existing] = await db
      .select({ id: researchJobRequests.id })
      .from(researchJobRequests)
      .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.idempotencyKey, idempotencyKey)))
      .orderBy(desc(researchJobRequests.createdAt))
      .limit(1);
    if (existing) return { action: "reused", requestId: existing.id };
    return { action: "not_found" }; // unreachable in practice — the same defensive fallback dispatchScanMonitorJob uses
  }
  await enqueueImportResearchCorpus(created.id);
  return { action: "queued", requestId: created.id };
}
