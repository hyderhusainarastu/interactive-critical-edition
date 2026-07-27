import {
  AUTO_APPROVE_MAX_CHUNKS,
  CLAIM_EXTRACTION_PROMPT_VERSION,
  CLUSTER_NAMING_PROMPT_VERSION,
  EVIDENCE_CHAMBER_PROMPT_VERSION,
  HARD_STOP_MAX_CHUNKS,
  JUDGE_PROMPT_VERSION,
  RETRIEVAL_LIMITS,
  assertValidScope,
  parseClusterDebatesScope,
  parseDetectRelationshipsScope,
  parseExtractClaimsScope,
  planExtractionChunks,
  planResearchJob,
  TAXONOMY_VERSION_CLAIMS,
  type ExistingResearchRequest,
  type ExtractionBlock,
  type ResearchJobPlan,
} from "@ice/claims";
import {
  db,
  debateClusters,
  documents,
  enqueueAnalyzeClaimDebates,
  enqueueExtractResearchClaims,
  enqueueSynthesizeResearch,
  pages,
  processingRuns,
  researchCorpusItems,
  researchJobRequests,
  researchProjectMembers,
  textBlocks,
  works,
} from "@ice/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getResearchPipelineOverview } from "./pipeline";
import { getOwnedResearchProject } from "./projects";

/**
 * Dispatch and listing for `research_job_request` (Phase 28.1, extended by
 * the Phase 30 gap-fix lane). Every `research_job_type` the DB enum defines
 * now has a web dispatcher: `extract_claims`/`synthesize_chamber` (this
 * file), `generate_hypotheses` (`hypotheses.ts`), `import_corpus`
 * (`corpus.ts`), `run_monitor` (`monitors.ts`), and — as of this lane —
 * `detect_relationships`/`cluster_debates` below, whose worker handlers
 * (`apps/worker/src/research/detectRelationships.ts`/`clusterDebates.ts`)
 * had been canary-proven and dispatchable only via direct DB seeding in
 * worker integration tests, with no way to reach them from the product at
 * all — the center of the research chain (plan §Pipeline "Extract claims →
 * Detect relationships → Cluster debates → Chambers / Hypotheses") was
 * unreachable from the UI until now.
 */

// Mirrors `apps/worker/src/research/extractClaims.ts`'s own
// `CHUNK_COST_ESTIMATE_USD` — duplicated deliberately (this is a
// pre-dispatch cost PREVIEW for the confirmation-gate decision, not the
// worker's own authoritative accounting, which logs real per-call costs to
// `ai_usage_log`).
const CHUNK_COST_ESTIMATE_USD = 0.01;

// AUTO_APPROVE_MAX_CHUNKS / HARD_STOP_MAX_CHUNKS now live in
// `@ice/claims`'s `limits.ts` (moved there so any future caller shares the
// same numbers instead of re-guessing them) — imported above.

async function loadEligibleBlocksForWork(workId: string): Promise<ExtractionBlock[] | null> {
  const [document] = await db.select({ id: documents.id }).from(documents).where(eq(documents.workId, workId)).limit(1);
  if (!document) return null;
  const [run] = await db
    .select({ id: processingRuns.id })
    .from(processingRuns)
    .where(and(eq(processingRuns.documentId, document.id), eq(processingRuns.isPublished, true)))
    .limit(1);
  if (!run) return null;
  const rows = await db
    .select({ id: textBlocks.id, text: textBlocks.text })
    .from(textBlocks)
    .innerJoin(pages, eq(textBlocks.pageId, pages.id))
    .where(and(eq(pages.runId, run.id), eq(textBlocks.kind, "body")))
    .orderBy(asc(pages.pageIndex), asc(textBlocks.blockOrder));
  // Section labels aren't reconstructed here (unlike the worker's own
  // `loadWorkExtractionScope`) — this is a chunk-COUNT estimate for the
  // confirmation gate, and `planExtractionChunks`'s chunk count is driven
  // almost entirely by total character volume, not section boundaries.
  return rows.map((r) => ({ id: r.id, kind: "body", sectionLabel: "", text: r.text }));
}

export type DispatchExtractClaimsResult =
  | { action: "not_found" }
  | { action: "not_member"; reason: string }
  | { action: "no_published_edition"; reason: string }
  | { action: "no_extractable_text"; reason: string }
  | { action: "reused"; requestId: string }
  | { action: "queued"; requestId: string; estimatedCostUsd: number }
  | { action: "conflict"; reason: string }
  | { action: "needs_confirmation"; reason: string; estimatedCostUsd: number; estimatedUnits: number };

function mapStatusForPlanner(status: string): ExistingResearchRequest["status"] {
  if (status === "planned" || status === "queued") return "created";
  if (status === "running") return "active";
  if (status === "failed") return "failed";
  return "completed"; // complete | cancelled — neither reusable nor conflicting either way
}

/**
 * The "Extract claims" action a project's overview panel offers per
 * central/supporting work member. Validates project ownership and real
 * membership, estimates cost via the same map-reduce chunk planner the
 * worker uses, then routes through `planResearchJob()`'s
 * reuse/enqueue/conflict/needs_confirmation decision exactly as the plan
 * describes.
 */
export async function dispatchExtractClaimsJob(
  userId: string,
  projectId: string,
  workId: string,
  confirm = false,
): Promise<DispatchExtractClaimsResult> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return { action: "not_found" };

  const [member] = await db
    .select({ role: researchProjectMembers.role })
    .from(researchProjectMembers)
    .where(and(eq(researchProjectMembers.projectId, projectId), eq(researchProjectMembers.workId, workId), eq(researchProjectMembers.memberType, "work")))
    .limit(1);
  if (!member) return { action: "not_member", reason: "That work is not a member of this project." };
  if (member.role === "background") {
    return { action: "not_member", reason: "Claim extraction runs on central or supporting members, not background context." };
  }

  const [work] = await db.select({ id: works.id }).from(works).where(and(eq(works.id, workId), eq(works.userId, userId))).limit(1);
  if (!work) return { action: "not_found" };

  const blocks = await loadEligibleBlocksForWork(workId);
  if (blocks === null) return { action: "no_published_edition", reason: "This work has no published edition to extract claims from yet." };
  const plan = planExtractionChunks(blocks);
  if (plan.chunks.length === 0) return { action: "no_extractable_text", reason: "This work's published edition has no body text to extract claims from." };

  // `planningScope` feeds ONLY `planResearchJob`'s idempotency-key hash
  // (`@ice/claims`'s own `ResearchJobScope` shape, `{workIds, detail}`) — it
  // is NEVER what gets written to `research_job_request.scope` itself. Those
  // two used to be conflated (the same object, reused for both purposes),
  // which is exactly what D-25-14 was: the worker's `extractClaims()` parses
  // the canonical `@ice/claims` scope contract (`{workId}` singular), so a
  // stored `{workIds: [...]}` (plural, array) silently failed to parse and
  // fell into a misleading "corpus-item path not implemented" error for an
  // ordinary uploaded-work extraction. `dbScope` below is the ACTUAL stored
  // value, built and validated against that same canonical contract.
  const planningScope = { workIds: [workId] };
  const dbScope = assertValidScope(parseExtractClaimsScope({ workId }), "extract_claims");
  const versions = { taxonomyVersion: TAXONOMY_VERSION_CLAIMS, promptVersion: CLAIM_EXTRACTION_PROMPT_VERSION };

  // `planResearchJob` compares each existing request's OWN stored
  // idempotency key against the freshly-computed one — it does not
  // recompute a prior row's key from current versions (an old row may
  // predate a prompt/taxonomy bump), so the key has to be selected directly.
  const existingWithKeys = await db
    .select({ id: researchJobRequests.id, status: researchJobRequests.status, idempotencyKey: researchJobRequests.idempotencyKey, createdAt: researchJobRequests.createdAt })
    .from(researchJobRequests)
    .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.jobType, "extract_claims")));
  const existingRequests: ExistingResearchRequest[] = existingWithKeys.map((r) => ({
    id: r.id,
    jobType: "claim_extraction",
    idempotencyKey: r.idempotencyKey,
    status: mapStatusForPlanner(r.status),
    requestedAt: r.createdAt,
  }));

  const estimatedCostUsd = plan.chunks.length * CHUNK_COST_ESTIMATE_USD;
  const jobPlan: ResearchJobPlan = planResearchJob({
    jobType: "claim_extraction",
    scope: planningScope,
    versions,
    existingRequests,
    estimatedUnits: plan.chunks.length,
    autoApproveMaxUnits: AUTO_APPROVE_MAX_CHUNKS,
    hardStopMaxUnits: HARD_STOP_MAX_CHUNKS,
  });

  if (jobPlan.action === "reuse") return { action: "reused", requestId: jobPlan.reusedRequestId };
  if (jobPlan.action === "conflict") return { action: "conflict", reason: jobPlan.reason };
  if (jobPlan.action === "needs_confirmation" && !confirm) {
    return { action: "needs_confirmation", reason: jobPlan.reason, estimatedCostUsd, estimatedUnits: plan.chunks.length };
  }

  const requiresConfirmation = jobPlan.action === "needs_confirmation";
  const [created] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "extract_claims",
      scope: dbScope,
      idempotencyKey: jobPlan.idempotencyKey,
      status: "queued",
      estimatedCostUsd,
      requiresConfirmation,
      confirmedAt: requiresConfirmation ? new Date() : null,
    })
    .onConflictDoNothing({
      // The unique index is PARTIAL (in-flight statuses only — see the
      // schema doc comment on `research_job_request_inflight_idempotency_unique`),
      // so the ON CONFLICT target must repeat that exact predicate or
      // Postgres can't match it to an index at all.
      target: [researchJobRequests.userId, researchJobRequests.idempotencyKey],
      where: sql`${researchJobRequests.status} in ('planned', 'queued', 'running')`,
    })
    .returning({ id: researchJobRequests.id });

  if (!created) {
    // A concurrent request won the race — reuse whatever it created rather
    // than erroring (same idempotent-retry posture as graph expansion).
    const [existing] = await db
      .select({ id: researchJobRequests.id })
      .from(researchJobRequests)
      .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.idempotencyKey, jobPlan.idempotencyKey)))
      .orderBy(desc(researchJobRequests.createdAt))
      .limit(1);
    if (existing) return { action: "reused", requestId: existing.id };
    return { action: "conflict", reason: "Could not create the extraction request; please try again." };
  }

  await enqueueExtractResearchClaims(created.id);
  return { action: "queued", requestId: created.id, estimatedCostUsd };
}

/**
 * The "Extract claims" action a project's Corpus page offers per imported
 * corpus-item member (Phase 30 fix lane, D-25-13 — the sibling of
 * `dispatchExtractClaimsJob` above for a corpus item instead of an uploaded
 * work). Always exactly ONE unit (a single abstract, one model call) — the
 * `dispatchSynthesizeChamberJob` precedent — so `needs_confirmation` is
 * structurally unreachable here, but still routed through `planResearchJob`
 * for the same reuse/conflict protection every other job type gets.
 */
export async function dispatchExtractClaimsJobForCorpusItem(
  userId: string,
  projectId: string,
  corpusItemId: string,
  confirm = false,
): Promise<DispatchExtractClaimsResult> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return { action: "not_found" };

  const [member] = await db
    .select({ role: researchProjectMembers.role })
    .from(researchProjectMembers)
    .where(and(eq(researchProjectMembers.projectId, projectId), eq(researchProjectMembers.corpusItemId, corpusItemId), eq(researchProjectMembers.memberType, "corpus_item")))
    .limit(1);
  if (!member) return { action: "not_member", reason: "That corpus item is not a member of this project." };
  if (member.role === "background") {
    return { action: "not_member", reason: "Claim extraction runs on central or supporting members, not background context." };
  }

  const [item] = await db
    .select({ id: researchCorpusItems.id, abstract: researchCorpusItems.abstract })
    .from(researchCorpusItems)
    .where(and(eq(researchCorpusItems.id, corpusItemId), eq(researchCorpusItems.userId, userId)))
    .limit(1);
  if (!item) return { action: "not_found" };
  if (!item.abstract || !item.abstract.trim()) {
    return { action: "no_extractable_text", reason: "This corpus item has no abstract to extract claims from." };
  }

  const planningScope = { workIds: [], detail: corpusItemId };
  const dbScope = assertValidScope(parseExtractClaimsScope({ corpusItemId }), "extract_claims");
  const versions = { taxonomyVersion: TAXONOMY_VERSION_CLAIMS, promptVersion: CLAIM_EXTRACTION_PROMPT_VERSION };

  const existingWithKeys = await db
    .select({ id: researchJobRequests.id, status: researchJobRequests.status, idempotencyKey: researchJobRequests.idempotencyKey, createdAt: researchJobRequests.createdAt })
    .from(researchJobRequests)
    .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.jobType, "extract_claims")));
  const existingRequests: ExistingResearchRequest[] = existingWithKeys.map((r) => ({
    id: r.id,
    jobType: "claim_extraction",
    idempotencyKey: r.idempotencyKey,
    status: mapStatusForPlanner(r.status),
    requestedAt: r.createdAt,
  }));

  const estimatedCostUsd = CHUNK_COST_ESTIMATE_USD;
  const jobPlan: ResearchJobPlan = planResearchJob({
    jobType: "claim_extraction",
    scope: planningScope,
    versions,
    existingRequests,
    estimatedUnits: 1,
    autoApproveMaxUnits: AUTO_APPROVE_MAX_CHUNKS,
    hardStopMaxUnits: HARD_STOP_MAX_CHUNKS,
  });

  if (jobPlan.action === "reuse") return { action: "reused", requestId: jobPlan.reusedRequestId };
  if (jobPlan.action === "conflict") return { action: "conflict", reason: jobPlan.reason };
  if (jobPlan.action === "needs_confirmation" && !confirm) {
    return { action: "needs_confirmation", reason: jobPlan.reason, estimatedCostUsd, estimatedUnits: 1 };
  }

  const requiresConfirmation = jobPlan.action === "needs_confirmation";
  const [created] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "extract_claims",
      scope: dbScope,
      idempotencyKey: jobPlan.idempotencyKey,
      status: "queued",
      estimatedCostUsd,
      requiresConfirmation,
      confirmedAt: requiresConfirmation ? new Date() : null,
    })
    .onConflictDoNothing({
      target: [researchJobRequests.userId, researchJobRequests.idempotencyKey],
      where: sql`${researchJobRequests.status} in ('planned', 'queued', 'running')`,
    })
    .returning({ id: researchJobRequests.id });

  if (!created) {
    const [existing] = await db
      .select({ id: researchJobRequests.id })
      .from(researchJobRequests)
      .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.idempotencyKey, jobPlan.idempotencyKey)))
      .orderBy(desc(researchJobRequests.createdAt))
      .limit(1);
    if (existing) return { action: "reused", requestId: existing.id };
    return { action: "conflict", reason: "Could not create the extraction request; please try again." };
  }

  await enqueueExtractResearchClaims(created.id);
  return { action: "queued", requestId: created.id, estimatedCostUsd };
}

export interface ResearchJobRequestListRow {
  id: string;
  jobType: string;
  status: string;
  stage: string | null;
  progressIndex: number | null;
  progressTotal: number | null;
  coverage: string | null;
  note: string | null;
  error: string | null;
  requiresConfirmation: boolean;
  scope: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Lists a project's research job requests. `research_job_request` carries no
 * `project_id` column (plan §Schema), so this filters in application code
 * against the project's own member work/corpus-item ids rather than a jsonb
 * containment query — deliberately, per `docs/PROJECT-LOG.md`'s documented
 * drizzle raw-`sql` array pitfall (`ANY($1,$2)` vs `IN`): a single-user-scale
 * row count here makes an in-memory filter both simpler and safer than a
 * jsonb operator this codebase has already been bitten by once. No monetary
 * figures are returned here (Workstream F precedent) — `estimatedCostUsd`/
 * `actualCostUsd` deliberately are NOT selected; the UI shows stage/
 * progress/coverage only.
 *
 * Scope-shape matching (Phase 30 fix lane, D-25-13/D-25-14): `extract_claims`
 * scopes by the canonical `{workId}`/`{corpusItemId}` singular keys;
 * `synthesize_chamber`/`generate_hypotheses` scope by `{projectId, ...}`
 * directly. A THIRD, legacy `{workIds: [...]}` (plural, array) match is kept
 * here too — not because any *current* dispatcher writes it (D-25-14 fixed
 * that), but so a `research_job_request` row created before the fix still
 * shows up in this listing instead of silently vanishing from the project's
 * job history.
 */
export async function listResearchJobRequestsForProject(userId: string, projectId: string): Promise<ResearchJobRequestListRow[]> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return [];
  const memberRows = await db
    .select({ workId: researchProjectMembers.workId, corpusItemId: researchProjectMembers.corpusItemId })
    .from(researchProjectMembers)
    .where(eq(researchProjectMembers.projectId, projectId));
  const memberWorkIds = new Set(memberRows.map((r) => r.workId).filter((id): id is string => id != null));
  const memberCorpusItemIds = new Set(memberRows.map((r) => r.corpusItemId).filter((id): id is string => id != null));
  if (memberWorkIds.size === 0 && memberCorpusItemIds.size === 0) return [];

  const rows = await db
    .select({
      id: researchJobRequests.id,
      jobType: researchJobRequests.jobType,
      status: researchJobRequests.status,
      stage: researchJobRequests.stage,
      progressIndex: researchJobRequests.progressIndex,
      progressTotal: researchJobRequests.progressTotal,
      coverage: researchJobRequests.coverage,
      note: researchJobRequests.note,
      error: researchJobRequests.error,
      requiresConfirmation: researchJobRequests.requiresConfirmation,
      scope: researchJobRequests.scope,
      createdAt: researchJobRequests.createdAt,
      updatedAt: researchJobRequests.updatedAt,
    })
    .from(researchJobRequests)
    .where(eq(researchJobRequests.userId, userId))
    .orderBy(desc(researchJobRequests.createdAt))
    .limit(200);

  return rows.filter((row) => {
    const scope = row.scope as { workId?: unknown; corpusItemId?: unknown; workIds?: unknown; projectId?: unknown } | null;
    if (scope?.projectId === projectId) return true;
    if (typeof scope?.workId === "string" && memberWorkIds.has(scope.workId)) return true;
    if (typeof scope?.corpusItemId === "string" && memberCorpusItemIds.has(scope.corpusItemId)) return true;
    // Legacy pre-D-25-14 shape — see this function's own doc comment.
    const legacyWorkIds = Array.isArray(scope?.workIds) ? (scope.workIds as unknown[]) : [];
    return legacyWorkIds.some((id) => typeof id === "string" && memberWorkIds.has(id));
  });
}

/**
 * The "Synthesize chamber" action a debate cluster's view offers (plan
 * §Build "a Synthesize chamber action on the debates cluster view"). Unlike
 * `dispatchExtractClaimsJob`'s size-dependent chunk estimate, a chamber
 * synthesis is always one call regardless of cluster size — `estimatedUnits:
 * 1` never approaches `AUTO_APPROVE_MAX_CHUNKS`, so this always auto-enqueues
 * rather than needing confirmation (the worker's own `CHAMBER_COST_ESTIMATE_USD`
 * ≈$0.03 stays well inside the per-run soft cap regardless).
 */
export type DispatchSynthesizeChamberResult =
  | { action: "not_found" }
  | { action: "reused"; requestId: string }
  | { action: "queued"; requestId: string }
  | { action: "conflict"; reason: string };

export async function dispatchSynthesizeChamberJob(userId: string, projectId: string, clusterId: string): Promise<DispatchSynthesizeChamberResult> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return { action: "not_found" };

  const [cluster] = await db
    .select({ id: debateClusters.id })
    .from(debateClusters)
    .where(and(eq(debateClusters.id, clusterId), eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId)))
    .limit(1);
  if (!cluster) return { action: "not_found" };

  // `detail: clusterId` is exactly `ResearchJobScope.detail`'s documented
  // purpose ("a single cluster or claim pair") — `workIds` stays empty
  // since a chamber is cluster-scoped, not work-scoped.
  const scope = { workIds: [], detail: clusterId };
  // No separate taxonomy axis exists for chamber synthesis (unlike claim
  // extraction's `TAXONOMY_VERSION_CLAIMS`) — the prompt version alone is
  // what a re-synthesis needs to key off, so it fills both fields.
  const versions = { taxonomyVersion: EVIDENCE_CHAMBER_PROMPT_VERSION, promptVersion: EVIDENCE_CHAMBER_PROMPT_VERSION };

  const existingWithKeys = await db
    .select({ id: researchJobRequests.id, status: researchJobRequests.status, idempotencyKey: researchJobRequests.idempotencyKey, createdAt: researchJobRequests.createdAt })
    .from(researchJobRequests)
    .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.jobType, "synthesize_chamber")));
  const existingRequests: ExistingResearchRequest[] = existingWithKeys.map((r) => ({
    id: r.id,
    jobType: "chamber_synthesis",
    idempotencyKey: r.idempotencyKey,
    status: mapStatusForPlanner(r.status),
    requestedAt: r.createdAt,
  }));

  const jobPlan: ResearchJobPlan = planResearchJob({
    jobType: "chamber_synthesis",
    scope,
    versions,
    existingRequests,
    estimatedUnits: 1,
    autoApproveMaxUnits: AUTO_APPROVE_MAX_CHUNKS,
    hardStopMaxUnits: HARD_STOP_MAX_CHUNKS,
  });

  if (jobPlan.action === "reuse") return { action: "reused", requestId: jobPlan.reusedRequestId };
  if (jobPlan.action === "conflict") return { action: "conflict", reason: jobPlan.reason };
  // `needs_confirmation` is structurally unreachable here (1 unit is always
  // <= AUTO_APPROVE_MAX_CHUNKS) but handled the same way `dispatchExtractClaimsJob`
  // does rather than silently assuming it can never happen if the caps
  // change later.
  if (jobPlan.action === "needs_confirmation") {
    return { action: "conflict", reason: jobPlan.reason };
  }

  const [created] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "synthesize_chamber",
      scope: { projectId, clusterId },
      idempotencyKey: jobPlan.idempotencyKey,
      status: "queued",
      estimatedCostUsd: 0.03,
      requiresConfirmation: false,
      confirmedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [researchJobRequests.userId, researchJobRequests.idempotencyKey],
      where: sql`${researchJobRequests.status} in ('planned', 'queued', 'running')`,
    })
    .returning({ id: researchJobRequests.id });

  if (!created) {
    const [existing] = await db
      .select({ id: researchJobRequests.id })
      .from(researchJobRequests)
      .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.idempotencyKey, jobPlan.idempotencyKey)))
      .orderBy(desc(researchJobRequests.createdAt))
      .limit(1);
    if (existing) return { action: "reused", requestId: existing.id };
    return { action: "conflict", reason: "Could not create the synthesis request; please try again." };
  }

  await enqueueSynthesizeResearch(created.id);
  return { action: "queued", requestId: created.id };
}

// ---------------------------------------------------------------------------
// detect_relationships / cluster_debates (Phase 30 gap-fix lane). Both are
// PROJECT-scoped (not per-work/per-cluster like the dispatchers above), share
// the `analyze-claim-debates` queue via `enqueueAnalyzeClaimDebates`
// (`packages/db/src/queue.ts`'s doc comment: "relationship detection AND
// clustering as one staged, resumable request" — the worker's own `jobType`
// switch in `apps/worker/src/index.ts` decides which handler a given message
// runs), and both use `{workIds: [], detail: projectId}` as the
// PLANNING-scope shape (the `dispatchSynthesizeChamberJob` `detail: clusterId`
// precedent) while the STORED `scope` uses the canonical `{projectId}` shape
// from `@ice/claims`'s `jobs/scope.ts` — the same planning-scope-vs-stored-
// scope split `dispatchExtractClaimsJob`'s own doc comment explains (D-25-14
// was exactly this distinction getting conflated).
// ---------------------------------------------------------------------------

export type DispatchDetectRelationshipsResult =
  | { action: "not_found" }
  | { action: "not_ready"; reason: string }
  | { action: "reused"; requestId: string }
  | { action: "queued"; requestId: string; estimatedCostUsd: number }
  | { action: "conflict"; reason: string }
  | { action: "needs_confirmation"; reason: string; estimatedCostUsd: number; estimatedUnits: number };

// Mirrors `apps/worker/src/research/detectRelationships.ts`'s own
// `JUDGE_COST_ESTIMATE_USD` — duplicated deliberately, the same
// `CHUNK_COST_ESTIMATE_USD` precedent at the top of this file (this is a
// pre-dispatch cost PREVIEW, not the worker's own authoritative accounting).
const JUDGE_COST_ESTIMATE_USD = 0.01;

/**
 * The "Detect relationships" action a project overview offers once at least
 * two work members have each contributed claims (mirrors
 * `pipelineSteps.ts`'s own `workCountWithClaims < 2` gate, reusing
 * `getResearchPipelineOverview()` so the precondition can never drift from
 * what the stepper displays).
 *
 * True per-run cost isn't knowable before Stage 1 actually retrieves
 * candidates: dense/BM25/locus retrieval and the citation-engagement pre-join
 * are $0 and always run first; only the paid judge stage that follows costs
 * anything, and it operates over whatever Stage 1 finds THIS run plus any
 * candidate stranded unjudged by a PRIOR run. `RETRIEVAL_LIMITS.maxJudgedPairsPerRequest`
 * is the worker's own hard per-run ceiling on how many pairs one request will
 * ever send to the judge (`detectRelationships.ts`'s own doc comment) — using
 * that as the confirmation-gate `estimatedUnits` is a genuine worst-case
 * bound, not a guess: a real run typically judges far fewer (candidates
 * already judged under an unchanged basis hash cost $0 and are skipped), so
 * this estimate only ever overstates cost, never understates it. Since it's a
 * fixed constant above `planResearchJob`'s default 20-unit auto-approve
 * threshold, this action deliberately always routes through
 * `needs_confirmation` on a first click — a deliberate, explained trade-off
 * (an exact estimate isn't available), not an oversight.
 */
export async function dispatchDetectRelationshipsJob(
  userId: string,
  projectId: string,
  confirm = false,
): Promise<DispatchDetectRelationshipsResult> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return { action: "not_found" };

  const overview = await getResearchPipelineOverview(userId, projectId);
  if (overview.workCountWithClaims < 2) {
    return { action: "not_ready", reason: "Detecting relationships needs claims from at least two works in this project." };
  }

  const planningScope = { workIds: [], detail: projectId };
  const dbScope = assertValidScope(parseDetectRelationshipsScope({ projectId }), "detect_relationships");
  const versions = { taxonomyVersion: JUDGE_PROMPT_VERSION, promptVersion: JUDGE_PROMPT_VERSION };

  const existingWithKeys = await db
    .select({ id: researchJobRequests.id, status: researchJobRequests.status, idempotencyKey: researchJobRequests.idempotencyKey, createdAt: researchJobRequests.createdAt })
    .from(researchJobRequests)
    .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.jobType, "detect_relationships")));
  const existingRequests: ExistingResearchRequest[] = existingWithKeys.map((r) => ({
    id: r.id,
    jobType: "judge_scan",
    idempotencyKey: r.idempotencyKey,
    status: mapStatusForPlanner(r.status),
    requestedAt: r.createdAt,
  }));

  const estimatedUnits = RETRIEVAL_LIMITS.maxJudgedPairsPerRequest;
  const estimatedCostUsd = estimatedUnits * JUDGE_COST_ESTIMATE_USD;
  const jobPlan: ResearchJobPlan = planResearchJob({
    jobType: "judge_scan",
    scope: planningScope,
    versions,
    existingRequests,
    estimatedUnits,
  });

  if (jobPlan.action === "reuse") return { action: "reused", requestId: jobPlan.reusedRequestId };
  if (jobPlan.action === "conflict") return { action: "conflict", reason: jobPlan.reason };
  if (jobPlan.action === "needs_confirmation" && !confirm) {
    return { action: "needs_confirmation", reason: jobPlan.reason, estimatedCostUsd, estimatedUnits };
  }

  const requiresConfirmation = jobPlan.action === "needs_confirmation";
  const [created] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "detect_relationships",
      scope: dbScope,
      idempotencyKey: jobPlan.idempotencyKey,
      status: "queued",
      estimatedCostUsd,
      requiresConfirmation,
      confirmedAt: requiresConfirmation ? new Date() : null,
    })
    .onConflictDoNothing({
      target: [researchJobRequests.userId, researchJobRequests.idempotencyKey],
      where: sql`${researchJobRequests.status} in ('planned', 'queued', 'running')`,
    })
    .returning({ id: researchJobRequests.id });

  if (!created) {
    const [existing] = await db
      .select({ id: researchJobRequests.id })
      .from(researchJobRequests)
      .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.idempotencyKey, jobPlan.idempotencyKey)))
      .orderBy(desc(researchJobRequests.createdAt))
      .limit(1);
    if (existing) return { action: "reused", requestId: existing.id };
    return { action: "conflict", reason: "Could not create the relationship-detection request; please try again." };
  }

  await enqueueAnalyzeClaimDebates(created.id);
  return { action: "queued", requestId: created.id, estimatedCostUsd };
}

export type DispatchClusterDebatesResult =
  | { action: "not_found" }
  | { action: "not_ready"; reason: string }
  | { action: "reused"; requestId: string }
  | { action: "queued"; requestId: string; estimatedCostUsd: number }
  | { action: "conflict"; reason: string }
  | { action: "needs_confirmation"; reason: string; estimatedCostUsd: number; estimatedUnits: number };

// Mirrors `apps/worker/src/research/clusterDebates.ts`'s own
// `NAMING_COST_ESTIMATE_USD` — duplicated deliberately, same precedent.
const NAMING_COST_ESTIMATE_USD = 0.005;

/**
 * The "Cluster debates" action a project overview offers once at least one
 * relationship has been judged (mirrors `pipelineSteps.ts`'s own
 * `!detectDone` gate — `relationshipCount === 0` — via
 * `getResearchPipelineOverview()`).
 *
 * Every NEW cluster a run could name is bounded by the number of judged
 * relationships in scope (a cluster needs at least one edge to exist at
 * all — `findClaimClusters`'s own connected-components definition), so
 * `overview.relationshipCount` is a real, DB-grounded worst-case bound on
 * `estimatedUnits`, not a guess. Actual cost is typically far lower: an
 * unchanged cluster membership skips naming entirely ($0, `member_hash`
 * reuse) and the worker's own budget cap (`overSoftCap`) falls back to a $0
 * deterministic name rather than ever blocking a run outright — a cluster is
 * never left unnamed and a run is never left half-done for lack of budget.
 */
export async function dispatchClusterDebatesJob(
  userId: string,
  projectId: string,
  confirm = false,
): Promise<DispatchClusterDebatesResult> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return { action: "not_found" };

  const overview = await getResearchPipelineOverview(userId, projectId);
  if (overview.relationshipCount < 1) {
    return { action: "not_ready", reason: "Clustering debates needs at least one judged relationship in this project." };
  }

  const planningScope = { workIds: [], detail: projectId };
  const dbScope = assertValidScope(parseClusterDebatesScope({ projectId }), "cluster_debates");
  const versions = { taxonomyVersion: CLUSTER_NAMING_PROMPT_VERSION, promptVersion: CLUSTER_NAMING_PROMPT_VERSION };

  const existingWithKeys = await db
    .select({ id: researchJobRequests.id, status: researchJobRequests.status, idempotencyKey: researchJobRequests.idempotencyKey, createdAt: researchJobRequests.createdAt })
    .from(researchJobRequests)
    .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.jobType, "cluster_debates")));
  const existingRequests: ExistingResearchRequest[] = existingWithKeys.map((r) => ({
    id: r.id,
    jobType: "cluster_naming",
    idempotencyKey: r.idempotencyKey,
    status: mapStatusForPlanner(r.status),
    requestedAt: r.createdAt,
  }));

  const estimatedUnits = overview.relationshipCount;
  const estimatedCostUsd = estimatedUnits * NAMING_COST_ESTIMATE_USD;
  const jobPlan: ResearchJobPlan = planResearchJob({
    jobType: "cluster_naming",
    scope: planningScope,
    versions,
    existingRequests,
    estimatedUnits,
  });

  if (jobPlan.action === "reuse") return { action: "reused", requestId: jobPlan.reusedRequestId };
  if (jobPlan.action === "conflict") return { action: "conflict", reason: jobPlan.reason };
  if (jobPlan.action === "needs_confirmation" && !confirm) {
    return { action: "needs_confirmation", reason: jobPlan.reason, estimatedCostUsd, estimatedUnits };
  }

  const requiresConfirmation = jobPlan.action === "needs_confirmation";
  const [created] = await db
    .insert(researchJobRequests)
    .values({
      userId,
      jobType: "cluster_debates",
      scope: dbScope,
      idempotencyKey: jobPlan.idempotencyKey,
      status: "queued",
      estimatedCostUsd,
      requiresConfirmation,
      confirmedAt: requiresConfirmation ? new Date() : null,
    })
    .onConflictDoNothing({
      target: [researchJobRequests.userId, researchJobRequests.idempotencyKey],
      where: sql`${researchJobRequests.status} in ('planned', 'queued', 'running')`,
    })
    .returning({ id: researchJobRequests.id });

  if (!created) {
    const [existing] = await db
      .select({ id: researchJobRequests.id })
      .from(researchJobRequests)
      .where(and(eq(researchJobRequests.userId, userId), eq(researchJobRequests.idempotencyKey, jobPlan.idempotencyKey)))
      .orderBy(desc(researchJobRequests.createdAt))
      .limit(1);
    if (existing) return { action: "reused", requestId: existing.id };
    return { action: "conflict", reason: "Could not create the debate-clustering request; please try again." };
  }

  await enqueueAnalyzeClaimDebates(created.id);
  return { action: "queued", requestId: created.id, estimatedCostUsd };
}
