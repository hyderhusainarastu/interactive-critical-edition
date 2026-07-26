/**
 * Phase 25.5b — judge prompt iteration + rung re-score.
 *
 * Two phases:
 *   1. Prompt-variant selection: 3 variants of the v2 judge prompt
 *      (packages/claims/src/prompts/judge.ts's `buildJudgePromptVariant`)
 *      run against the TRAIN split only (src/eval/split.ts, testFrac=0.3),
 *      on the cheapest rung (gpt-5.4-nano). The variant with the best train
 *      macro-F1 is declared the winner — this never touches the held-out
 *      test split, so the final numbers below stay honest.
 *   2. Final scoring: the *shipped* `buildJudgePrompt` (which always runs
 *      with every v2 flag on — see judge.ts) is scored once per rung on the
 *      FULL 42 empirical gold pairs for gpt-5.4-nano and claude-haiku-4-5
 *      (mini skipped per the task brief: dominated by nano at equal failure
 *      in the Phase 25.5 spike). Pooled + held-out-test numbers are both
 *      reported. If a rung passes all three gates, a PROVISIONAL humanities
 *      baseline runs on the cheapest passing rung. If nothing passes, one
 *      escalation rung (claude-sonnet-4-6) is offered as a follow-up run
 *      (see runEscalation() below) — never run automatically, since it
 *      costs real money beyond the base budget.
 *
 * Run: npx tsx scripts/research/judge-eval-v2.mts [--escalate]
 * Budget: <=$0.45 base ($0.45 + $0.50 more only if --escalate is passed
 * AND no rung passed gates — see the task brief).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadWorkerEnv } from "./env.mjs";
import { OpenAIResponsesClient } from "../../packages/ai-adapters/src/responses";
import { AnthropicStructuredClient } from "../../packages/ai-adapters/src/anthropicStructured";
import { estimateCostUsd } from "../../packages/ai-adapters/src/routing";
import {
  buildJudgePrompt,
  buildJudgePromptVariant,
  validateJudgeResponse,
  type JudgePromptVariantOptions,
  type JudgeResult,
} from "../../packages/claims/src/prompts/judge";
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

const ESCALATE = process.argv.includes("--escalate");

// ── Structured-output schema (unchanged from spike-25-5-judge, judge.test.ts) ──
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

type RungId = "gpt-5.4-nano" | "claude-haiku-4-5" | "claude-sonnet-4-6";

interface Rung {
  id: RungId;
  provider: "openai" | "anthropic";
  model: string;
}

const NANO: Rung = { id: "gpt-5.4-nano", provider: "openai", model: "gpt-5.4-nano" };
const HAIKU: Rung = { id: "claude-haiku-4-5", provider: "anthropic", model: "claude-haiku-4-5-20251001" };
const SONNET: Rung = { id: "claude-sonnet-4-6", provider: "anthropic", model: "claude-sonnet-4-6" };

const FINAL_RUNGS: Rung[] = [NANO, HAIKU]; // mini skipped per task brief

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

// Real-time budget guard. Base budget: $0.45. Escalation (sonnet), if it
// runs, gets its own separate $0.50 ceiling tracked independently so a
// runaway base phase can never eat into the escalation authorization or
// vice versa.
const BASE_BUDGET_CEILING_USD = 0.45;
const ESCALATION_BUDGET_CEILING_USD = 0.5;
const PER_CALL_COST_CAP: Record<string, number> = {
  "gpt-5.4-nano": 0.002, // v2 prompt is materially longer than v1 (decision tree + few-shots)
  "claude-haiku-4-5": 0.008,
  "claude-sonnet-4-6": 0.03,
};

function withinBudget(rungId: string, ceilingUsd: number, spentUsd: number): boolean {
  const cap = PER_CALL_COST_CAP[rungId] ?? 0.03;
  return spentUsd + cap <= ceilingUsd;
}

async function callJudgeVariant(
  rung: Rung,
  claimA: { text: string; workTitle: string },
  claimB: { text: string; workTitle: string },
  branch: "empirical" | "humanities",
  variantOptions?: JudgePromptVariantOptions,
): Promise<{ result: JudgeResult; promptTokens: number; completionTokens: number; costUsd: number }> {
  const prompt = variantOptions
    ? buildJudgePromptVariant({ claimA, claimB, branch }, variantOptions)
    : buildJudgePrompt({ claimA, claimB, branch });
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

function scoreRecords(records: JudgeCallRecord[]): {
  macroF1: number;
  kappa: number;
  contradictionRecall: number;
  binaryTensionF1: number;
  perClass: ReturnType<typeof perClassPRF1>;
} {
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

async function runOverPairs(
  rung: Rung,
  pairs: (GoldRelationshipPair & { resolvedDomain: string })[],
  branch: "empirical" | "humanities",
  stage: string,
  budgetCeilingUsd: number,
  variantOptions?: JudgePromptVariantOptions,
): Promise<JudgeCallRecord[]> {
  const records = await mapWithConcurrency(pairs, 4, async (pair): Promise<JudgeCallRecord> => {
    if (!withinBudget(rung.id, budgetCeilingUsd, runningCostUsd)) {
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: null, promptTokens: 0, completionTokens: 0, costUsd: 0, error: "skipped-budget" };
    }
    try {
      const { result, promptTokens, completionTokens, costUsd } = await callJudgeVariant(
        rung,
        { text: pair.claim_a.text, workTitle: pair.claim_a.paper_title },
        { text: pair.claim_b.text, workTitle: pair.claim_b.paper_title },
        branch,
        variantOptions,
      );
      runningCostUsd += costUsd;
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: result, promptTokens, completionTokens, costUsd };
    } catch (err) {
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: null, promptTokens: 0, completionTokens: 0, costUsd: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });
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
  pooled: ReturnType<typeof scoreRecords>;
  testSplit: { n: number } & ReturnType<typeof scoreRecords> | null;
  perDomainMacroF1: Record<string, number>;
  passedGates: boolean;
  gateDetail: { macroF1Pass: boolean; kappaPass: boolean; contradictionRecallPass: boolean; classFloorPass: boolean; classesBelowFloor: string[] };
}

function gateScore(rung: Rung, records: JudgeCallRecord[], testIds: Set<string>): RungScore {
  const pooled = scoreRecords(records);
  const testRecords = records.filter((r) => testIds.has(r.id));
  const testScore = testRecords.filter((r) => r.predicted !== null).length > 0 ? { n: testRecords.length, ...scoreRecords(testRecords) } : null;
  const domainSamples = records.filter((r) => r.predicted !== null).map((r) => ({ domain: r.domain, yTrue: r.goldLabel, yPred: r.predicted!.relationship }));
  const domainF1 = perDomainMacroF1(domainSamples);
  const classesBelowFloor = pooled.perClass.filter((c) => c.support > 0 && c.f1 < CLASS_F1_FLOOR).map((c) => c.className);
  const macroF1Pass = pooled.macroF1 >= JUDGE_VALENCE_MACRO_F1_MIN;
  const kappaPass = pooled.kappa >= JUDGE_KAPPA_MIN;
  const contradictionRecallPass = pooled.contradictionRecall >= JUDGE_CONTRADICTION_RECALL_MIN;
  const classFloorPass = classesBelowFloor.length === 0;
  return {
    rung: rung.id,
    model: rung.model,
    nSucceeded: records.filter((r) => r.predicted !== null).length,
    nFailed: records.filter((r) => r.predicted === null).length,
    failedIds: records.filter((r) => r.predicted === null).map((r) => r.id),
    pooled,
    testSplit: testScore,
    perDomainMacroF1: domainF1,
    passedGates: macroF1Pass && kappaPass && contradictionRecallPass,
    gateDetail: { macroF1Pass, kappaPass, contradictionRecallPass, classFloorPass, classesBelowFloor },
  };
}

// ── Phase 1: prompt-variant selection (TRAIN split, nano only) ──────────
const VARIANTS: { name: string; options: JudgePromptVariantOptions }[] = [
  { name: "A-decisionTree-only", options: { includeDecisionTree: true, includeAntiCatchAll: true, includeFewShot: false } },
  { name: "B-fewShot-only", options: { includeDecisionTree: false, includeAntiCatchAll: true, includeFewShot: true } },
  { name: "C-full-v2", options: { includeDecisionTree: true, includeAntiCatchAll: true, includeFewShot: true } },
];

async function main() {
  const empiricalRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.empirical.json"), "utf8"));
  const empirical = empiricalRaw.map((p) => ({ ...p, resolvedDomain: p.domain ?? "empirical" }));
  console.log(`Loaded ${empirical.length} empirical gold pairs.`);

  const { train, test } = splitItems(empirical, 0.3);
  console.log(`Deterministic split (src/eval/split.ts, testFrac=0.3): ${train.length} train, ${test.length} test.`);
  const testIds = new Set(test.map((p) => p.id));

  // ── Phase 1 ──────────────────────────────────────────────────────────
  console.log("\n=== PHASE 1: prompt-variant selection (TRAIN split, gpt-5.4-nano) ===");
  const variantResults: { name: string; options: JudgePromptVariantOptions; trainMacroF1: number; trainKappa: number; trainContradictionRecall: number; records: JudgeCallRecord[] }[] = [];
  for (const variant of VARIANTS) {
    console.log(`\n--- Variant ${variant.name} ---`);
    const records = await runOverPairs(NANO, train, "empirical", `variant-${variant.name}-train`, BASE_BUDGET_CEILING_USD, variant.options);
    const scored = scoreRecords(records);
    variantResults.push({ name: variant.name, options: variant.options, trainMacroF1: scored.macroF1, trainKappa: scored.kappa, trainContradictionRecall: scored.contradictionRecall, records });
    console.log(`  train macroF1=${scored.macroF1.toFixed(3)} kappa=${scored.kappa.toFixed(3)} contradictionRecall=${scored.contradictionRecall.toFixed(3)}`);
  }
  const bestVariant = variantResults.reduce((best, v) => (v.trainMacroF1 > best.trainMacroF1 ? v : best));
  console.log(`\nBest variant by train macroF1: ${bestVariant.name} (${bestVariant.trainMacroF1.toFixed(3)})`);
  console.log(`Shipped judge.ts buildJudgePrompt() == variant C-full-v2 (all flags on).`);

  // ── Phase 2: final scoring, shipped buildJudgePrompt(), full 42 ────────
  console.log("\n=== PHASE 2: final scoring (shipped buildJudgePrompt, full 42) ===");
  const rungScores: RungScore[] = [];
  const allRecordsByRung: Record<string, JudgeCallRecord[]> = {};
  for (const rung of FINAL_RUNGS) {
    console.log(`\n--- Rung: ${rung.id} (${rung.model}) ---`);
    const records = await runOverPairs(rung, empirical, "empirical", "final-scoring-42", BASE_BUDGET_CEILING_USD);
    allRecordsByRung[rung.id] = records;
    const score = gateScore(rung, records, testIds);
    rungScores.push(score);
    console.log(
      `  pooled macroF1=${score.pooled.macroF1.toFixed(3)} (need>=${JUDGE_VALENCE_MACRO_F1_MIN}) kappa=${score.pooled.kappa.toFixed(3)} (need>=${JUDGE_KAPPA_MIN}) ` +
        `contradictionRecall=${score.pooled.contradictionRecall.toFixed(3)} (need>=${JUDGE_CONTRADICTION_RECALL_MIN}) → passedGates=${score.passedGates}`,
    );
    if (score.testSplit) {
      console.log(`  test-split (n=${score.testSplit.n}, reported not gate-relevant): macroF1=${score.testSplit.macroF1.toFixed(3)} kappa=${score.testSplit.kappa.toFixed(3)}`);
    }
  }

  const cheapestPassing = FINAL_RUNGS.map((r) => rungScores.find((s) => s.rung === r.id)!).find((s) => s.passedGates) ?? null;
  console.log(`\nCheapest passing rung: ${cheapestPassing?.rung ?? "NONE — no rung cleared the gates"}`);

  // ── Phase 3: humanities baseline (cheapest passing rung only) ─────────
  let humanitiesBaseline: { rung: RungId; n: number; nFailed: number } & ReturnType<typeof scoreRecords> | null = null;
  if (cheapestPassing) {
    const humanitiesRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.humanities.json"), "utf8"));
    const humanities = humanitiesRaw.map((p) => ({ ...p, resolvedDomain: p.domain ?? "ancient_philosophy" }));
    const rung = FINAL_RUNGS.find((r) => r.id === cheapestPassing.rung)!;
    console.log(`\n=== PHASE 3: humanities baseline (PROVISIONAL labels) on ${rung.id}, ${humanities.length} pairs ===`);
    const records = await runOverPairs(rung, humanities, "empirical", "humanities-baseline", BASE_BUDGET_CEILING_USD);
    const scored = scoreRecords(records);
    humanitiesBaseline = { rung: rung.id, n: records.length, nFailed: records.filter((r) => r.predicted === null).length, ...scored };
    console.log(`  PROVISIONAL humanities macroF1=${scored.macroF1.toFixed(3)} kappa=${scored.kappa.toFixed(3)} contradictionRecall=${scored.contradictionRecall.toFixed(3)}`);
  } else {
    console.log("\nNo rung passed gates — skipping humanities baseline.");
  }

  console.log(`\nBASE PHASE TOTAL COST: $${runningCostUsd.toFixed(6)}`);

  // ── Phase 4 (conditional, --escalate only): sonnet escalation ─────────
  let escalation: (RungScore & { costUsd: number }) | null = null;
  if (!cheapestPassing && ESCALATE) {
    console.log("\n=== PHASE 4: escalation rung (claude-sonnet-4-6, full 42) — moderator-authorized, +$0.50 budget ===");
    const escalationStartCost = runningCostUsd;
    // Reset the running counter's relationship to the ceiling check: escalation
    // gets its OWN ceiling, tracked as spend-since-escalation-start.
    let escalationSpend = 0;
    const escalationRecords = await mapWithConcurrency(empirical, 4, async (pair): Promise<JudgeCallRecord> => {
      if (escalationSpend + (PER_CALL_COST_CAP[SONNET.id] ?? 0.03) > ESCALATION_BUDGET_CEILING_USD) {
        return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: null, promptTokens: 0, completionTokens: 0, costUsd: 0, error: "skipped-budget" };
      }
      try {
        const { result, promptTokens, completionTokens, costUsd } = await callJudgeVariant(
          SONNET,
          { text: pair.claim_a.text, workTitle: pair.claim_a.paper_title },
          { text: pair.claim_b.text, workTitle: pair.claim_b.paper_title },
          "empirical",
        );
        escalationSpend += costUsd;
        return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: result, promptTokens, completionTokens, costUsd };
      } catch (err) {
        return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: null, promptTokens: 0, completionTokens: 0, costUsd: 0, error: err instanceof Error ? err.message : String(err) };
      }
    });
    const escalationCost = escalationRecords.reduce((s, r) => s + r.costUsd, 0);
    costLedger.push({ stage: "escalation-sonnet-42", rung: SONNET.id, costUsd: escalationCost, calls: escalationRecords.length });
    allRecordsByRung[SONNET.id] = escalationRecords;
    const score = gateScore(SONNET, escalationRecords, testIds);
    escalation = { ...score, costUsd: escalationCost };
    console.log(
      `  [${SONNET.id}] escalation: pooled macroF1=${score.pooled.macroF1.toFixed(3)} kappa=${score.pooled.kappa.toFixed(3)} ` +
        `contradictionRecall=${score.pooled.contradictionRecall.toFixed(3)} → passedGates=${score.passedGates} ($${escalationCost.toFixed(6)})`,
    );
    console.log(`  STILL CHANGING NOTHING — decision-rule outcome only, for moderator review.`);
    void escalationStartCost;
  } else if (!cheapestPassing) {
    console.log("\nNo rung passed gates and --escalate was not passed — skipping the sonnet escalation run.");
  }

  console.log(`\nGRAND TOTAL COST: $${runningCostUsd.toFixed(6)}`);

  const rawOut = {
    generatedAt: new Date().toISOString(),
    goldCounts: { empirical: empirical.length, train: train.length, test: test.length },
    variantSelection: variantResults.map((v) => ({ name: v.name, options: v.options, trainMacroF1: v.trainMacroF1, trainKappa: v.trainKappa, trainContradictionRecall: v.trainContradictionRecall })),
    bestVariant: bestVariant.name,
    rungScores,
    cheapestPassingRung: cheapestPassing?.rung ?? null,
    humanitiesBaseline,
    escalation,
    cost: { totalUsd: runningCostUsd, ledger: costLedger },
    rawRecordsByRung: allRecordsByRung,
  };
  writeFileSync(join(OUT_DIR, "spike-25-5b-judge-iteration.raw.json"), JSON.stringify(rawOut, null, 2));

  return rawOut;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
