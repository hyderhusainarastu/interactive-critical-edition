/**
 * Phase 27.3 — humanities judge promotion gate.
 *
 * Runs the now-RATIFIED humanities gold set (`gold/relationshipPairs.humanities.json`,
 * `gold/RATIFICATION.md`, ratified 2026-07-26) through the four floors in
 * `packages/claims/src/eval/gates.ts` that decide whether the humanities-aware
 * judge branch (discipline preamble + stage-2 mechanism labeling,
 * `taxonomy.ts`'s `STAGE2_MECHANISMS`) is trusted enough to ship.
 *
 * Production judge config throughout (per the moderator's 2026-07-26 decision,
 * `docs/eval/research-claims/spike-25-5c-output-mode.md` "Moderator decision"):
 * claude-haiku-4-5, the BASELINE judge prompt (`buildJudgePrompt` — every v2
 * addition off), called RAW-TEXT-VALIDATED via `AnthropicTextJsonClient` (not
 * forced tool-use). This script uses that exact production client, not the
 * eval-only fence-strip helper `judge-eval-output-mode.mts` used before the
 * client existed.
 *
 * Three stages, run in this order:
 *
 *   STAGE A ("base", ~36 calls): `buildJudgePrompt` with `branch: "empirical"`
 *     — the plain, discipline-unaware judge — applied to the ratified
 *     humanities gold set. This is the "base" half of the
 *     HUMANITIES_BRANCH_DELTA_MIN comparison: does the humanities-specific
 *     preamble/mechanism-field addition actually help over the generic judge
 *     on humanities-domain data, or does the generic judge already do fine?
 *     Scored on valence metrics only (no mechanismDraft to compare against —
 *     branch:"empirical" never asks for a mechanism).
 *
 *   STAGE B ("humanities branch", ~36 calls): `buildJudgePrompt` with
 *     `branch: "humanities"` (the discipline-aware preamble + optional
 *     mechanism field) over the same ratified humanities set. This
 *     reproduces (now on ratified, not provisional, gold) the exact config
 *     Phase 25.5c's own "PROVISIONAL humanities baseline" measured at
 *     macroF1 0.795/kappa 0.688/contradictionRecall 1.000. Scored on valence
 *     metrics AND mechanism accuracy: predicted `mechanism` vs. gold
 *     `mechanismDraft` on the 11 nuance records that carry one (a null
 *     prediction on a mechanism-bearing record counts as a miss; records
 *     without a `mechanismDraft` don't count toward the denominator).
 *
 *   STAGE C ("empirical regression", ~42 calls): the SAME humanities-branch
 *     config (`branch: "humanities"`) run over the EMPIRICAL 42-pair gold
 *     set (`relationshipPairs.empirical.json`), to check that turning on the
 *     humanities-branch code path doesn't regress performance on the
 *     already-certified empirical domain (certified baseline: macroF1 0.752,
 *     raw-text haiku, `spike-25-5c-output-mode.md` Cell 2). Measured, not
 *     assumed — the branch preamble is domain-conditional but the mechanism
 *     field is only ever *requested*, never required, so in principle it
 *     could still perturb empirical-domain judging.
 *
 * HARD BUDGET: $0.60 total, single running cost ledger across all three
 * stages, using real per-call token cost (`estimateCostUsd`). Dispatch stops
 * the moment projected spend would exceed the ceiling; remaining pairs in a
 * stage are marked "skipped-budget".
 *
 * Run: npx tsx scripts/research/judge-eval-27-3-humanities-gate.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadWorkerEnv } from "./env.mjs";
import { AnthropicTextJsonClient } from "../../packages/ai-adapters/src/anthropicTextJson";
import { estimateCostUsd } from "../../packages/ai-adapters/src/routing";
import { buildJudgePrompt, validateJudgeResponse, type JudgeResult } from "../../packages/claims/src/prompts/judge";
import { CLAIM_RELATION_VALENCES } from "../../packages/claims/src/taxonomy";
import {
  parseGoldRelationshipPairsFile,
  type GoldRelationshipPair,
} from "../../packages/claims/src/eval/goldSchema";
import { confusionMatrix, perClassPRF1, macroF1, cohenKappa } from "../../packages/claims/src/eval/metrics";
import {
  HUMANITIES_BRANCH_DELTA_MIN,
  MECHANISM_ACCURACY_MIN,
  EMPIRICAL_REGRESSION_MAX,
  CLASS_F1_FLOOR,
} from "../../packages/claims/src/eval/gates";

loadWorkerEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLD_DIR = join(__dirname, "../../packages/claims/src/eval/gold");
const OUT_DIR = join(__dirname, "../../docs/eval/research-claims");

const HAIKU_MODEL = "claude-haiku-4-5-20251001"; // matches routing.ts PRICE_PER_MTOK + spike-25-5c
const JUDGE_SYSTEM =
  "You are a careful academic peer-reviewer comparing two research claims from different works. Follow the instructions exactly and return only the requested structured fields.";

// ── Certified reference numbers (not re-derived, cited for comparison) ──
const CERTIFIED_EMPIRICAL_MACRO_F1 = 0.752; // spike-25-5c-output-mode.md Cell 2, raw-text haiku, baseline prompt

// ── Budget guard ──────────────────────────────────────────────────────
const HARD_BUDGET_CEILING_USD = 0.6;
const PER_CALL_COST_CAP = 0.01; // padded above spike-25-5c's measured ~$0.0017-0.002/call raw-text haiku
let runningCostUsd = 0;
const costLedger: { stage: string; costUsd: number; calls: number }[] = [];

function withinBudget(): boolean {
  return runningCostUsd + PER_CALL_COST_CAP <= HARD_BUDGET_CEILING_USD;
}

const client = new AnthropicTextJsonClient();

interface CallRecord {
  id: string;
  goldLabel: string;
  goldMechanism: string | null;
  predicted: JudgeResult | null;
  costUsd: number;
  error?: string;
}

async function judgeOne(
  pair: GoldRelationshipPair,
  branch: "empirical" | "humanities",
): Promise<CallRecord> {
  const goldMechanism = pair.mechanismDraft ?? null;
  if (!withinBudget()) {
    return { id: pair.id, goldLabel: pair.label, goldMechanism, predicted: null, costUsd: 0, error: "skipped-budget" };
  }
  const claimA = { text: pair.claim_a.text, workTitle: pair.claim_a.paper_title };
  const claimB = { text: pair.claim_b.text, workTitle: pair.claim_b.paper_title };
  const prompt = buildJudgePrompt({ claimA, claimB, branch });
  const res = await client.call<JudgeResult>({
    model: HAIKU_MODEL,
    system: JUDGE_SYSTEM,
    user: prompt,
    maxOutputTokens: 600,
    validate: (parsed) => validateJudgeResponse(parsed),
  });
  const costUsd = estimateCostUsd(HAIKU_MODEL, res.promptTokens, res.completionTokens);
  runningCostUsd += costUsd;
  if (!res.ok) {
    return { id: pair.id, goldLabel: pair.label, goldMechanism, predicted: null, costUsd, error: res.error };
  }
  return { id: pair.id, goldLabel: pair.label, goldMechanism, predicted: res.data, costUsd };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function scoreValence(records: CallRecord[]) {
  const succeeded = records.filter((r) => r.predicted !== null);
  const yTrue = succeeded.map((r) => r.goldLabel);
  const yPred = succeeded.map((r) => r.predicted!.relationship);
  const cm = confusionMatrix(yTrue, yPred, [...CLAIM_RELATION_VALENCES]);
  const perClass = perClassPRF1(cm);
  const contradictionRow = perClass.find((c) => c.className === "contradiction");
  const classesBelowFloor = perClass.filter((c) => c.support > 0 && c.f1 < CLASS_F1_FLOOR).map((c) => c.className);
  return {
    n: records.length,
    nFailed: records.filter((r) => r.predicted === null).length,
    macroF1: macroF1(cm),
    kappa: cohenKappa(cm),
    contradictionRecall: contradictionRow?.recall ?? 0,
    perClass,
    classesBelowFloor,
  };
}

function scoreMechanism(records: CallRecord[]) {
  const mechanismBearing = records.filter((r) => r.goldMechanism !== null);
  let correct = 0;
  const confusion: { id: string; gold: string; predicted: string | null }[] = [];
  for (const r of mechanismBearing) {
    const predictedMechanism = r.predicted?.mechanism ?? null;
    const isCorrect = predictedMechanism === r.goldMechanism;
    if (isCorrect) correct += 1;
    confusion.push({ id: r.id, gold: r.goldMechanism!, predicted: predictedMechanism });
  }
  return {
    n: mechanismBearing.length,
    correct,
    accuracy: mechanismBearing.length > 0 ? correct / mechanismBearing.length : 0,
    confusion,
  };
}

async function runStage(
  label: string,
  pairs: GoldRelationshipPair[],
  branch: "empirical" | "humanities",
): Promise<{ label: string; branch: string; records: CallRecord[]; valence: ReturnType<typeof scoreValence>; costUsd: number }> {
  console.log(`\n--- ${label} (branch:"${branch}", n=${pairs.length}) ---`);
  const records = await mapWithConcurrency(pairs, 4, (pair) => judgeOne(pair, branch));
  const stageCost = records.reduce((s, r) => s + r.costUsd, 0);
  const skipped = records.filter((r) => r.error === "skipped-budget").length;
  const otherFailed = records.filter((r) => r.error && r.error !== "skipped-budget").length;
  costLedger.push({ stage: label, costUsd: stageCost, calls: records.length });
  console.log(
    `  ${records.length} calls, ${otherFailed} failed, ${skipped} skipped-budget, $${stageCost.toFixed(6)} (running total $${runningCostUsd.toFixed(6)})`,
  );
  const valence = scoreValence(records);
  console.log(
    `  macroF1=${valence.macroF1.toFixed(3)} kappa=${valence.kappa.toFixed(3)} contradictionRecall=${valence.contradictionRecall.toFixed(3)} classesBelowFloor=[${valence.classesBelowFloor.join(", ")}]`,
  );
  return { label, branch, records, valence, costUsd: stageCost };
}

async function main() {
  const humanitiesRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.humanities.json"), "utf8"));
  const empiricalRaw = parseGoldRelationshipPairsFile(readFileSync(join(GOLD_DIR, "relationshipPairs.empirical.json"), "utf8"));

  // Sanity: this script only produces a valid gate reading if the humanities
  // gold data is actually ratified (RATIFICATION.md's own documented rule —
  // "the humanities judge gate ... must treat only provisional: false
  // records as gold"). Fail loudly rather than silently scoring drafts.
  const stillProvisional = humanitiesRaw.filter((p) => p.provisional === true);
  if (stillProvisional.length > 0) {
    throw new Error(
      `${stillProvisional.length} humanities gold record(s) are still provisional:true (${stillProvisional.map((p) => p.id).join(", ")}) — ratify before running this gate.`,
    );
  }
  console.log(`Loaded ${humanitiesRaw.length} ratified humanities pairs, ${empiricalRaw.length} empirical pairs.`);

  const mechanismBearingCount = humanitiesRaw.filter((p) => p.mechanismDraft != null).length;
  console.log(`${mechanismBearingCount} humanities pairs carry a gold mechanismDraft.`);

  // ── STAGE A: base (branch:"empirical") on humanities data ─────────────
  const stageA = await runStage("STAGE A — base (branch:empirical) on humanities set", humanitiesRaw, "empirical");

  // ── STAGE B: humanities branch on humanities data ──────────────────────
  const stageB = await runStage("STAGE B — humanities branch (branch:humanities) on humanities set", humanitiesRaw, "humanities");
  const mechanism = scoreMechanism(stageB.records);
  console.log(`  mechanism accuracy: ${mechanism.correct}/${mechanism.n} = ${mechanism.accuracy.toFixed(3)}`);

  // ── STAGE C: humanities-branch config on EMPIRICAL data (regression) ──
  const stageC = await runStage("STAGE C — humanities branch (branch:humanities) on empirical set (regression check)", empiricalRaw, "humanities");

  console.log(`\nGRAND TOTAL COST: $${runningCostUsd.toFixed(6)} (hard ceiling $${HARD_BUDGET_CEILING_USD})`);
  if (runningCostUsd > HARD_BUDGET_CEILING_USD) {
    console.error(`*** OVER BUDGET by $${(runningCostUsd - HARD_BUDGET_CEILING_USD).toFixed(6)} — stopping. ***`);
  }

  // ── Gate verdicts (the four floors this task's own directive lists) ───
  const delta = stageB.valence.macroF1 - stageA.valence.macroF1;
  const deltaPass = delta >= HUMANITIES_BRANCH_DELTA_MIN;

  const mechanismPass = mechanism.accuracy >= MECHANISM_ACCURACY_MIN;

  const empiricalRegression = CERTIFIED_EMPIRICAL_MACRO_F1 - stageC.valence.macroF1; // positive = a drop
  const regressionPass = empiricalRegression <= EMPIRICAL_REGRESSION_MAX;

  const classesBelowFloorAnywhere = [...new Set([...stageB.valence.classesBelowFloor, ...stageC.valence.classesBelowFloor])];
  const classFloorPass = classesBelowFloorAnywhere.length === 0;

  const outrightPass = deltaPass && mechanismPass && regressionPass && classFloorPass;

  console.log(`\n=== GATE VERDICT ===`);
  console.log(`delta (branch - base): ${delta.toFixed(3)} >= ${HUMANITIES_BRANCH_DELTA_MIN} ? ${deltaPass}`);
  console.log(`mechanism accuracy: ${mechanism.accuracy.toFixed(3)} >= ${MECHANISM_ACCURACY_MIN} ? ${mechanismPass}`);
  console.log(`empirical regression: ${empiricalRegression.toFixed(3)} <= ${EMPIRICAL_REGRESSION_MAX} ? ${regressionPass}`);
  console.log(`class floor: classesBelowFloor=[${classesBelowFloorAnywhere.join(", ")}] ? ${classFloorPass}`);
  console.log(`OUTRIGHT PASS: ${outrightPass}`);

  const out = {
    generatedAt: new Date().toISOString(),
    goldCounts: { humanities: humanitiesRaw.length, mechanismBearing: mechanismBearingCount, empirical: empiricalRaw.length },
    stageA: { label: stageA.label, branch: stageA.branch, valence: stageA.valence, costUsd: stageA.costUsd, records: stageA.records },
    stageB: { label: stageB.label, branch: stageB.branch, valence: stageB.valence, mechanism, costUsd: stageB.costUsd, records: stageB.records },
    stageC: { label: stageC.label, branch: stageC.branch, valence: stageC.valence, costUsd: stageC.costUsd, records: stageC.records },
    gate: {
      delta,
      deltaPass,
      mechanismAccuracy: mechanism.accuracy,
      mechanismPass,
      empiricalRegression,
      regressionPass,
      classesBelowFloorAnywhere,
      classFloorPass,
      outrightPass,
    },
    certifiedEmpiricalMacroF1: CERTIFIED_EMPIRICAL_MACRO_F1,
    cost: { totalUsd: runningCostUsd, ledger: costLedger },
  };
  writeFileSync(join(OUT_DIR, "gate-27-3-humanities.raw.json"), JSON.stringify(out, null, 2));
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
