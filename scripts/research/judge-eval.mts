/**
 * Phase 25.5 Spike B — judge-model ladder eval.
 *
 * Runs the ported ScholarLens contradiction-judge prompt
 * (packages/claims/src/prompts/judge.ts, empirical branch, no engagement
 * context) over the 42 empirical gold pairs at three cost rungs — gpt-5.4-nano,
 * gpt-5.4-mini (both via OpenAIResponsesClient), and claude-haiku-4-5 (via the
 * new AnthropicStructuredClient) — scores each rung against
 * packages/claims/src/eval/{metrics,gates,split}.ts, then runs a small
 * robustness sub-check and a humanities baseline on the cheapest rung that
 * clears the gates.
 *
 * Run: npx tsx scripts/research/judge-eval.mts
 * Cost: budgeted <=$0.25 (see docs/eval/research-claims/spike-25-5-judge.md
 * for the real, measured total).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadWorkerEnv } from "./env.mjs";
import { OpenAIResponsesClient } from "../../packages/ai-adapters/src/responses";
import { AnthropicStructuredClient } from "../../packages/ai-adapters/src/anthropicStructured";
import { estimateCostUsd } from "../../packages/ai-adapters/src/routing";
import { buildJudgePrompt, validateJudgeResponse, type EngagementContext, type JudgeResult } from "../../packages/claims/src/prompts/judge";
import { CLAIM_RELATION_VALENCES, CLAIM_RELATION_CATEGORIES, STAGE2_MECHANISMS } from "../../packages/claims/src/taxonomy";
import { parseGoldRelationshipPairsFile, type GoldRelationshipPair } from "../../packages/claims/src/eval/goldSchema";
import { confusionMatrix, perClassPRF1, macroF1, cohenKappa, binaryTensionF1, perDomainMacroF1 } from "../../packages/claims/src/eval/metrics";
import { splitItems } from "../../packages/claims/src/eval/split";
import {
  JUDGE_VALENCE_MACRO_F1_MIN,
  JUDGE_KAPPA_MIN,
  JUDGE_CONTRADICTION_RECALL_MIN,
  CLASS_F1_FLOOR,
} from "../../packages/claims/src/eval/gates";

loadWorkerEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLD_DIR = join(__dirname, "../../packages/claims/src/eval/gold");
const OUT_DIR = join(__dirname, "../../docs/eval/research-claims");

// ── Structured-output schema (shared shape for both providers) ─────────
// OpenAI's `strict: true` json_schema mode requires every property listed
// in `required` (no "optional-by-omission") — `mechanism` is therefore a
// nullable string rather than an omittable field; `validateJudgeResponse`
// already drops an invalid mechanism-for-valence pairing to null regardless
// of what the model returns here (packages/claims/src/prompts/judge.ts).
const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    relationship: { type: "string", enum: [...CLAIM_RELATION_VALENCES] },
    category: { type: "string", enum: [...CLAIM_RELATION_CATEGORIES] },
    explanation: { type: "string" },
    strongerEvidence: { type: "string", enum: ["paper_a", "paper_b", "neither"] },
    mechanism: { type: ["string", "null"], enum: [...STAGE2_MECHANISMS, null] },
    resolution: { type: "string" },
  },
  required: ["relationship", "category", "explanation", "strongerEvidence", "mechanism", "resolution"],
  additionalProperties: false,
} as const;

const JUDGE_SYSTEM = "You are a careful academic peer-reviewer comparing two research claims from different works. Follow the instructions exactly and return only the requested structured fields.";

type RungId = "gpt-5.4-nano" | "gpt-5.4-mini" | "claude-haiku-4-5";

interface Rung {
  id: RungId;
  provider: "openai" | "anthropic";
  model: string;
}

// Cost ladder order — cheapest first, matching TASK_ROUTES/PRICE_PER_MTOK
// in packages/ai-adapters/src/routing.ts (nano < mini < haiku on both input
// and output price per token).
const RUNGS: Rung[] = [
  { id: "gpt-5.4-nano", provider: "openai", model: "gpt-5.4-nano" },
  { id: "gpt-5.4-mini", provider: "openai", model: "gpt-5.4-mini" },
  { id: "claude-haiku-4-5", provider: "anthropic", model: "claude-haiku-4-5-20251001" },
];

const openaiClient = new OpenAIResponsesClient();
const anthropicClient = new AnthropicStructuredClient();

interface JudgeCallRecord {
  id: string;
  domain: string;
  goldLabel: string;
  predicted: JudgeResult | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  error?: string;
}

let runningCostUsd = 0;
const costLedger: { stage: string; rung: string; costUsd: number; calls: number }[] = [];

// Real-time budget guard. The task budgets Spike B at <=$0.25 (of a $0.35
// total across both spikes); a smoke test measured real per-call costs
// (nano ~$0.0004, haiku ~$0.003 — Anthropic's tokenizer counts materially
// more prompt tokens for the same text than OpenAI's, so haiku is the
// expensive rung, not just a fixed multiplier). A conservative per-call cap
// (padded above the smoke-test measurement) is checked before every
// dispatch so a worse-than-expected rung can't blow through the ceiling —
// remaining items in a stage are marked "skipped-budget" rather than
// silently omitted, and the report says so explicitly.
const SPIKE_B_BUDGET_CEILING_USD = 0.25;
const PER_CALL_COST_CAP: Record<string, number> = {
  "gpt-5.4-nano": 0.0015,
  "gpt-5.4-mini": 0.004,
  "claude-haiku-4-5": 0.007,
};

function withinBudget(rungId: string): boolean {
  const cap = PER_CALL_COST_CAP[rungId] ?? 0.007;
  return runningCostUsd + cap <= SPIKE_B_BUDGET_CEILING_USD;
}

async function callJudge(
  rung: Rung,
  claimA: { text: string; workTitle: string },
  claimB: { text: string; workTitle: string },
  branch: "empirical" | "humanities",
  engagement?: EngagementContext,
): Promise<{ result: JudgeResult; promptTokens: number; completionTokens: number; costUsd: number }> {
  const prompt = buildJudgePrompt({ claimA, claimB, branch, engagement });
  if (rung.provider === "openai") {
    const res = await openaiClient.call<JudgeResult>({
      model: rung.model,
      system: JUDGE_SYSTEM,
      input: prompt,
      schema: JUDGE_SCHEMA,
      schemaName: "judge_relationship",
      maxOutputTokens: 500,
      validate: (parsed) => validateJudgeResponse(parsed),
    });
    const costUsd = estimateCostUsd(rung.model, res.promptTokens, res.completionTokens);
    return { result: res.data, promptTokens: res.promptTokens, completionTokens: res.completionTokens, costUsd };
  }
  const res = await anthropicClient.call<JudgeResult>({
    model: rung.model,
    system: JUDGE_SYSTEM,
    user: prompt,
    schema: JUDGE_SCHEMA,
    schemaName: "judge_relationship",
    maxOutputTokens: 500,
    validate: (parsed) => validateJudgeResponse(parsed),
  });
  const costUsd = estimateCostUsd(rung.model, res.promptTokens, res.completionTokens);
  return { result: res.data, promptTokens: res.promptTokens, completionTokens: res.completionTokens, costUsd };
}

/** Simple bounded-concurrency map — keeps wall-clock down without hammering
 *  either provider's rate limits. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function runRungOverPairs(
  rung: Rung,
  pairs: (GoldRelationshipPair & { resolvedDomain: string })[],
  branch: "empirical" | "humanities",
  stage: string,
): Promise<JudgeCallRecord[]> {
  const records = await mapWithConcurrency(pairs, 4, async (pair): Promise<JudgeCallRecord> => {
    if (!withinBudget(rung.id)) {
      return {
        id: pair.id,
        domain: pair.resolvedDomain,
        goldLabel: pair.label,
        predicted: null,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        error: "skipped-budget",
      };
    }
    try {
      const { result, promptTokens, completionTokens, costUsd } = await callJudge(
        rung,
        { text: pair.claim_a.text, workTitle: pair.claim_a.paper_title },
        { text: pair.claim_b.text, workTitle: pair.claim_b.paper_title },
        branch,
      );
      runningCostUsd += costUsd;
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: result, promptTokens, completionTokens, costUsd };
    } catch (err) {
      return {
        id: pair.id,
        domain: pair.resolvedDomain,
        goldLabel: pair.label,
        predicted: null,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
  // NOTE: runningCostUsd is already updated per-call inside the loop above
  // (so withinBudget() sees real-time spend across concurrent dispatches) —
  // stageCost here is only a reporting rollup, not added again.
  const stageCost = records.reduce((s, r) => s + r.costUsd, 0);
  const skippedForBudget = records.filter((r) => r.error === "skipped-budget").length;
  costLedger.push({ stage, rung: rung.id, costUsd: stageCost, calls: records.length });
  console.log(
    `  [${rung.id}] ${stage}: ${records.length} calls, ${records.filter((r) => r.error).length} failed ` +
      `(${skippedForBudget} skipped-budget), $${stageCost.toFixed(6)} (running total $${runningCostUsd.toFixed(6)})`,
  );
  return records;
}

interface RungScore {
  rung: RungId;
  model: string;
  nSucceeded: number;
  nFailed: number;
  failedIds: string[];
  pooled: { macroF1: number; kappa: number; contradictionRecall: number; binaryTensionF1: number; perClass: ReturnType<typeof perClassPRF1> };
  testSplit: { n: number; macroF1: number; kappa: number; contradictionRecall: number; binaryTensionF1: number } | null;
  perDomainMacroF1: Record<string, number>;
  passedGates: boolean;
  gateDetail: { macroF1Pass: boolean; kappaPass: boolean; contradictionRecallPass: boolean; classFloorPass: boolean; classesBelowFloor: string[] };
}

function scoreRecords(records: JudgeCallRecord[]): { macroF1: number; kappa: number; contradictionRecall: number; binaryTensionF1: number; perClass: ReturnType<typeof perClassPRF1> } {
  const succeeded = records.filter((r) => r.predicted !== null);
  const yTrue = succeeded.map((r) => r.goldLabel);
  const yPred = succeeded.map((r) => r.predicted!.relationship);
  const cm = confusionMatrix(yTrue, yPred, [...CLAIM_RELATION_VALENCES]);
  const perClass = perClassPRF1(cm);
  const contradictionRow = perClass.find((c) => c.className === "contradiction");
  return {
    macroF1: macroF1(cm),
    kappa: cohenKappa(cm),
    contradictionRecall: contradictionRow?.recall ?? 0,
    binaryTensionF1: binaryTensionF1(yTrue, yPred),
    perClass,
  };
}

async function main() {
  const empiricalRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.empirical.json"), "utf8"));
  const empirical = empiricalRaw.map((p) => ({ ...p, resolvedDomain: p.domain ?? "empirical" }));
  console.log(`Loaded ${empirical.length} empirical gold pairs.`);

  const { train, test } = splitItems(empirical, 0.3);
  console.log(`Deterministic split (src/eval/split.ts, testFrac=0.3): ${train.length} train, ${test.length} test.`);
  const testIds = new Set(test.map((p) => p.id));

  const rungScores: RungScore[] = [];
  const allRecordsByRung: Record<string, JudgeCallRecord[]> = {};

  for (const rung of RUNGS) {
    console.log(`\n=== Rung: ${rung.id} (${rung.model}) ===`);
    const records = await runRungOverPairs(rung, empirical, "empirical", "main-eval-42");
    allRecordsByRung[rung.id] = records;

    const pooled = scoreRecords(records);
    const testRecords = records.filter((r) => testIds.has(r.id));
    const testScore = testRecords.filter((r) => r.predicted !== null).length > 0 ? scoreRecords(testRecords) : null;

    const domainSamples = records
      .filter((r) => r.predicted !== null)
      .map((r) => ({ domain: r.domain, yTrue: r.goldLabel, yPred: r.predicted!.relationship }));
    const domainF1 = perDomainMacroF1(domainSamples);

    const classesBelowFloor = pooled.perClass.filter((c) => c.support > 0 && c.f1 < CLASS_F1_FLOOR).map((c) => c.className);
    const macroF1Pass = pooled.macroF1 >= JUDGE_VALENCE_MACRO_F1_MIN;
    const kappaPass = pooled.kappa >= JUDGE_KAPPA_MIN;
    const contradictionRecallPass = pooled.contradictionRecall >= JUDGE_CONTRADICTION_RECALL_MIN;
    const classFloorPass = classesBelowFloor.length === 0;

    const score: RungScore = {
      rung: rung.id,
      model: rung.model,
      nSucceeded: records.filter((r) => r.predicted !== null).length,
      nFailed: records.filter((r) => r.predicted === null).length,
      failedIds: records.filter((r) => r.predicted === null).map((r) => r.id),
      pooled,
      testSplit: testScore ? { n: testRecords.length, ...testScore } : null,
      perDomainMacroF1: domainF1,
      passedGates: macroF1Pass && kappaPass && contradictionRecallPass,
      gateDetail: { macroF1Pass, kappaPass, contradictionRecallPass, classFloorPass, classesBelowFloor },
    };
    rungScores.push(score);
    console.log(
      `  macroF1=${pooled.macroF1.toFixed(3)} (need>=${JUDGE_VALENCE_MACRO_F1_MIN}) kappa=${pooled.kappa.toFixed(3)} (need>=${JUDGE_KAPPA_MIN}) ` +
        `contradictionRecall=${pooled.contradictionRecall.toFixed(3)} (need>=${JUDGE_CONTRADICTION_RECALL_MIN}) → passedGates=${score.passedGates}`,
    );
  }

  // ── Cheapest passing rung ──────────────────────────────────────────
  const cheapestPassing = RUNGS.map((r) => rungScores.find((s) => s.rung === r.id)!).find((s) => s.passedGates) ?? null;
  console.log(`\nCheapest passing rung: ${cheapestPassing?.rung ?? "NONE — no rung cleared the gates"}`);

  // ── Robustness sub-check on the cheapest rung (falls back to the
  // cheapest rung overall if none passed, so the check still runs and is
  // reported, just not treated as gate-relevant) ──────────────────────
  const robustnessRung = RUNGS.find((r) => r.id === (cheapestPassing?.rung ?? RUNGS[0].id))!;
  const robustnessSample = empirical.slice(0, 10);
  console.log(`\n=== Robustness sub-check (engagement=none_detected vs. omitted) on ${robustnessRung.id}, 10 pairs ===`);
  const robustnessRecords = await mapWithConcurrency(robustnessSample, 4, async (pair): Promise<{ id: string; baseline: string | null; withNoneDetected: string | null; flipped: boolean; costUsd: number }> => {
    const baselineCall = allRecordsByRung[robustnessRung.id]?.find((r) => r.id === pair.id);
    const baseline = baselineCall?.predicted?.relationship ?? null;
    if (!withinBudget(robustnessRung.id)) {
      return { id: pair.id, baseline, withNoneDetected: null, flipped: false, costUsd: 0 };
    }
    try {
      const { result, costUsd } = await callJudge(
        robustnessRung,
        { text: pair.claim_a.text, workTitle: pair.claim_a.paper_title },
        { text: pair.claim_b.text, workTitle: pair.claim_b.paper_title },
        "empirical",
        { kind: "none_detected" },
      );
      runningCostUsd += costUsd;
      return { id: pair.id, baseline, withNoneDetected: result.relationship, flipped: baseline !== null && baseline !== result.relationship, costUsd };
    } catch (err) {
      return { id: pair.id, baseline, withNoneDetected: null, flipped: false, costUsd: 0 };
    }
  });
  const robustnessCost = robustnessRecords.reduce((s, r) => s + r.costUsd, 0);
  costLedger.push({ stage: "robustness-none-detected", rung: robustnessRung.id, costUsd: robustnessCost, calls: robustnessRecords.length });
  const flips = robustnessRecords.filter((r) => r.flipped);
  console.log(`  ${flips.length}/${robustnessRecords.length} flipped. $${robustnessCost.toFixed(6)} (running total $${runningCostUsd.toFixed(6)})`);

  // ── Humanities baseline on the cheapest passing rung ────────────────
  let humanitiesBaseline: { rung: RungId; n: number; macroF1: number; kappa: number; contradictionRecall: number; binaryTensionF1: number; perClass: ReturnType<typeof perClassPRF1>; nFailed: number } | null = null;
  if (cheapestPassing) {
    const humanitiesRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.humanities.json"), "utf8"));
    const humanities = humanitiesRaw.map((p) => ({ ...p, resolvedDomain: p.domain ?? "ancient_philosophy" }));
    const rung = RUNGS.find((r) => r.id === cheapestPassing.rung)!;
    console.log(`\n=== Humanities baseline (base 4-way judge, PROVISIONAL labels) on ${rung.id}, ${humanities.length} pairs ===`);
    const records = await runRungOverPairs(rung, humanities, "empirical", "humanities-baseline");
    const scored = scoreRecords(records);
    humanitiesBaseline = {
      rung: rung.id,
      n: records.length,
      nFailed: records.filter((r) => r.predicted === null).length,
      ...scored,
    };
    console.log(`  PROVISIONAL humanities macroF1=${scored.macroF1.toFixed(3)} kappa=${scored.kappa.toFixed(3)} contradictionRecall=${scored.contradictionRecall.toFixed(3)}`);
  } else {
    console.log("\nNo rung passed gates — skipping humanities baseline (no cheapest-passing rung to run it on).");
  }

  console.log(`\nTOTAL COST: $${runningCostUsd.toFixed(6)}`);

  const rawOut = {
    generatedAt: new Date().toISOString(),
    goldCounts: { empirical: empirical.length, train: train.length, test: test.length },
    rungScores,
    cheapestPassingRung: cheapestPassing?.rung ?? null,
    robustness: { rung: robustnessRung.id, sampleIds: robustnessSample.map((p) => p.id), records: robustnessRecords, flipCount: flips.length },
    humanitiesBaseline,
    cost: { totalUsd: runningCostUsd, ledger: costLedger },
    rawRecordsByRung: allRecordsByRung,
  };
  writeFileSync(join(OUT_DIR, "spike-25-5-judge.raw.json"), JSON.stringify(rawOut, null, 2));

  return rawOut;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
