import { charge, makeBudget, type CostBudget } from "@ice/research";
import { estimateCostUsd } from "@ice/ai-adapters";
import { reportError } from "@ice/observability";
import * as repo from "./repository";

/**
 * Shared research-job lifecycle (Phase 25.6/26.1) — the `analyze.ts`
 * crash-safety/budget/usage-logging idiom transplanted from the edition
 * pipeline onto `research_job_request`. Every research job type (extraction
 * first, relationships/clustering/synthesis/corpus-import later) runs
 * through this ONE function so the budget discipline, heartbeat, and
 * terminal-status bookkeeping are never re-implemented per job type.
 */

export interface ResearchJobRunContext {
  request: repo.ResearchJobRequestRow;
  budget: CostBudget;
  /** Human-readable current stage (`research_job_request.stage`), mirroring
   *  `processing_run.stage`'s live-progress role. */
  setStage(stage: string, progress?: { index: number; total: number }): Promise<void>;
  /** Records one model/embedding call's cost against the budget and queues
   *  a usage-log row (flushed in batches of 5, plus one explicit flush on
   *  each terminal path below — the success branch and the catch branch —
   *  rather than a single `finally`, so the two paths can persist different
   *  outcome rows around the same flush call; the `analyze.ts`
   *  `flushUsageLogs`/`USAGE_FLUSH_BATCH_SIZE` idiom). Awaited so the batch
   *  flush can actually happen inline; never drops a log entry, only defers
   *  when it writes it. */
  logUsage(input: {
    task: string;
    stage: string;
    provider: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    /** Use for a non-token-priced cost (e.g. embeddings, priced per input token but via a different formula) instead of `estimateCostUsd`. */
    costOverride?: number;
  }): Promise<void>;
  /** Force an immediate flush — called once more by the runner itself after
   *  the handler returns, so nothing queued but not yet at the batch
   *  threshold is lost even on a clean success. */
  flushUsageLogs(): Promise<void>;
}

export interface ResearchJobOutcome {
  coverage: repo.ResearchJobCoverage;
  note?: string | null;
}

const USAGE_FLUSH_BATCH_SIZE = 5;

/**
 * Runs one research job request end-to-end. Idempotent against redelivery:
 * an already-`complete`/`cancelled` request is a silent no-op (the work is
 * either done or was explicitly stopped); an already-`failed` request is
 * re-attempted (pg-boss's own retry is the recovery path for a transient
 * fault, and the budget seed below means a retry never re-pays for spend a
 * prior crashed attempt already logged).
 */
export async function runResearchJob(
  requestId: string,
  handler: (ctx: ResearchJobRunContext) => Promise<ResearchJobOutcome>,
): Promise<void> {
  const request = await repo.getResearchJobRequest(requestId);
  if (!request) {
    // Same class as the stale extract-text/analyze-work jobs D-19-2
    // addressed: a request row deleted after enqueue. Nothing to record,
    // nothing is wrong.
    console.warn(`[worker] research job ${requestId} not found; skipping`);
    return;
  }
  if (request.status === "complete" || request.status === "cancelled") return;

  // Defense in depth: a request gated on confirmation must never run just
  // because it was (re)dequeued — the enqueue-time check is not the only
  // thing standing between "needs a human yes" and real spend. Refuse
  // outright rather than silently completing; the handler is never invoked.
  if (request.requiresConfirmation && !request.confirmedAt) {
    await repo.markResearchJobFailed(requestId, { actualCostUsd: 0, error: "awaiting confirmation" });
    return;
  }

  await repo.markResearchJobRunning(requestId);

  // Crash-loop-proof budget (the `analyze.ts` `seededUsd` idiom): seed from
  // every `ai_usage_log` row already attributed to THIS request id, so a
  // pg-boss retry after a crash never re-spends up to the hard cap on every
  // attempt. Unlike `analyze.ts`'s document/episode-scoping complexity, a
  // `research_job_request` row's own id already IS the natural episode
  // boundary — no version floor is needed.
  const seededUsd = await repo.sumPriorUsageForRequest(requestId);
  const budget = makeBudget();
  if (seededUsd > 0) charge(budget, seededUsd);

  const pendingLogs: repo.PendingResearchUsageLog[] = [];
  let flushedCount = 0;
  const flushUsageLogs = async () => {
    const pending = pendingLogs.slice(flushedCount);
    if (!pending.length) return;
    await repo.insertUsageLogs(pending);
    flushedCount = pendingLogs.length;
  };

  const logUsage: ResearchJobRunContext["logUsage"] = async (input) => {
    const cost = input.costOverride ?? estimateCostUsd(input.model, input.promptTokens, input.completionTokens);
    charge(budget, cost);
    pendingLogs.push({
      researchRequestId: requestId,
      task: input.task,
      stage: input.stage,
      provider: input.provider,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      estimatedCostUsd: cost,
    });
    if (pendingLogs.length - flushedCount >= USAGE_FLUSH_BATCH_SIZE) await flushUsageLogs();
  };

  const setStage: ResearchJobRunContext["setStage"] = async (stage, progress) => {
    await repo.setResearchJobStage(requestId, stage, progress);
  };

  try {
    const outcome = await handler({ request, budget, setStage, logUsage, flushUsageLogs });
    await flushUsageLogs();
    await repo.markResearchJobComplete(requestId, { actualCostUsd: budget.spentUsd, coverage: outcome.coverage, note: outcome.note ?? null });
  } catch (error) {
    // Crash safety: whatever `pendingLogs` accumulated before the throw is
    // still persisted, and the budget's true cumulative spend (including
    // this attempt) is recorded on the failed row — the same guarantee
    // `analyze.ts`'s try/finally usage-flush gives the edition pipeline.
    await flushUsageLogs().catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    await repo.markResearchJobFailed(requestId, { actualCostUsd: budget.spentUsd, error: message });
    reportError(error, { scope: "worker.researchJob", requestId, jobType: request.jobType });
    throw error;
  }
}
