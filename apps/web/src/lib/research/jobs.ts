import {
  AUTO_APPROVE_MAX_CHUNKS,
  CLAIM_EXTRACTION_PROMPT_VERSION,
  HARD_STOP_MAX_CHUNKS,
  planExtractionChunks,
  planResearchJob,
  TAXONOMY_VERSION_CLAIMS,
  type ExistingResearchRequest,
  type ExtractionBlock,
  type ResearchJobPlan,
} from "@ice/claims";
import {
  db,
  documents,
  enqueueExtractResearchClaims,
  pages,
  processingRuns,
  researchJobRequests,
  researchProjectMembers,
  textBlocks,
  works,
} from "@ice/db";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getOwnedResearchProject } from "./projects";

/**
 * Dispatch and listing for `research_job_request` (Phase 28.1). This lane
 * only wires up `extract_claims` — the only job type with a worker handler
 * shipped so far (Phase 26.1). The other six `research_job_type` values
 * exist in the DB enum for later phases (26.2 relationships, 26.3
 * clustering, 27.x synthesis, 28.2 corpus import, 29.1 monitors) but have no
 * worker handler yet, so dispatching them here would queue a message no
 * worker will ever pick up — an honest `not_supported` result short-circuits
 * that rather than silently accepting it.
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

  const scope = { workIds: [workId] };
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
    scope,
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
      scope,
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
 * `project_id` column (it's scoped by `scope.workIds` — plan §Schema), so
 * this filters in application code against the project's own member work
 * ids rather than a jsonb containment query — deliberately, per
 * `docs/PROJECT-LOG.md`'s documented drizzle raw-`sql` array pitfall
 * (`ANY($1,$2)` vs `IN`): a single-user-scale row count here makes an
 * in-memory filter both simpler and safer than a jsonb operator this
 * codebase has already been bitten by once. No monetary figures are
 * returned here (Workstream F precedent) — `estimatedCostUsd`/
 * `actualCostUsd` deliberately are NOT selected; the UI shows stage/
 * progress/coverage only.
 */
export async function listResearchJobRequestsForProject(userId: string, projectId: string): Promise<ResearchJobRequestListRow[]> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return [];
  const memberWorkIds = new Set(
    (await db.select({ workId: researchProjectMembers.workId }).from(researchProjectMembers).where(eq(researchProjectMembers.projectId, projectId)))
      .map((r) => r.workId)
      .filter((id): id is string => id != null),
  );
  if (memberWorkIds.size === 0) return [];

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
    const scope = row.scope as { workIds?: unknown } | null;
    const workIds = Array.isArray(scope?.workIds) ? (scope.workIds as unknown[]) : [];
    return workIds.some((id) => typeof id === "string" && memberWorkIds.has(id));
  });
}
