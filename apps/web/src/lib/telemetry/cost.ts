import { aiUsageLogs, db } from "@ice/db";
import { eq, sql } from "drizzle-orm";

/**
 * Per-run, per-module AI cost breakdown (plan §34.4 9.7: "cost estimate and
 * actual, per run and per module"). Needs no new tracking — `ai_usage_log`
 * already carries `runId`/`stage`/`estimatedCostUsd` for every call the
 * pipeline logs (`apps/worker/src/analyze.ts`'s `logUsage()`), so the
 * "actual, per module" half of the requirement is just a grouped read over
 * data that already exists. `processing_run.aiCostUsd` stays the
 * authoritative single total (unchanged, still what the reader's top-line
 * "AI cost $X" reads); this is the itemized detail behind it.
 */
export interface CostBreakdownRow {
  stage: string | null;
  task: string;
  costUsd: number;
  calls: number;
  promptTokens: number;
  completionTokens: number;
}

export async function getRunCostBreakdown(runId: string): Promise<CostBreakdownRow[]> {
  const rows = await db
    .select({
      stage: aiUsageLogs.stage,
      task: aiUsageLogs.task,
      costUsd: sql<number>`sum(${aiUsageLogs.estimatedCostUsd})`,
      calls: sql<number>`count(*)`,
      promptTokens: sql<number>`sum(${aiUsageLogs.promptTokens})`,
      completionTokens: sql<number>`sum(${aiUsageLogs.completionTokens})`,
    })
    .from(aiUsageLogs)
    .where(eq(aiUsageLogs.runId, runId))
    .groupBy(aiUsageLogs.stage, aiUsageLogs.task);

  return rows
    .map((r) => ({
      stage: r.stage,
      task: r.task,
      costUsd: Number(r.costUsd),
      calls: Number(r.calls),
      promptTokens: Number(r.promptTokens),
      completionTokens: Number(r.completionTokens),
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
}
