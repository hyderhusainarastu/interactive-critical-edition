/**
 * Phase 25.5c — judge output-mode experiment.
 *
 * Moderator's hypothesis: the 0.732-vs-0.788 macro-F1 gap between the Phase
 * 25.5 spike (`spike-25-5-judge.md`, claude-haiku-4-5, BASELINE prompt —
 * every v2 addition OFF — via forced Anthropic tool-use) and ScholarLens's
 * own reported baseline (0.788, "Sonnet-class Claude") comes from forced
 * tool-use denying the model pre-answer reasoning — ScholarLens used raw
 * "Return ONLY valid JSON" text completion, not a structured tool call.
 *
 * Three cells, run in order, each gated on cost and on whether an earlier
 * cell already cleared all three gates (src/eval/gates.ts):
 *
 *   CELL 1 (~$0.16): claude-haiku-4-5, BASELINE prompt (buildJudgePromptVariant
 *     with every v2 flag OFF — the exact prompt spike-25-5-judge.md measured
 *     at 0.732/0.614/0.667), structured tool-use via AnthropicStructuredClient,
 *     BUT the JSON schema's FIRST property is "reasoning": string ("2-4
 *     sentences working through the decision guide before deciding"),
 *     followed by relationship/category/explanation/strongerEvidence/
 *     resolution. `validateJudgeResponse` (unmodified, production function)
 *     ignores "reasoning" — it isn't part of `JudgeResult`.
 *
 *   CELL 2 (~$0.16): claude-haiku-4-5, the SAME baseline prompt verbatim
 *     (its own trailing "Return ONLY valid JSON... No preamble, no markdown
 *     fences." instruction is unchanged), but via the plain
 *     `AnthropicProvider.complete()` raw-text path instead of forced
 *     tool-use. This script (not production code) manually strips markdown
 *     fences, `JSON.parse`s the result, and retries the whole call ONCE on
 *     a parse/validation failure. This eval-only parsing path is clearly
 *     marked below and is NOT wired into any production code path.
 *
 *   CELL 3 (~$0.55, conditional): only runs if NEITHER Cell 1 nor Cell 2
 *     clears all three gates. claude-sonnet-4-6, same baseline prompt,
 *     whichever output mode (structured-reasoning-first or raw-text) scored
 *     higher (by pooled macro-F1) in Cells 1/2.
 *
 * If any cell passes all three gates, the humanities baseline
 * (gold/relationshipPairs.humanities.json, branch:"humanities" so the
 * pre-classification instruction + optional mechanism field actually
 * apply — the Phase 25.5b script passed branch:"empirical" for this run,
 * which looks like an unexercised bug since that phase's humanities step
 * never actually executed; fixed here, not silently copied) runs on the
 * cheapest passing config and is reported PROVISIONAL.
 *
 * HARD BUDGET: $0.95 total, tracked with a single running cost ledger
 * across all cells + the humanities baseline. Real per-call token cost
 * (packages/ai-adapters/src/routing.ts's estimateCostUsd), not an
 * estimate — dispatch stops the moment projected spend would exceed the
 * ceiling; remaining pairs in a stage are marked "skipped-budget".
 *
 * Run: npx tsx scripts/research/judge-eval-output-mode.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadWorkerEnv } from "./env.mjs";
import { AnthropicStructuredClient } from "../../packages/ai-adapters/src/anthropicStructured";
import { AnthropicProvider } from "../../packages/ai-adapters/src/providers/anthropic";
import { estimateCostUsd } from "../../packages/ai-adapters/src/routing";
import {
  buildJudgePromptVariant,
  validateJudgeResponse,
  type JudgeResult,
} from "../../packages/claims/src/prompts/judge";
import { CLAIM_RELATION_VALENCES, CLAIM_RELATION_CATEGORIES } from "../../packages/claims/src/taxonomy";
import { parseGoldRelationshipPairsFile, type GoldRelationshipPair } from "../../packages/claims/src/eval/goldSchema";
import { confusionMatrix, perClassPRF1, macroF1, cohenKappa, perDomainMacroF1 } from "../../packages/claims/src/eval/metrics";
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

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ── Baseline prompt: every v2 addition OFF, the exact prompt Phase 25.5 ──
// measured (spike-25-5-judge.md). NOT the currently-shipped buildJudgePrompt
// (which ships variant B — few-shot + anti-catch-all — per Phase 25.5b).
function baselinePrompt(claimA: { text: string; workTitle: string }, claimB: { text: string; workTitle: string }, branch: "empirical" | "humanities"): string {
  return buildJudgePromptVariant(
    { claimA, claimB, branch },
    { includeDecisionTree: false, includeAntiCatchAll: false, includeFewShot: false },
  );
}

const JUDGE_SYSTEM =
  "You are a careful academic peer-reviewer comparing two research claims from different works. Follow the instructions exactly and return only the requested structured fields.";

// ── Cell 1 schema: reasoning-first structured tool-use (Anthropic only — ──
// no OpenAI strict-mode "required" constraint applies here, so no
// `mechanism` filler field is needed for the empirical branch this script
// exercises).
const REASONING_FIRST_SCHEMA = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description: "2-4 sentences working through the decision guide before deciding.",
    },
    relationship: { type: "string", enum: [...CLAIM_RELATION_VALENCES] },
    category: { type: "string", enum: [...CLAIM_RELATION_CATEGORIES] },
    explanation: { type: "string" },
    strongerEvidence: { type: "string", enum: ["paper_a", "paper_b", "neither"] },
    resolution: { type: "string" },
  },
  required: ["reasoning", "relationship", "category", "explanation", "strongerEvidence", "resolution"],
  additionalProperties: false,
} as const;

const HAIKU_MODEL = "claude-haiku-4-5-20251001"; // matches routing.ts PRICE_PER_MTOK + prior spikes
const SONNET_MODEL = "claude-sonnet-4-6"; // matches routing.ts PRICE_PER_MTOK + Phase 25.5b escalation rung

type OutputMode = "structured-reasoning-first" | "raw-text";

interface JudgeCallRecord {
  id: string;
  domain: string;
  goldLabel: string;
  predicted: JudgeResult | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  retried?: boolean;
  error?: string;
}

let runningCostUsd = 0;
const costLedger: { stage: string; cell: string; costUsd: number; calls: number }[] = [];

// ── Budget guard (single ledger, $0.95 hard ceiling across all cells) ───
const HARD_BUDGET_CEILING_USD = 0.95;
const PER_CALL_COST_CAP: Record<string, number> = {
  // Baseline prompt is v1-shaped (no decision tree / few-shot / anti-catch-
  // all) — materially shorter than the v2 prompt spike-25-5b measured, so
  // these caps are padded above spike-25-5-judge.md's measured
  // ~$0.00292/call for haiku, not derived from the (longer) v2 numbers.
  "structured-reasoning-first:haiku": 0.006,
  "raw-text:haiku": 0.01, // padded further: a parse-failure retry doubles the call
  "structured-reasoning-first:sonnet": 0.025,
  "raw-text:sonnet": 0.04,
};

function withinBudget(capKey: string): boolean {
  const cap = PER_CALL_COST_CAP[capKey] ?? 0.04;
  return runningCostUsd + cap <= HARD_BUDGET_CEILING_USD;
}

// ── Fence-stripping + JSON parse for the raw-text path ───────────────────
// EVAL-ONLY CODE — deliberately NOT part of any production code path. If
// raw-text mode ships, production needs its own hardened version of this
// (better error typing, telemetry, etc.) — see the report's decision
// section for why this stays out of packages/ai-adapters.
function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function parseJudgeJsonEvalOnly(text: string): unknown {
  return JSON.parse(stripMarkdownFences(text));
}

const anthropicStructuredClient = new AnthropicStructuredClient();

async function callStructuredReasoningFirst(
  model: string,
  claimA: { text: string; workTitle: string },
  claimB: { text: string; workTitle: string },
  branch: "empirical" | "humanities",
): Promise<{ result: JudgeResult; promptTokens: number; completionTokens: number; costUsd: number }> {
  const prompt = baselinePrompt(claimA, claimB, branch);
  const res = await anthropicStructuredClient.call<JudgeResult>({
    model,
    system: JUDGE_SYSTEM,
    user: prompt,
    schema: REASONING_FIRST_SCHEMA,
    schemaName: "judge_relationship_reasoning",
    maxOutputTokens: 600, // +100 vs the 500 used elsewhere to leave room for the reasoning field
    validate: (parsed) => validateJudgeResponse(parsed), // unmodified production validator — ignores "reasoning"
  });
  const costUsd = estimateCostUsd(model, res.promptTokens, res.completionTokens);
  return { result: res.data, promptTokens: res.promptTokens, completionTokens: res.completionTokens, costUsd };
}

async function callRawText(
  model: string,
  claimA: { text: string; workTitle: string },
  claimB: { text: string; workTitle: string },
  branch: "empirical" | "humanities",
): Promise<{ result: JudgeResult; promptTokens: number; completionTokens: number; costUsd: number; retried: boolean }> {
  if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");
  const prompt = baselinePrompt(claimA, claimB, branch);
  const provider = new AnthropicProvider(model, ANTHROPIC_API_KEY);
  let lastErr: Error | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let costUsd = 0;
  for (let attempt = 0; attempt <= 1; attempt++) {
    const res = await provider.complete({ task: "claim_relationship_judgment", system: JUDGE_SYSTEM, prompt, maxTokens: 600 });
    const callCost = estimateCostUsd(model, res.promptTokens, res.completionTokens);
    promptTokens += res.promptTokens;
    completionTokens += res.completionTokens;
    costUsd += callCost;
    try {
      const parsed = parseJudgeJsonEvalOnly(res.text);
      const result = validateJudgeResponse(parsed); // throws → caught below, triggers the one retry
      return { result, promptTokens, completionTokens, costUsd, retried: attempt > 0 };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // one retry only (attempt 0 → attempt 1), then give up
    }
  }
  throw lastErr ?? new Error("raw-text judge call failed after retry");
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
    perClass,
  };
}

interface CellConfig {
  id: string; // "cell1", "cell2", "cell3"
  label: string;
  model: string;
  modelShort: "haiku" | "sonnet";
  mode: OutputMode;
}

interface CellResult {
  cell: string;
  label: string;
  model: string;
  mode: OutputMode;
  records: JudgeCallRecord[];
  pooled: ReturnType<typeof scoreRecords>;
  testSplit: ({ n: number } & ReturnType<typeof scoreRecords>) | null;
  perDomainMacroF1: Record<string, number>;
  passedGates: boolean;
  gateDetail: {
    macroF1Pass: boolean;
    kappaPass: boolean;
    contradictionRecallPass: boolean;
    classFloorPass: boolean;
    classesBelowFloor: string[];
  };
  costUsd: number;
  nFailed: number;
  failedIds: string[];
}

async function runCell(
  cfg: CellConfig,
  pairs: (GoldRelationshipPair & { resolvedDomain: string })[],
  branch: "empirical" | "humanities",
  testIds: Set<string>,
): Promise<CellResult> {
  console.log(`\n--- ${cfg.id}: ${cfg.label} ---`);
  const capKey = `${cfg.mode}:${cfg.modelShort}`;
  const records = await mapWithConcurrency(pairs, 4, async (pair): Promise<JudgeCallRecord> => {
    if (!withinBudget(capKey)) {
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: null, promptTokens: 0, completionTokens: 0, costUsd: 0, error: "skipped-budget" };
    }
    const claimA = { text: pair.claim_a.text, workTitle: pair.claim_a.paper_title };
    const claimB = { text: pair.claim_b.text, workTitle: pair.claim_b.paper_title };
    try {
      if (cfg.mode === "structured-reasoning-first") {
        const { result, promptTokens, completionTokens, costUsd } = await callStructuredReasoningFirst(cfg.model, claimA, claimB, branch);
        runningCostUsd += costUsd;
        return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: result, promptTokens, completionTokens, costUsd };
      }
      const { result, promptTokens, completionTokens, costUsd, retried } = await callRawText(cfg.model, claimA, claimB, branch);
      runningCostUsd += costUsd;
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: result, promptTokens, completionTokens, costUsd, retried };
    } catch (err) {
      return { id: pair.id, domain: pair.resolvedDomain, goldLabel: pair.label, predicted: null, promptTokens: 0, completionTokens: 0, costUsd: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });
  const stageCost = records.reduce((s, r) => s + r.costUsd, 0);
  const skippedForBudget = records.filter((r) => r.error === "skipped-budget").length;
  const retriedCount = records.filter((r) => r.retried).length;
  costLedger.push({ stage: cfg.id, cell: cfg.label, costUsd: stageCost, calls: records.length });
  console.log(
    `  ${records.length} calls, ${records.filter((r) => r.error).length} failed (${skippedForBudget} skipped-budget), ` +
      `${retriedCount} retried, $${stageCost.toFixed(6)} (running total $${runningCostUsd.toFixed(6)})`,
  );

  const pooled = scoreRecords(records);
  const testRecords = records.filter((r) => testIds.has(r.id));
  const testSplit = testRecords.filter((r) => r.predicted !== null).length > 0 ? { n: testRecords.length, ...scoreRecords(testRecords) } : null;
  const domainSamples = records.filter((r) => r.predicted !== null).map((r) => ({ domain: r.domain, yTrue: r.goldLabel, yPred: r.predicted!.relationship }));
  const domainF1 = perDomainMacroF1(domainSamples);
  const classesBelowFloor = pooled.perClass.filter((c) => c.support > 0 && c.f1 < CLASS_F1_FLOOR).map((c) => c.className);
  const macroF1Pass = pooled.macroF1 >= JUDGE_VALENCE_MACRO_F1_MIN;
  const kappaPass = pooled.kappa >= JUDGE_KAPPA_MIN;
  const contradictionRecallPass = pooled.contradictionRecall >= JUDGE_CONTRADICTION_RECALL_MIN;
  const classFloorPass = classesBelowFloor.length === 0;
  const passedGates = macroF1Pass && kappaPass && contradictionRecallPass;

  console.log(
    `  pooled macroF1=${pooled.macroF1.toFixed(3)} (need>=${JUDGE_VALENCE_MACRO_F1_MIN}) kappa=${pooled.kappa.toFixed(3)} (need>=${JUDGE_KAPPA_MIN}) ` +
      `contradictionRecall=${pooled.contradictionRecall.toFixed(3)} (need>=${JUDGE_CONTRADICTION_RECALL_MIN}) → passedGates=${passedGates}`,
  );
  if (testSplit) {
    console.log(`  test-split (n=${testSplit.n}, reported not gate-relevant): macroF1=${testSplit.macroF1.toFixed(3)} kappa=${testSplit.kappa.toFixed(3)}`);
  }

  return {
    cell: cfg.id,
    label: cfg.label,
    model: cfg.model,
    mode: cfg.mode,
    records,
    pooled,
    testSplit,
    perDomainMacroF1: domainF1,
    passedGates,
    gateDetail: { macroF1Pass, kappaPass, contradictionRecallPass, classFloorPass, classesBelowFloor },
    costUsd: stageCost,
    nFailed: records.filter((r) => r.predicted === null).length,
    failedIds: records.filter((r) => r.predicted === null).map((r) => r.id),
  };
}

async function main() {
  const empiricalRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.empirical.json"), "utf8"));
  const empirical = empiricalRaw.map((p) => ({ ...p, resolvedDomain: p.domain ?? "empirical" }));
  console.log(`Loaded ${empirical.length} empirical gold pairs.`);

  const { train, test } = splitItems(empirical, 0.3);
  const testIds = new Set(test.map((p) => p.id));
  console.log(`Deterministic split (src/eval/split.ts, testFrac=0.3): ${train.length} train, ${test.length} test (reported only — no tuning happens in this script).`);

  console.log(`\n=== CELL 1: claude-haiku-4-5, BASELINE prompt, structured tool-use, reasoning-first schema ===`);
  const cell1 = await runCell(
    { id: "cell1", label: "claude-haiku-4-5 / structured-reasoning-first / baseline prompt", model: HAIKU_MODEL, modelShort: "haiku", mode: "structured-reasoning-first" },
    empirical,
    "empirical",
    testIds,
  );

  console.log(`\n=== CELL 2: claude-haiku-4-5, BASELINE prompt, raw-text mode ===`);
  const cell2 = await runCell(
    { id: "cell2", label: "claude-haiku-4-5 / raw-text / baseline prompt", model: HAIKU_MODEL, modelShort: "haiku", mode: "raw-text" },
    empirical,
    "empirical",
    testIds,
  );

  console.log(`\nRunning total after Cell 1 + Cell 2: $${runningCostUsd.toFixed(6)}`);

  let cell3: CellResult | null = null;
  const cell1Or2Passed = cell1.passedGates || cell2.passedGates;
  if (!cell1Or2Passed) {
    const winningMode: OutputMode = cell2.pooled.macroF1 > cell1.pooled.macroF1 ? "raw-text" : "structured-reasoning-first";
    console.log(
      `\nNeither Cell 1 (macroF1=${cell1.pooled.macroF1.toFixed(3)}) nor Cell 2 (macroF1=${cell2.pooled.macroF1.toFixed(3)}) cleared all gates. ` +
        `Escalating to CELL 3: claude-sonnet-4-6, baseline prompt, ${winningMode} (the higher-scoring mode of the two).`,
    );
    cell3 = await runCell(
      { id: "cell3", label: `claude-sonnet-4-6 / ${winningMode} / baseline prompt`, model: SONNET_MODEL, modelShort: "sonnet", mode: winningMode },
      empirical,
      "empirical",
      testIds,
    );
  } else {
    console.log(`\nAt least one of Cell 1 / Cell 2 cleared all gates — Cell 3 (sonnet escalation) is skipped per the task's own conditional.`);
  }

  console.log(`\nRunning total after all base cells: $${runningCostUsd.toFixed(6)}`);

  // ── Decide the cheapest passing config (by cell, matching pricing tiers) ──
  const allCells = [cell1, cell2, ...(cell3 ? [cell3] : [])];
  const passingCells = allCells.filter((c) => c.passedGates);
  let cheapestPassing: CellResult | null = null;
  if (passingCells.length > 0) {
    // haiku cells are always cheaper than a sonnet cell; among haiku cells,
    // tie-break on higher pooled macroF1 (there is no cost difference
    // between the two haiku modes worth discriminating on).
    const haikuPassing = passingCells.filter((c) => c.model === HAIKU_MODEL);
    cheapestPassing = haikuPassing.length > 0
      ? haikuPassing.reduce((best, c) => (c.pooled.macroF1 > best.pooled.macroF1 ? c : best))
      : passingCells[0];
  }
  console.log(`\nCheapest passing config: ${cheapestPassing ? `${cheapestPassing.label} (${cheapestPassing.cell})` : "NONE — no cell cleared all three gates"}`);

  // ── Humanities baseline (PROVISIONAL), only if a cell passed ────────────
  let humanitiesBaseline:
    | ({ cell: string; label: string; n: number; nFailed: number; costUsd: number } & ReturnType<typeof scoreRecords>)
    | null = null;
  if (cheapestPassing) {
    const humanitiesRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.humanities.json"), "utf8"));
    const humanities = humanitiesRaw.map((p) => ({ ...p, resolvedDomain: p.domain ?? "ancient_philosophy" }));
    console.log(`\n=== HUMANITIES BASELINE (PROVISIONAL): ${humanities.length} pairs, ${cheapestPassing.label}, branch:"humanities" ===`);
    const cfg: CellConfig = {
      id: "humanities-baseline",
      label: cheapestPassing.label,
      model: cheapestPassing.model,
      modelShort: cheapestPassing.model === HAIKU_MODEL ? "haiku" : "sonnet",
      mode: cheapestPassing.mode,
    };
    // Reuse runCell's dispatch/costing but score humanities pairs on their own
    // (no test-split concept for this file — pass an empty testIds set).
    const humanitiesResult = await runCell(cfg, humanities, "humanities", new Set());
    humanitiesBaseline = {
      cell: cheapestPassing.cell,
      label: cheapestPassing.label,
      n: humanitiesResult.records.length,
      nFailed: humanitiesResult.nFailed,
      costUsd: humanitiesResult.costUsd,
      ...humanitiesResult.pooled,
    };
    console.log(
      `  PROVISIONAL humanities macroF1=${humanitiesResult.pooled.macroF1.toFixed(3)} kappa=${humanitiesResult.pooled.kappa.toFixed(3)} ` +
        `contradictionRecall=${humanitiesResult.pooled.contradictionRecall.toFixed(3)}`,
    );
  } else {
    console.log(`\nNo cell passed gates — skipping the humanities baseline (humanitiesProvisional: null).`);
  }

  console.log(`\nGRAND TOTAL COST: $${runningCostUsd.toFixed(6)} (hard ceiling $${HARD_BUDGET_CEILING_USD})`);
  if (runningCostUsd > HARD_BUDGET_CEILING_USD) {
    console.error(`*** OVER BUDGET by $${(runningCostUsd - HARD_BUDGET_CEILING_USD).toFixed(6)} — stopping. ***`);
  }

  const rawOut = {
    generatedAt: new Date().toISOString(),
    goldCounts: { empirical: empirical.length, train: train.length, test: test.length },
    cells: allCells.map((c) => ({
      cell: c.cell,
      label: c.label,
      model: c.model,
      mode: c.mode,
      pooled: c.pooled,
      testSplit: c.testSplit,
      perDomainMacroF1: c.perDomainMacroF1,
      passedGates: c.passedGates,
      gateDetail: c.gateDetail,
      costUsd: c.costUsd,
      nFailed: c.nFailed,
      failedIds: c.failedIds,
    })),
    cheapestPassing: cheapestPassing ? { cell: cheapestPassing.cell, label: cheapestPassing.label, model: cheapestPassing.model, mode: cheapestPassing.mode } : null,
    humanitiesBaseline,
    cost: { totalUsd: runningCostUsd, ledger: costLedger },
    rawRecordsByCell: Object.fromEntries(allCells.map((c) => [c.cell, c.records])),
  };
  writeFileSync(join(OUT_DIR, "spike-25-5c-output-mode.raw.json"), JSON.stringify(rawOut, null, 2));

  return rawOut;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
