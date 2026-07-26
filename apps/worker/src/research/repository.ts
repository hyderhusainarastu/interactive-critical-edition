import {
  aiUsageLogs,
  citations,
  claimLoci,
  claimScores,
  db,
  docMetadata,
  documents,
  pages,
  processingRuns,
  researchClaimEmbeddings,
  researchClaims,
  researchJobRequests,
  textBlocks,
  works,
  type researchJobCoverageEnum,
} from "@ice/db";
import type { ExtractionBlock } from "@ice/claims";
import { and, asc, eq, isNull, ne, or, sql } from "drizzle-orm";

/**
 * All Drizzle reads/writes for the Phase 26.1 claim-extraction pipeline.
 * Owner-scoped predicates everywhere a row is user data (`research_claim`,
 * `research_job_request`) — the same discipline `apps/web/src/lib/*` reads
 * apply, just on the worker side of the boundary.
 */

// ---------------------------------------------------------------------------
// research_job_request lifecycle (shared by every research job type via
// jobRunner.ts — not extract_claims-specific).
// ---------------------------------------------------------------------------

export interface ResearchJobRequestRow {
  id: string;
  userId: string;
  jobType: string;
  scope: unknown;
  status: string;
  estimatedCostUsd: number;
  actualCostUsd: number;
  requiresConfirmation: boolean;
  confirmedAt: Date | null;
}

export async function getResearchJobRequest(requestId: string): Promise<ResearchJobRequestRow | null> {
  const [row] = await db
    .select({
      id: researchJobRequests.id,
      userId: researchJobRequests.userId,
      jobType: researchJobRequests.jobType,
      scope: researchJobRequests.scope,
      status: researchJobRequests.status,
      estimatedCostUsd: researchJobRequests.estimatedCostUsd,
      actualCostUsd: researchJobRequests.actualCostUsd,
      requiresConfirmation: researchJobRequests.requiresConfirmation,
      confirmedAt: researchJobRequests.confirmedAt,
    })
    .from(researchJobRequests)
    .where(eq(researchJobRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

export async function markResearchJobRunning(requestId: string): Promise<void> {
  await db
    .update(researchJobRequests)
    .set({ status: "running", error: null, updatedAt: new Date() })
    .where(eq(researchJobRequests.id, requestId));
}

export async function setResearchJobStage(
  requestId: string,
  stage: string,
  progress?: { index: number; total: number },
): Promise<void> {
  await db
    .update(researchJobRequests)
    .set({
      stage,
      progressIndex: progress?.index ?? null,
      progressTotal: progress?.total ?? null,
      updatedAt: new Date(),
    })
    .where(eq(researchJobRequests.id, requestId));
}

export type ResearchJobCoverage = (typeof researchJobCoverageEnum.enumValues)[number];

export async function markResearchJobComplete(
  requestId: string,
  input: { actualCostUsd: number; coverage: ResearchJobCoverage; note?: string | null },
): Promise<void> {
  await db
    .update(researchJobRequests)
    .set({
      status: "complete",
      actualCostUsd: input.actualCostUsd,
      coverage: input.coverage,
      note: input.note ?? null,
      error: null,
      stage: null,
      progressIndex: null,
      progressTotal: null,
      updatedAt: new Date(),
    })
    .where(eq(researchJobRequests.id, requestId));
}

export async function markResearchJobFailed(requestId: string, input: { actualCostUsd: number; error: string }): Promise<void> {
  await db
    .update(researchJobRequests)
    .set({
      status: "failed",
      actualCostUsd: input.actualCostUsd,
      error: input.error.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(researchJobRequests.id, requestId));
}

/** Crash-proof budget seed (the `analyze.ts` idiom, request-scoped rather
 *  than document/episode-scoped — a `research_job_request` row IS the
 *  episode boundary here, so no version floor is needed). */
export async function sumPriorUsageForRequest(requestId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsageLogs.estimatedCostUsd}), 0)` })
    .from(aiUsageLogs)
    .where(eq(aiUsageLogs.researchRequestId, requestId));
  return row?.total ?? 0;
}

export interface PendingResearchUsageLog {
  researchRequestId: string;
  task: string;
  stage: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

export async function insertUsageLogs(rows: PendingResearchUsageLog[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(aiUsageLogs).values(
    rows.map((r) => ({
      researchRequestId: r.researchRequestId,
      task: r.task,
      stage: r.stage,
      provider: r.provider,
      model: r.model,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      estimatedCostUsd: r.estimatedCostUsd,
    })),
  );
}

// ---------------------------------------------------------------------------
// Work extraction scope (extract_claims, uploaded-work path).
// ---------------------------------------------------------------------------

export interface BlockMeta {
  id: string;
  pageId: string;
  kind: string;
  text: string;
}

export interface WorkExtractionScope {
  userId: string;
  workId: string;
  documentId: string;
  workTitle: string;
  processingRunId: string;
  /** `@ice/claims`'s `planExtractionChunks` input — every block regardless
   *  of kind; the allowlist (`CLAIM_ELIGIBLE_BLOCK_KINDS`) does the
   *  apparatus exclusion, not this loader. */
  blocks: ExtractionBlock[];
  /** blockId -> full metadata, for locating the "named block" behind an
   *  accepted excerpt and for locus-harvest proximity lookups. */
  blockMeta: Map<string, BlockMeta>;
  /** pageId -> footnote/endnote block texts on that page (locus harvest, origin "footnote"). */
  footnoteTextsByPage: Map<string, string[]>;
  /** textBlockId -> citation raw texts anchored to that block (locus harvest, origin "citation"). */
  citationTextsByBlock: Map<string, string[]>;
}

/**
 * Loads everything `extractClaimsForWork` needs for one uploaded work: the
 * work's PUBLISHED run's body-eligible text blocks (in document order, with
 * a running section title derived the same way `extraction.ts` does at
 * insert time — `text_block` itself carries no `section_title` column, see
 * that file's own `bodyBlocks` construction), plus the footnote/citation
 * context the locus-harvest step reads. Returns null when the work has no
 * document, or the document has no published run — extraction cannot run
 * without a stable, reader-visible text to anchor to.
 */
export async function loadWorkExtractionScope(workId: string): Promise<WorkExtractionScope | null> {
  const [work] = await db.select({ id: works.id, userId: works.userId, title: works.title }).from(works).where(eq(works.id, workId)).limit(1);
  if (!work) return null;

  const [document] = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, workId)).limit(1);
  if (!document) return null;

  const [run] = await db
    .select({ id: processingRuns.id })
    .from(processingRuns)
    .where(and(eq(processingRuns.documentId, document.id), eq(processingRuns.isPublished, true)))
    .limit(1);
  if (!run) return null;

  const [meta] = await db.select({ title: docMetadata.title }).from(docMetadata).where(eq(docMetadata.runId, run.id)).limit(1);
  const workTitle = meta?.title?.trim() || work.title;

  const rows = await db
    .select({
      id: textBlocks.id,
      pageId: textBlocks.pageId,
      kind: textBlocks.kind,
      text: textBlocks.text,
      blockOrder: textBlocks.blockOrder,
      pageIndex: pages.pageIndex,
    })
    .from(textBlocks)
    .innerJoin(pages, eq(textBlocks.pageId, pages.id))
    .where(eq(pages.runId, run.id))
    .orderBy(asc(pages.pageIndex), asc(textBlocks.blockOrder));

  const blocks: ExtractionBlock[] = [];
  const blockMeta = new Map<string, BlockMeta>();
  const footnoteTextsByPage = new Map<string, string[]>();
  // Same running-title derivation as `apps/worker/src/extraction.ts`'s
  // `bodyBlocks` construction: a `title`/`header` block updates the running
  // section title BEFORE it's read by whatever block (including itself)
  // reads it next.
  let currentSectionTitle = "";
  for (const row of rows) {
    if ((row.kind === "title" || row.kind === "header") && row.text.trim()) currentSectionTitle = row.text.trim();
    blocks.push({ id: row.id, kind: row.kind, sectionLabel: currentSectionTitle, text: row.text });
    blockMeta.set(row.id, { id: row.id, pageId: row.pageId, kind: row.kind, text: row.text });
    if (row.kind === "footnote" || row.kind === "endnote") {
      const existing = footnoteTextsByPage.get(row.pageId) ?? [];
      existing.push(row.text);
      footnoteTextsByPage.set(row.pageId, existing);
    }
  }

  const citationRows = await db
    .select({ textBlockId: citations.textBlockId, rawText: citations.rawText })
    .from(citations)
    .where(and(eq(citations.documentId, document.id), sql`${citations.textBlockId} is not null`));
  const citationTextsByBlock = new Map<string, string[]>();
  for (const row of citationRows) {
    if (!row.textBlockId) continue;
    const existing = citationTextsByBlock.get(row.textBlockId) ?? [];
    existing.push(row.rawText);
    citationTextsByBlock.set(row.textBlockId, existing);
  }

  return {
    userId: work.userId,
    workId: work.id,
    documentId: document.id,
    workTitle,
    processingRunId: run.id,
    blocks,
    blockMeta,
    footnoteTextsByPage,
    citationTextsByBlock,
  };
}

// ---------------------------------------------------------------------------
// research_claim writes.
// ---------------------------------------------------------------------------

export interface NewResearchClaim {
  userId: string;
  workId: string;
  processingRunId: string;
  textBlockId: string;
  quote: string;
  prefix: string;
  suffix: string;
  claimText: string;
  claimNature: string;
  confidence: string;
  section: string;
  sourceScope: "full_text" | "abstract" | "sampled";
  supportingExcerpt: string;
  contentHash: string;
  promptVersion: string;
}

/** Inserts one claim, respecting the partial dedup unique
 *  (`research_claim_work_dedup_unique`, `WHERE work_id IS NOT NULL`) — a
 *  re-run under an unchanged prompt version inserts nothing new for an
 *  unchanged claim. Returns the inserted row's id, or null when the insert
 *  was a no-op (the claim already existed). */
export async function insertResearchClaim(claim: NewResearchClaim): Promise<string | null> {
  const [inserted] = await db
    .insert(researchClaims)
    .values({
      userId: claim.userId,
      workId: claim.workId,
      processingRunId: claim.processingRunId,
      textBlockId: claim.textBlockId,
      quote: claim.quote,
      prefix: claim.prefix,
      suffix: claim.suffix,
      anchorState: "anchored",
      claimText: claim.claimText,
      claimNature: claim.claimNature as (typeof researchClaims.$inferInsert)["claimNature"],
      confidence: claim.confidence,
      section: claim.section,
      sourceScope: claim.sourceScope,
      supportingExcerpt: claim.supportingExcerpt,
      excerptVerified: true,
      contentHash: claim.contentHash,
      promptVersion: claim.promptVersion,
    })
    .onConflictDoNothing({
      target: [researchClaims.workId, researchClaims.contentHash, researchClaims.promptVersion],
      where: sql`${researchClaims.workId} is not null`,
    })
    .returning({ id: researchClaims.id });
  return inserted?.id ?? null;
}

export interface NewClaimScore {
  claimId: string;
  dimension: string;
  score: number;
  label: string;
  tier: string | null;
  signals: string[];
  scorerVersion: string;
}

export async function insertClaimScores(scores: NewClaimScore[]): Promise<void> {
  if (scores.length === 0) return;
  await db
    .insert(claimScores)
    .values(
      scores.map((s) => ({
        claimId: s.claimId,
        dimension: s.dimension as (typeof claimScores.$inferInsert)["dimension"],
        score: s.score,
        label: s.label as (typeof claimScores.$inferInsert)["label"],
        tier: s.tier,
        signals: s.signals,
        scorerVersion: s.scorerVersion,
      })),
    )
    .onConflictDoNothing({ target: [claimScores.claimId, claimScores.dimension, claimScores.scorerVersion] });
}

export interface NewClaimLocus {
  claimId: string;
  locusKey: string;
  origin: string;
  rawLocus: string | null;
}

export async function insertClaimLoci(loci: NewClaimLocus[]): Promise<void> {
  if (loci.length === 0) return;
  await db
    .insert(claimLoci)
    .values(
      loci.map((l) => ({
        claimId: l.claimId,
        locusKey: l.locusKey,
        origin: l.origin as (typeof claimLoci.$inferInsert)["origin"],
        rawLocus: l.rawLocus,
      })),
    )
    .onConflictDoNothing({ target: [claimLoci.claimId, claimLoci.locusKey, claimLoci.origin] });
}

export interface NewClaimEmbedding {
  claimId: string;
  model: string;
  inputHash: string;
  embedding: number[];
  dim: number;
}

export async function insertClaimEmbeddings(rows: NewClaimEmbedding[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(researchClaimEmbeddings)
    .values(rows.map((r) => ({ claimId: r.claimId, model: r.model, inputHash: r.inputHash, embedding: r.embedding, dim: r.dim })))
    .onConflictDoNothing({ target: [researchClaimEmbeddings.claimId, researchClaimEmbeddings.model, researchClaimEmbeddings.inputHash] });
}

// ---------------------------------------------------------------------------
// Rebind (reprocess supersession).
// ---------------------------------------------------------------------------

export interface RebindableClaim {
  id: string;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
}

/** Active work-sourced claims not already matched to the current published
 *  run — the rebind step's input. `IS NULL OR <>` (not `is distinct from`
 *  directly on the column, for drizzle `ne()` compatibility) covers a claim
 *  that was previously left `unanchored` with `processing_run_id` cleared. */
export async function getClaimsNeedingRebind(workId: string, currentRunId: string): Promise<RebindableClaim[]> {
  return db
    .select({ id: researchClaims.id, quote: researchClaims.quote, prefix: researchClaims.prefix, suffix: researchClaims.suffix })
    .from(researchClaims)
    .where(
      and(
        eq(researchClaims.workId, workId),
        eq(researchClaims.status, "active"),
        or(isNull(researchClaims.processingRunId), ne(researchClaims.processingRunId, currentRunId)),
      ),
    );
}

export async function applyRebindResult(
  claimId: string,
  outcome: { textBlockId: string; anchorState: "rebound"; processingRunId: string } | { textBlockId: null; anchorState: "unanchored"; processingRunId: string },
): Promise<void> {
  await db
    .update(researchClaims)
    .set({
      textBlockId: outcome.textBlockId,
      anchorState: outcome.anchorState,
      processingRunId: outcome.processingRunId,
      updatedAt: new Date(),
    })
    .where(eq(researchClaims.id, claimId));
}

/** Active work-sourced claim count for a specific (run, prompt_version) —
 *  used to decide whether a chunk's extraction has already run this
 *  published run under the current prompt (idempotency at the DB level;
 *  a re-run's LLM calls still happen, but produce zero new rows). */
export async function countActiveClaimsForRun(runId: string, promptVersion: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(researchClaims)
    .where(and(eq(researchClaims.processingRunId, runId), eq(researchClaims.promptVersion, promptVersion), eq(researchClaims.status, "active")));
  return Number(row?.count ?? 0);
}
