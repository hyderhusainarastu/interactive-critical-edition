import {
  aiUsageLogs,
  bibliographicRecords,
  citations,
  claimLoci,
  claimPairCandidates,
  claimRelationships,
  claimScores,
  debateClusterMembers,
  debateClusterRelationships,
  debateClusters,
  db,
  docMetadata,
  documents,
  pages,
  processingRuns,
  researchClaimEmbeddings,
  researchClaims,
  researchCorpusItems,
  researchJobRequests,
  researchProjectMembers,
  researchProjects,
  textBlocks,
  works,
  type researchJobCoverageEnum,
} from "@ice/db";
import type { ExtractionBlock } from "@ice/claims";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

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

// ---------------------------------------------------------------------------
// import_corpus writes (Phase 28.2). Zero AI cost — every write below is
// either a real-provider-payload insert or a read-only lookup/link.
// ---------------------------------------------------------------------------

export interface NewCorpusItem {
  source: string;
  externalId: string;
  dedupKey: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  venue: string | null;
  raw: unknown;
}

export interface UpsertCorpusItemResult {
  id: string;
  /** False when this exact `(user_id, dedup_key)` already existed — the
   *  dedup-idempotency case ("import the same paper twice" reuses the row
   *  rather than duplicating it). */
  wasNew: boolean;
}

/** Inserts one corpus item, respecting the `(user_id, dedup_key)` unique
 *  index. On a dedup hit, re-selects and returns the EXISTING row's id
 *  (never a second insert) — the caller still needs an id to link into a
 *  project even when nothing new was written. */
export async function upsertResearchCorpusItem(userId: string, item: NewCorpusItem): Promise<UpsertCorpusItemResult> {
  const [inserted] = await db
    .insert(researchCorpusItems)
    .values({
      userId,
      source: item.source as (typeof researchCorpusItems.$inferInsert)["source"],
      externalId: item.externalId,
      dedupKey: item.dedupKey,
      title: item.title,
      authors: item.authors,
      year: item.year,
      doi: item.doi,
      url: item.url,
      abstract: item.abstract,
      venue: item.venue,
      raw: item.raw,
    })
    .onConflictDoNothing({ target: [researchCorpusItems.userId, researchCorpusItems.dedupKey] })
    .returning({ id: researchCorpusItems.id });
  if (inserted) return { id: inserted.id, wasNew: true };

  const [existing] = await db
    .select({ id: researchCorpusItems.id })
    .from(researchCorpusItems)
    .where(and(eq(researchCorpusItems.userId, userId), eq(researchCorpusItems.dedupKey, item.dedupKey)))
    .limit(1);
  if (!existing) {
    // Unreachable in practice (the conflict that just happened proves a
    // matching row exists), but never silently swallow a genuine anomaly.
    throw new Error(`Corpus item upsert conflicted on dedupKey ${item.dedupKey} but no existing row was found.`);
  }
  return { id: existing.id, wasNew: false };
}

/** Read-only DOI match against the shared `bibliographic_record` catalog —
 *  "link if an existing one matches", never a creation (plan §28.2's own
 *  scope: no new `bibliographic_record` is written by corpus import). DOI
 *  comparison is case-insensitive since `bibliographic_record.doi` isn't
 *  guaranteed to have been stored through the same `canonicalizeDoi()` path
 *  every provider payload was. */
export async function findBibliographicRecordByDoi(doi: string): Promise<{ id: string; title: string } | null> {
  const [row] = await db
    .select({ id: bibliographicRecords.id, title: bibliographicRecords.title })
    .from(bibliographicRecords)
    .where(sql`lower(${bibliographicRecords.doi}) = ${doi.toLowerCase()}`)
    .limit(1);
  return row ?? null;
}

/** Ownership check for the optional `projectId` scope field — a research
 *  project is user-scoped, so importing into someone else's project must
 *  fail loudly rather than silently succeed against the wrong project. */
export async function userOwnsResearchProject(userId: string, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: researchProjects.id })
    .from(researchProjects)
    .where(and(eq(researchProjects.id, projectId), eq(researchProjects.userId, userId)))
    .limit(1);
  return Boolean(row);
}

/** Links a corpus item into a project as a `corpus_item` member, respecting
 *  the `(project_id, corpus_item_id)` unique index. Returns whether a new
 *  membership row was actually created (false = already a member — an
 *  honest "already linked" outcome, not an error). */
export async function linkCorpusItemToProject(projectId: string, corpusItemId: string): Promise<boolean> {
  const [inserted] = await db
    .insert(researchProjectMembers)
    .values({ projectId, memberType: "corpus_item", corpusItemId })
    .onConflictDoNothing({ target: [researchProjectMembers.projectId, researchProjectMembers.corpusItemId] })
    .returning({ id: researchProjectMembers.id });
  return Boolean(inserted);
}

// ---------------------------------------------------------------------------
// detect_relationships scope (Phase 26.2a).
// ---------------------------------------------------------------------------

export interface ResearchProjectRow {
  id: string;
  userId: string;
}

/** Owner-scoped project lookup — the predicate that keeps every read below
 *  it (work members, claims) inside the requesting user's own data. */
export async function loadResearchProjectForUser(projectId: string, userId: string): Promise<ResearchProjectRow | null> {
  const [row] = await db
    .select({ id: researchProjects.id, userId: researchProjects.userId })
    .from(researchProjects)
    .where(and(eq(researchProjects.id, projectId), eq(researchProjects.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Every `work`-typed member of a project, regardless of role
 *  (central/supporting/background) — unlike extraction's role-gated
 *  trigger, relationship detection scopes over every claim already
 *  extracted for any member work. Corpus-item members are out of scope for
 *  this lane (research_claim has no corpus-item-sourced rows yet; see
 *  extractClaims.ts's own typed TODO for the corpus-item extraction path) —
 *  TODO(Phase 28.2+): once corpus-item claims exist, widen this to also
 *  return corpusItemIds and fold them into the retrieval/engagement scope. */
export async function loadProjectWorkIds(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ workId: researchProjectMembers.workId })
    .from(researchProjectMembers)
    .where(and(eq(researchProjectMembers.projectId, projectId), eq(researchProjectMembers.memberType, "work")));
  return rows.map((r) => r.workId).filter((id): id is string => id !== null);
}

export interface ScopedClaimRow {
  id: string;
  userId: string;
  workId: string;
  claimText: string;
  claimNature: string;
}

/** Active, non-hidden, work-sourced claims across a set of works — Stage-1
 *  retrieval's entire input population. `userId` is asserted again here
 *  (not just relied on transitively via `loadProjectWorkIds`'s own
 *  ownership check) as a second, independent ownership guard on the actual
 *  claim rows returned — the same defense-in-depth the rest of this file's
 *  owner-scoped reads apply. */
export async function loadScopedClaimsForRelationshipDetection(userId: string, workIds: string[]): Promise<ScopedClaimRow[]> {
  if (workIds.length === 0) return [];
  const rows = await db
    .select({
      id: researchClaims.id,
      userId: researchClaims.userId,
      workId: researchClaims.workId,
      claimText: researchClaims.claimText,
      claimNature: researchClaims.claimNature,
    })
    .from(researchClaims)
    .where(
      and(
        eq(researchClaims.userId, userId),
        inArray(researchClaims.workId, workIds),
        eq(researchClaims.status, "active"),
        eq(researchClaims.hidden, false),
      ),
    );
  // `workId` is nullable at the type level (a corpus-item-sourced claim has
  // it null instead — see `research_claim_exactly_one_source`), but every
  // row here matched `inArray(researchClaims.workId, workIds)`, which can
  // never match null — `.filter(Boolean)` on `workId` plus the explicit
  // remap narrows the TS type to reflect that DB-enforced fact rather than
  // actually filtering anything out.
  return rows
    .filter((r) => r.workId !== null)
    .map((r) => ({ id: r.id, userId: r.userId, workId: r.workId as string, claimText: r.claimText, claimNature: r.claimNature }));
}

/** Embedding vectors for a set of claims, filtered to ONE model — "the
 *  ACTIVE model" (plan §Pipeline "Three-channel Stage 1"). A claim without a
 *  row here (never embedded, or embedded under a since-changed model)
 *  simply has no dense-channel entry — it still participates via BM25/locus,
 *  never silently dropped from retrieval altogether. */
export async function loadClaimEmbeddingsForModel(claimIds: string[], model: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (claimIds.length === 0) return out;
  const rows = await db
    .select({ claimId: researchClaimEmbeddings.claimId, embedding: researchClaimEmbeddings.embedding })
    .from(researchClaimEmbeddings)
    .where(and(inArray(researchClaimEmbeddings.claimId, claimIds), eq(researchClaimEmbeddings.model, model)));
  for (const row of rows) out.set(row.claimId, row.embedding as unknown as number[]);
  return out;
}

export interface ClaimLocusRow {
  claimId: string;
  locusKey: string;
}

/** Every distinct `(claimId, locusKey)` a set of claims carries, collapsed
 *  across origins (`excerpt`/`block`/`footnote`/`citation`) — the locus
 *  retrieval channel only cares THAT a claim is anchored at a given locus,
 *  not which origin(s) corroborated it. */
export async function loadDistinctClaimLoci(claimIds: string[]): Promise<ClaimLocusRow[]> {
  if (claimIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ claimId: claimLoci.claimId, locusKey: claimLoci.locusKey })
    .from(claimLoci)
    .where(inArray(claimLoci.claimId, claimIds));
  return rows;
}

export interface NewClaimPairCandidate {
  claimLoId: string;
  claimHiId: string;
  retrievalSources: { channel: string; score: number }[];
  bestRetrievalScore: number;
  engagement: string;
  engagementEvidence: Record<string, unknown> | null;
}

/** Idempotent bulk insert on the `(user_id, claim_lo_id, claim_hi_id)`
 *  unique — a re-run over an unchanged claim set inserts zero new rows.
 *  Returns how many rows were ACTUALLY new (not how many were attempted),
 *  which is what makes the "repeat run costs nothing new" canary assertion
 *  meaningful. */
export async function insertClaimPairCandidates(userId: string, projectId: string, candidates: NewClaimPairCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  const inserted = await db
    .insert(claimPairCandidates)
    .values(
      candidates.map((c) => ({
        userId,
        projectId,
        claimLoId: c.claimLoId,
        claimHiId: c.claimHiId,
        retrievalSources: c.retrievalSources,
        bestRetrievalScore: c.bestRetrievalScore,
        engagement: c.engagement as (typeof claimPairCandidates.$inferInsert)["engagement"],
        engagementEvidence: c.engagementEvidence,
      })),
    )
    .onConflictDoNothing({ target: [claimPairCandidates.userId, claimPairCandidates.claimLoId, claimPairCandidates.claimHiId] })
    .returning({ id: claimPairCandidates.id });
  return inserted.length;
}

// ---------------------------------------------------------------------------
// detect_relationships JUDGE stage (Phase 26.2b).
// ---------------------------------------------------------------------------

export interface CandidatePairRow {
  id: string;
  claimLoId: string;
  claimHiId: string;
  bestRetrievalScore: number;
  engagement: string;
  engagementEvidence: Record<string, unknown> | null;
}

/** Every persisted `claim_pair_candidate` for a project — the judge stage's
 *  entire input population, ranked by `bestRetrievalScore` (descending) so a
 *  caller applying `RETRIEVAL_LIMITS.maxJudgedPairsPerRequest` drops the
 *  weakest candidates first, matching Stage-1's own truncation discipline. */
export async function loadClaimPairCandidatesForProject(userId: string, projectId: string): Promise<CandidatePairRow[]> {
  const rows = await db
    .select({
      id: claimPairCandidates.id,
      claimLoId: claimPairCandidates.claimLoId,
      claimHiId: claimPairCandidates.claimHiId,
      bestRetrievalScore: claimPairCandidates.bestRetrievalScore,
      engagement: claimPairCandidates.engagement,
      engagementEvidence: claimPairCandidates.engagementEvidence,
    })
    .from(claimPairCandidates)
    .where(and(eq(claimPairCandidates.userId, userId), eq(claimPairCandidates.projectId, projectId)))
    .orderBy(sql`${claimPairCandidates.bestRetrievalScore} desc`);
  return rows.map((r) => ({ ...r, engagementEvidence: r.engagementEvidence as Record<string, unknown> | null }));
}

export interface ClaimJudgeDetail {
  id: string;
  workId: string;
  workTitle: string;
  claimText: string;
  supportingExcerpt: string;
  claimNature: string;
}

/** Judge-input detail for a set of claims — text, excerpt, nature, and the
 *  OWNING WORK's title (`JudgeClaimInput.workTitle`; `work.title` rather
 *  than `doc_metadata.title` — simpler than `loadWorkExtractionScope`'s
 *  resolved-run title and sufficient for naming a work in a judge prompt). A
 *  corpus-item-sourced claim (`work_id` null) is silently absent from the
 *  returned map — Stage 1 retrieval never surfaces one today (Phase 28.2's
 *  own typed TODO), so this is unreachable in practice, not silently wrong. */
export async function loadClaimJudgeDetails(claimIds: string[]): Promise<Map<string, ClaimJudgeDetail>> {
  const out = new Map<string, ClaimJudgeDetail>();
  if (claimIds.length === 0) return out;
  const rows = await db
    .select({
      id: researchClaims.id,
      workId: researchClaims.workId,
      workTitle: works.title,
      claimText: researchClaims.claimText,
      supportingExcerpt: researchClaims.supportingExcerpt,
      claimNature: researchClaims.claimNature,
    })
    .from(researchClaims)
    .innerJoin(works, eq(works.id, researchClaims.workId))
    .where(inArray(researchClaims.id, claimIds));
  for (const row of rows) {
    if (!row.workId) continue;
    out.set(row.id, { id: row.id, workId: row.workId, workTitle: row.workTitle, claimText: row.claimText, supportingExcerpt: row.supportingExcerpt, claimNature: row.claimNature });
  }
  return out;
}

export interface ExistingRelationshipKey {
  claimLoId: string;
  claimHiId: string;
  basisHash: string;
}

/** Every `claim_relationship` row already covering one of the given claim
 *  ids, for THIS user — the judge stage's "already judged under an
 *  unchanged world" check. Not project-scoped: `claim_relationship`'s own
 *  dedup unique is `(user_id, claim_lo_id, claim_hi_id, basis_hash)`, with no
 *  project_id in it (the same claim pair surfacing in two different
 *  projects is still one judgment, not two) — so this reads by claim id
 *  membership, matching the real key rather than narrowing by project and
 *  silently re-paying for a pair another project already judged. */
export async function loadExistingRelationshipKeys(userId: string, claimIds: string[]): Promise<ExistingRelationshipKey[]> {
  if (claimIds.length === 0) return [];
  return db
    .select({ claimLoId: claimRelationships.claimLoId, claimHiId: claimRelationships.claimHiId, basisHash: claimRelationships.basisHash })
    .from(claimRelationships)
    .where(
      and(
        eq(claimRelationships.userId, userId),
        inArray(claimRelationships.claimLoId, claimIds),
        inArray(claimRelationships.claimHiId, claimIds),
      ),
    );
}

export interface NewClaimRelationship {
  claimLoId: string;
  claimHiId: string;
  valence: string;
  category: string;
  judgeBranch: string;
  strongerSide: string;
  explanation: string;
  resolution: string;
  engagement: string;
  evidenceGap: number | null;
  evidenceGapDimension: string | null;
  basisHash: string;
  promptVersion: string;
  provider: string;
  model: string;
}

/** Idempotent insert on the `(user_id, claim_lo_id, claim_hi_id, basis_hash)`
 *  unique — a re-run that recomputes the SAME basis hash for a pair already
 *  judged inserts nothing new (the "repeat run costs $0" canary guarantee).
 *  `mechanism` is never accepted as a parameter here: Stage 1's DB enum only
 *  contains `'unspecified'`, and this lane never persists it (see
 *  `detectRelationships.ts`'s judge-stage doc comment) — the column is left
 *  at its SQL-level NULL default. Returns the inserted row's id, or null on
 *  a dedup hit. */
export async function insertClaimRelationship(userId: string, projectId: string, rel: NewClaimRelationship): Promise<string | null> {
  const [inserted] = await db
    .insert(claimRelationships)
    .values({
      userId,
      projectId,
      claimLoId: rel.claimLoId,
      claimHiId: rel.claimHiId,
      valence: rel.valence as (typeof claimRelationships.$inferInsert)["valence"],
      category: rel.category as (typeof claimRelationships.$inferInsert)["category"],
      judgeBranch: rel.judgeBranch as (typeof claimRelationships.$inferInsert)["judgeBranch"],
      strongerSide: rel.strongerSide as (typeof claimRelationships.$inferInsert)["strongerSide"],
      explanation: rel.explanation,
      resolution: rel.resolution,
      engagement: rel.engagement as (typeof claimRelationships.$inferInsert)["engagement"],
      evidenceGap: rel.evidenceGap,
      evidenceGapDimension: rel.evidenceGapDimension as (typeof claimRelationships.$inferInsert)["evidenceGapDimension"],
      basisHash: rel.basisHash,
      promptVersion: rel.promptVersion,
      provider: rel.provider,
      model: rel.model,
    })
    .onConflictDoNothing({
      target: [claimRelationships.userId, claimRelationships.claimLoId, claimRelationships.claimHiId, claimRelationships.basisHash],
    })
    .returning({ id: claimRelationships.id });
  return inserted?.id ?? null;
}

export interface ClaimScoreRow {
  dimension: string;
  score: number;
}

/** Every `claim_score` row for a set of claims, grouped by claim id — the
 *  judge stage's `evidence_gap` input. A claim with zero rows here is
 *  honestly unscored on every dimension (see `claim_score`'s own doc
 *  comment); the judge stage's `evidence_gap` computation treats that as
 *  "no gap to report", never a fabricated 0. */
export async function loadClaimScoresForClaims(claimIds: string[]): Promise<Map<string, ClaimScoreRow[]>> {
  const out = new Map<string, ClaimScoreRow[]>();
  if (claimIds.length === 0) return out;
  const rows = await db
    .select({ claimId: claimScores.claimId, dimension: claimScores.dimension, score: claimScores.score })
    .from(claimScores)
    .where(inArray(claimScores.claimId, claimIds));
  for (const row of rows) {
    const existing = out.get(row.claimId) ?? [];
    existing.push({ dimension: row.dimension, score: row.score });
    out.set(row.claimId, existing);
  }
  return out;
}

// ---------------------------------------------------------------------------
// cluster_debates (Phase 26.3).
// ---------------------------------------------------------------------------

export interface JudgedRelationshipEdge {
  id: string;
  claimLoId: string;
  claimHiId: string;
  valence: string;
}

/** Every active, non-hidden `claim_relationship` for a project — the BFS
 *  clustering pass's whole edge population. `status = 'active'` excludes a
 *  future superseded judgment (there is no such write path yet, but the
 *  filter costs nothing and keeps this query correct the day one exists);
 *  `hidden = false` excludes a user-hidden relationship (the correction-
 *  workflow precedent) from contributing to cluster membership. */
export async function loadJudgedRelationshipsForProject(userId: string, projectId: string): Promise<JudgedRelationshipEdge[]> {
  return db
    .select({ id: claimRelationships.id, claimLoId: claimRelationships.claimLoId, claimHiId: claimRelationships.claimHiId, valence: claimRelationships.valence })
    .from(claimRelationships)
    .where(
      and(
        eq(claimRelationships.userId, userId),
        eq(claimRelationships.projectId, projectId),
        eq(claimRelationships.status, "active"),
        eq(claimRelationships.hidden, false),
      ),
    );
}

export interface ExistingDebateClusterRow {
  id: string;
  memberHash: string;
  status: string;
}

/** Every `debate_cluster` row (any status) for a project — the naming-
 *  idempotency lookup (`memberHash` -> row) and the stale-transition input
 *  (every currently-`active` row whose `memberHash` didn't survive this
 *  run's BFS becomes `stale`). */
export async function loadExistingDebateClustersForProject(userId: string, projectId: string): Promise<ExistingDebateClusterRow[]> {
  return db
    .select({ id: debateClusters.id, memberHash: debateClusters.memberHash, status: debateClusters.status })
    .from(debateClusters)
    .where(and(eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId)));
}

export interface NewDebateCluster {
  memberHash: string;
  name: string;
  researchQuestion: string | null;
  description: string | null;
  edgeCount: number;
  counts: Record<string, number>;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
}

/** Inserts a newly-named cluster, respecting the `(user_id, project_id,
 *  member_hash)` unique — a concurrent duplicate insert (two overlapping
 *  runs) is a no-op here, not a duplicate row; the caller re-selects on a
 *  dedup hit exactly like `upsertResearchCorpusItem`. */
export async function insertDebateCluster(userId: string, projectId: string, cluster: NewDebateCluster): Promise<string> {
  const [inserted] = await db
    .insert(debateClusters)
    .values({
      userId,
      projectId,
      name: cluster.name,
      researchQuestion: cluster.researchQuestion,
      description: cluster.description,
      memberHash: cluster.memberHash,
      edgeCount: cluster.edgeCount,
      counts: cluster.counts,
      status: "active",
      promptVersion: cluster.promptVersion,
      provider: cluster.provider,
      model: cluster.model,
    })
    .onConflictDoNothing({ target: [debateClusters.userId, debateClusters.projectId, debateClusters.memberHash] })
    .returning({ id: debateClusters.id });
  if (inserted) return inserted.id;

  const [existing] = await db
    .select({ id: debateClusters.id })
    .from(debateClusters)
    .where(and(eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId), eq(debateClusters.memberHash, cluster.memberHash)))
    .limit(1);
  if (!existing) {
    throw new Error(`Debate cluster insert conflicted on memberHash ${cluster.memberHash} but no existing row was found.`);
  }
  return existing.id;
}

/** Reactivates a cluster whose exact prior membership recurred (a `stale`
 *  row's component reappeared) — also refreshes `edgeCount`/`counts` in case
 *  the edge set changed shape (e.g. a `nuance` edge was corrected to
 *  `contradiction`) without changing WHICH claims belong, which would
 *  otherwise leave stale counts on an otherwise-correct row. */
export async function reactivateDebateCluster(clusterId: string, edgeCount: number, counts: Record<string, number>): Promise<void> {
  await db
    .update(debateClusters)
    .set({ status: "active", edgeCount, counts, updatedAt: new Date() })
    .where(eq(debateClusters.id, clusterId));
}

/** Marks every currently-`active` cluster for a project whose id is NOT in
 *  `survivingClusterIds` as `stale` — never deleted (plan §Pipeline
 *  "membership shifts mark old clusters `stale`, never delete (user
 *  verifications survive)"). Called with the FULL set of this run's
 *  surviving cluster ids, so a cluster this run didn't touch at all (because
 *  its component vanished entirely — e.g. its sole edge was hidden) is
 *  correctly marked stale too, not just ones whose membership changed shape. */
export async function markStaleDebateClusters(userId: string, projectId: string, survivingClusterIds: string[]): Promise<number> {
  const condition =
    survivingClusterIds.length > 0
      ? and(
          eq(debateClusters.userId, userId),
          eq(debateClusters.projectId, projectId),
          eq(debateClusters.status, "active"),
          sql`${debateClusters.id} NOT IN ${survivingClusterIds}`,
        )
      : and(eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId), eq(debateClusters.status, "active"));
  const rows = await db.update(debateClusters).set({ status: "stale", updatedAt: new Date() }).where(condition).returning({ id: debateClusters.id });
  return rows.length;
}

/** Replaces a cluster's member/edge join rows wholesale (delete-then-insert)
 *  — simpler and equally correct for this table's size than a diff, since
 *  the join rows carry no independent state of their own worth preserving
 *  row-for-row. */
export async function replaceDebateClusterMembership(clusterId: string, claimIds: string[], claimRelationshipIds: string[]): Promise<void> {
  await db.delete(debateClusterMembers).where(eq(debateClusterMembers.clusterId, clusterId));
  await db.delete(debateClusterRelationships).where(eq(debateClusterRelationships.clusterId, clusterId));
  if (claimIds.length > 0) {
    await db
      .insert(debateClusterMembers)
      .values(claimIds.map((claimId) => ({ clusterId, claimId })))
      .onConflictDoNothing();
  }
  if (claimRelationshipIds.length > 0) {
    await db
      .insert(debateClusterRelationships)
      .values(claimRelationshipIds.map((claimRelationshipId) => ({ clusterId, claimRelationshipId })))
      .onConflictDoNothing();
  }
}
