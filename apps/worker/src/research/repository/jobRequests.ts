import { aiUsageLogs, db, researchJobRequests, type researchJobCoverageEnum } from "@ice/db";
import { and, eq, ne, sql } from "drizzle-orm";

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
  /** Added for Phase 27.2's `generate_hypotheses` job-level idempotency
   *  short-circuit (`generateHypotheses.ts`'s doc comment on why a
   *  whole-job "repeat run costs $0" guarantee needs this, distinct from
   *  `research_hypothesis.run_hash`'s own row-level dedup) — additive, every
   *  other handler simply ignores the field. */
  idempotencyKey: string;
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
      idempotencyKey: researchJobRequests.idempotencyKey,
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

/** Whether ANOTHER `research_job_request` (not this one) of the same job
 *  type, for this user, already COMPLETED under the exact same idempotency
 *  key — `generateHypotheses.ts`'s own job-level "repeat run costs $0"
 *  short-circuit. Deliberately narrower than `planResearchJob`'s own
 *  "reuse" action (which only recognizes an IN-FLIGHT duplicate): hypothesis
 *  generation's output is fully determined by its input scope (an unchanged
 *  conflict set + question + versions can never legitimately produce a
 *  "better" result on a second try, unlike e.g. re-extracting claims from a
 *  work whose text might have changed), so a genuinely completed identical
 *  run is treated as done, not just as "already queued". */
export async function hasCompletedResearchJobRequestWithIdempotencyKey(
  userId: string,
  jobType: string,
  idempotencyKey: string,
  excludeRequestId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: researchJobRequests.id })
    .from(researchJobRequests)
    .where(
      and(
        eq(researchJobRequests.userId, userId),
        eq(researchJobRequests.jobType, jobType as (typeof researchJobRequests.$inferInsert)["jobType"]),
        eq(researchJobRequests.idempotencyKey, idempotencyKey),
        eq(researchJobRequests.status, "complete"),
        ne(researchJobRequests.id, excludeRequestId),
      ),
    )
    .limit(1);
  return Boolean(row);
}
