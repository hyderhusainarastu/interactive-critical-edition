/**
 * Phase 25.5b — CORRECTED final scoring, run after fixing a bug in the
 * first judge-eval-v2.mts run: that run scored the "kitchen sink" variant
 * (C, all three new blocks) on the full 42 regardless of which variant won
 * the TRAIN-split selection, instead of scoring the actual WINNER (variant
 * B: few-shot + anti-catch-all, decision-tree OFF — train macroF1 0.582 vs
 * C's 0.540). packages/claims/src/prompts/judge.ts's buildJudgePrompt() was
 * corrected to ship variant B; this script re-scores the full 42 against
 * that corrected function only (Phase 1's variant-selection numbers from
 * the first run are still valid and are not re-measured here — the bug was
 * only in which variant Phase 2 scored, not in Phase 1 itself).
 *
 * Run: npx tsx scripts/research/judge-eval-v2-rescore.mts
 * Budget: incremental to the $0.249762 already spent in the first run's
 * Phase 1 + (wrong-variant) Phase 2 — this script's own ceiling is $0.19,
 * keeping the combined base-phase total under the task's $0.45 hard cap.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadWorkerEnv } from "./env.mjs";
import { OpenAIResponsesClient } from "../../packages/ai-adapters/src/responses";
import { AnthropicStructuredClient } from "../../packages/ai-adapters/src/anthropicStructured";
import { estimateCostUsd } from "../../packages/ai-adapters/src/routing";
import { buildJudgePrompt, validateJudgeResponse, type JudgeResult } from "../../packages/claims/src/prompts/judge";
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

type RungId = "gpt-5.4-nano" | "claude-haiku-4-5";
interface Rung { id: RungId; provider: "openai" | "anthropic"; model: string }
const NANO: Rung = { id: "gpt-5.4-nano", provider: "openai", model: "gpt-5.4-nano" };
const HAIKU: Rung = { id: "claude-haiku-4-5", provider: "anthropic", model: "claude-haiku-4-5-20251001" };
const RUNGS: Rung[] = [NANO, HAIKU];

const openaiClient = new OpenAIResponsesClient();
const anthropicClient = new AnthropicStructuredClient();

interface JudgeCallRecord {
  id: string; domain: string; goldLabel: string; predicted: JudgeResult | null;
  promptTokens: number; completionTokens: number; costUsd: number; error?: string;
}

let runningCostUsd = 0;
const costLedger: { stage: string; rung: string; costUsd: number; calls: number }[] = [];
const BUDGET_CEILING_USD = 0.19;
const PER_CALL_COST_CAP: Record<string, number> = { "gpt-5.4-nano": 0.0015, "claude-haiku-4-5": 0.006 };

function withinBudget(rungId: string): boolean {
  const cap = PER_CALL_COST_CAP[rungId] ?? 0.006;
  return runningCostUsd + cap <= BUDGET_CEILING_USD;
}

async function callJudge(rung: Rung, claimA: { text: string; workTitle: string }, claimB: { text: string; workTitle: string }, branch: "empirical" | "humanities") {
  const prompt = buildJudgePrompt({ claimA, claimB, branch });
  if (rung.provider === "openai") {
    const res = await openaiClient.call<JudgeResult>({
      model: rung.model, system: JUDGE_SYSTEM, input: prompt, schema: JUDGE_SCHEMA, schemaName: "judge_relationship", maxOutputTokens: 500,
      validate: (parsed) => validateJudgeResponse(parsed),
    });
    return { result: res.data, promptTokens: res.promptTokens, completionTokens: res.completionTokens, costUsd: estimateCostUsd(rung.model, res.promptTokens, res.completionTokens) };
  }
  const res = await anthropicClient.call<JudgeResult>({
    model: rung.model, system: JUDGE_SYSTEM, user: prompt, schema: JUDGE_SCHEMA, schemaName: "judge_relationship", maxOutputTokens: 500,
    validate: (parsed) => validateJudgeResponse(parsed),
  });
  return { result: res.data, promptTokens: res.promptTokens, completionTokens: res.completionTokens, costUsd: estimateCostUsd(rung.model, res.promptTokens, res.completionTokens) };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() { while (cursor < items.length) { const i = cursor++; results[i] = await fn(items[i], i); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function scoreRecords(records: JudgeCallRecord[]) {
  const succeeded = records.filter((r) => r.predicted !== null);
  const yTrue = succeeded.map((r) => r.goldLabel);
  const yPred = succeeded.map((r) => r.predicted!.relationship);
  const cm = confusionMatrix(yTrue, yPred, [...CLAIM_RELATION_VALENCES]);
  const perClass = perClassPRF1(cm);
  const contradictionRow = perClass.find((c) => c.className === "contradiction");
  return { macroF1: macroF1(cm), kappa: cohenKappa(cm), contradictionRecall: contradictionRow?.recall ?? 0, binaryTensionF1: binaryTensionF1(yTrue, yPred), perClass };
}

async function runOverPairs(rung: Rung, pairs: (GoldRelationshipPair & { resolvedDomain: string })[], branch: "empirical" | "humanities", stage: string): Promise<JudgeCallRecord[]> {
  const records = await mapWithConcurrency(pairs, 4, async (pair): Promise<JudgeCallRecord> => {
    if (!withinBudget(rung.id)) {
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: null, promptTokens: 0, completionTokens: 0, costUsd: 0, error: "skipped-budget" };
    }
    try {
      const { result, promptTokens, completionTokens, costUsd } = await callJudge(rung, { text: pair.claim_a.text, workTitle: pair.claim_a.paper_title }, { text: pair.claim_b.text, workTitle: pair.claim_b.paper_title }, branch);
      runningCostUsd += costUsd;
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: result, promptTokens, completionTokens, costUsd };
    } catch (err) {
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: null, promptTokens: 0, completionTokens: 0, costUsd: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });
  const stageCost = records.reduce((s, r) => s + r.costUsd, 0);
  costLedger.push({ stage, rung: rung.id, costUsd: stageCost, calls: records.length });
  console.log(`  [${rung.id}] ${stage}: ${records.length} calls, ${records.filter((r) => r.error).length} failed, $${stageCost.toFixed(6)} (running total $${runningCostUsd.toFixed(6)})`);
  return records;
}

async function main() {
  const empiricalRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.empirical.json"), "utf8"));
  const empirical = empiricalRaw.map((p) => ({ ...p, resolvedDomain: p.domain ?? "empirical" }));
  const { train, test } = splitItems(empirical, 0.3);
  const testIds = new Set(test.map((p) => p.id));

  console.log("=== CORRECTED final scoring (buildJudgePrompt = winning variant B, full 42) ===");
  const rungScores: Record<string, ReturnType<typeof scoreRecords> & { testSplit: ({ n: number } & ReturnType<typeof scoreRecords>) | null; perDomainMacroF1: Record<string, number>; passedGates: boolean; nFailed: number; failedIds: string[] }> = {};
  const allRecordsByRung: Record<string, JudgeCallRecord[]> = {};

  for (const rung of RUNGS) {
    console.log(`\n--- Rung: ${rung.id} ---`);
    const records = await runOverPairs(rung, empirical, "empirical", "corrected-final-scoring-42");
    allRecordsByRung[rung.id] = records;
    const pooled = scoreRecords(records);
    const testRecords = records.filter((r) => testIds.has(r.id));
    const testScore = testRecords.filter((r) => r.predicted !== null).length > 0 ? { n: testRecords.length, ...scoreRecords(testRecords) } : null;
    const domainSamples = records.filter((r) => r.predicted !== null).map((r) => ({ domain: r.domain, yTrue: r.goldLabel, yPred: r.predicted!.relationship }));
    const domainF1 = perDomainMacroF1(domainSamples);
    const classesBelowFloor = pooled.perClass.filter((c) => c.support > 0 && c.f1 < CLASS_F1_FLOOR).map((c) => c.className);
    const macroF1Pass = pooled.macroF1 >= JUDGE_VALENCE_MACRO_F1_MIN;
    const kappaPass = pooled.kappa >= JUDGE_KAPPA_MIN;
    const contradictionRecallPass = pooled.contradictionRecall >= JUDGE_CONTRADICTION_RECALL_MIN;
    const passedGates = macroF1Pass && kappaPass && contradictionRecallPass;
    rungScores[rung.id] = { ...pooled, testSplit: testScore, perDomainMacroF1: domainF1, passedGates, nFailed: records.filter((r) => r.predicted === null).length, failedIds: records.filter((r) => r.predicted === null).map((r) => r.id) };
    console.log(`  pooled macroF1=${pooled.macroF1.toFixed(3)} (need>=${JUDGE_VALENCE_MACRO_F1_MIN}) kappa=${pooled.kappa.toFixed(3)} (need>=${JUDGE_KAPPA_MIN}) contradictionRecall=${pooled.contradictionRecall.toFixed(3)} (need>=${JUDGE_CONTRADICTION_RECALL_MIN}) → passedGates=${passedGates} classesBelowFloor=${classesBelowFloor.join(",") || "none"}`);
    if (testScore) console.log(`  test-split (n=${testScore.n}): macroF1=${testScore.macroF1.toFixed(3)} kappa=${testScore.kappa.toFixed(3)}`);
  }

  const cheapestPassingId = RUNGS.map((r) => r.id).find((id) => rungScores[id]?.passedGates) ?? null;
  console.log(`\nCheapest passing rung: ${cheapestPassingId ?? "NONE — no rung cleared the gates"}`);

  let humanitiesBaseline: (ReturnType<typeof scoreRecords> & { rung: RungId; n: number; nFailed: number }) | null = null;
  if (cheapestPassingId) {
    const rung = RUNGS.find((r) => r.id === cheapestPassingId)!;
    const humanitiesRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.humanities.json"), "utf8"));
    const humanities = humanitiesRaw.map((p) => ({ ...p, resolvedDomain: p.domain ?? "ancient_philosophy" }));
    console.log(`\n=== Humanities baseline (PROVISIONAL) on ${rung.id}, ${humanities.length} pairs ===`);
    const records = await runOverPairs(rung, humanities, "empirical", "humanities-baseline-corrected");
    const scored = scoreRecords(records);
    humanitiesBaseline = { rung: rung.id, n: records.length, nFailed: records.filter((r) => r.predicted === null).length, ...scored };
    console.log(`  PROVISIONAL humanities macroF1=${scored.macroF1.toFixed(3)} kappa=${scored.kappa.toFixed(3)} contradictionRecall=${scored.contradictionRecall.toFixed(3)}`);
  } else {
    console.log("\nNo rung passed gates — skipping humanities baseline.");
  }

  console.log(`\nRESCORE PHASE COST: $${runningCostUsd.toFixed(6)}`);

  const rawOut = { generatedAt: new Date().toISOString(), rungScores, cheapestPassingRung: cheapestPassingId, humanitiesBaseline, cost: { totalUsd: runningCostUsd, ledger: costLedger }, rawRecordsByRung: allRecordsByRung };
  writeFileSync(join(OUT_DIR, "spike-25-5b-judge-iteration-rescore.raw.json"), JSON.stringify(rawOut, null, 2));
  return rawOut;
}

main().catch((err) => { console.error(err); process.exit(1); });
