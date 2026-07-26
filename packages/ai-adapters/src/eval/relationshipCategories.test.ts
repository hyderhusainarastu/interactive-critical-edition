import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assignSplit, cohenKappa, confusionMatrix, macroF1, perClassPRF1, type ConfusionMatrix } from "@ice/claims";
import { classifyRelationship } from "../index";
import { heuristicClassify } from "../providers/heuristic";
import { RELATIONSHIP_CATEGORIES, type ClassificationInput, type RelationshipCategory } from "../types";
import { parseGoldRelationshipCategoryFile, type GoldRelationshipCategoryExample } from "./goldSchema";

/**
 * Phase 29.3 eval-discipline retrofit: applies the `@ice/claims` eval
 * toolkit (confusion matrix, per-class P/R/F1, macro-F1, Cohen's kappa,
 * deterministic SHA-256 train/test split) — built for the new claims
 * judge — onto the EXISTING 10-category relationship classifier
 * (`classifyRelationship`/`heuristicClassify`, plan §5/§12). This is a
 * measurement upgrade only: neither the classifier nor the heuristic is
 * changed here. `../eval.test.ts` (Phase 7's original harness, a 9-case
 * accuracy-threshold check) is left exactly as-is; this file is additive.
 *
 * Why the ratchet gate runs over the FULL gold set rather than a held-out
 * test partition: `@ice/claims`'s train/test split exists to hold out data
 * a *tunable* system (a prompt, a fitted threshold) shouldn't be evaluated
 * on after being fit against the rest. `heuristicClassify` is a fixed,
 * hand-written regex/keyword classifier with no fitting step — there is
 * nothing to "train" on the train partition, so partitioning would only
 * throw away measurement signal for no corresponding benefit. The split is
 * still computed and reported below (via `assignSplit`, the same function
 * `@ice/claims` uses) because it's needed the moment this harness is
 * pointed at a *tunable* system — e.g. a future prompt-engineering pass on
 * `CLASSIFY_PROMPT_VERSION` — and because reporting it now is what proves
 * the split is wired correctly before anything depends on it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const GOLD_PATH = join(here, "gold", "relationshipCategories.json");

const GOLD: GoldRelationshipCategoryExample[] = parseGoldRelationshipCategoryFile(readFileSync(GOLD_PATH, "utf8"));

const MIN_GOLD_TOTAL = 50;
const MIN_GOLD_PER_CATEGORY = 4;

function toInput(g: GoldRelationshipCategoryExample): ClassificationInput {
  return {
    primaryTitle: g.primaryTitle,
    primaryAuthor: g.primaryAuthor,
    candidateTitle: g.candidateTitle,
    candidateAuthor: g.candidateAuthor,
    sourceText: g.sourceText,
    resolved: g.resolved,
    citationFrequency: g.citationFrequency,
  };
}

/** Formats a confusion-matrix-derived report the same shape whether it's
 *  fed the heuristic's or (in paid mode) a real provider's predictions —
 *  so the two runs are legible side by side. */
function report(label: string, yTrue: string[], yPred: string[]) {
  const cm: ConfusionMatrix = confusionMatrix(yTrue, yPred, [...RELATIONSHIP_CATEGORIES]);
  const perClass = perClassPRF1(cm);
  const macro = macroF1(cm);
  const kappa = cohenKappa(cm);

  const lines: string[] = [];
  lines.push(`\n=== Relationship-category eval: ${label} ===`);
  lines.push(`gold size: ${yTrue.length}`);
  lines.push(
    "class".padEnd(38) + "support".padStart(8) + "precision".padStart(11) + "recall".padStart(9) + "f1".padStart(7),
  );
  for (const row of perClass) {
    lines.push(
      row.className.padEnd(38) +
        String(row.support).padStart(8) +
        row.precision.toFixed(3).padStart(11) +
        row.recall.toFixed(3).padStart(9) +
        row.f1.toFixed(3).padStart(7),
    );
  }
  lines.push(`macro-F1: ${macro.toFixed(4)}`);
  lines.push(`Cohen's kappa: ${kappa.toFixed(4)}`);
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));

  return { cm, perClass, macro, kappa };
}

describe("relationship-category gold set (packages/ai-adapters/src/eval/gold/relationshipCategories.json)", () => {
  it(`has at least ${MIN_GOLD_TOTAL} examples`, () => {
    expect(GOLD.length).toBeGreaterThanOrEqual(MIN_GOLD_TOTAL);
  });

  it(`has at least ${MIN_GOLD_PER_CATEGORY} examples per category, for all ${RELATIONSHIP_CATEGORIES.length} categories`, () => {
    const counts = new Map<RelationshipCategory, number>();
    for (const cat of RELATIONSHIP_CATEGORIES) counts.set(cat, 0);
    for (const g of GOLD) counts.set(g.category, (counts.get(g.category) ?? 0) + 1);

    const short = [...counts.entries()].filter(([, n]) => n < MIN_GOLD_PER_CATEGORY);
    expect(short, `categories under the floor: ${JSON.stringify(short)}`).toEqual([]);
  });

  it("every id is unique", () => {
    const ids = GOLD.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports a deterministic SHA-256 train/test split over the gold set (30% test)", () => {
    const splits = GOLD.map((g) => assignSplit(g.id, 0.3));
    const testCount = splits.filter((s) => s === "test").length;
    // eslint-disable-next-line no-console
    console.log(`\ntrain/test split: ${splits.length - testCount} train / ${testCount} test`);
    // Purely a sanity bound on the split mechanism, not a gate on the
    // classifier — see the file header for why the ratchet below scores
    // the full set rather than a held-out partition.
    expect(testCount).toBeGreaterThan(0);
    expect(testCount).toBeLessThan(splits.length);
  });
});

// Measured 2026-07-26 against this exact gold set (60 examples, 6/category)
// on `heuristicClassify` (no API key configured in this environment — see
// Design Decisions in docs/PROJECT-LOG.md for why the deterministic
// heuristic is the CI-safe baseline): macro-F1 = 0.8472, Cohen's kappa =
// 0.8704. Two real, reportable gaps drive the imperfect score (see this
// lane's report for the full writeup, not fixed here — measurement only):
// (1) `optional_extension` scores 0/0/0 (zero recall) because
// `heuristicClassify` has no rule that can ever produce that category —
// every gold example for it gets pulled into `explicit_reference` or
// `ai_inferred` by the default-branch fallback; (2) the disagreement rule's
// `criticiz` stem (`providers/heuristic.ts` RULES[0]) never actually
// matches any real inflected form ("criticizes"/"criticizing") because the
// regex's `\b` immediately after `criticiz` fails whenever more word
// characters follow it — a latent dead-code trigger this eval surfaced.
// Floor is that measurement minus a 0.02 margin, matching
// `@ice/claims/src/eval/gates.ts`'s own regression-margin convention
// (`EMPIRICAL_REGRESSION_MAX`). Re-measure and update this comment (with a
// new date) whenever the gold set or the heuristic changes deliberately; a
// silent drop below the floor should fail CI, not get quietly re-baselined.
const RATCHET_FLOOR_MACRO_F1 = 0.8272;

describe("heuristicClassify — CI-safe, zero-network macro-F1/kappa/confusion-matrix gate", () => {
  it("meets the ratchet floor on the full gold set", () => {
    const yTrue = GOLD.map((g) => g.category);
    const yPred = GOLD.map((g) => heuristicClassify(toInput(g)).category);

    const { macro } = report("heuristicClassify (deterministic baseline)", yTrue, yPred);

    expect(
      macro,
      `macro-F1 ${macro.toFixed(4)} fell below the ${RATCHET_FLOOR_MACRO_F1} ratchet floor — see the dated ` +
        `comment above this test for the measurement this floor is based on.`,
    ).toBeGreaterThanOrEqual(RATCHET_FLOOR_MACRO_F1);
  });

  it("never fabricates a bibliographic fact regardless of gold label — confidence stays honest", () => {
    // Same invariant `../eval.test.ts` already checks on a smaller fixture
    // set, re-verified here across the full 10-category gold set: an
    // unresolved candidate never gets a high-confidence verdict, whatever
    // category the heuristic lands on.
    for (const g of GOLD.filter((g) => !g.resolved)) {
      const result = heuristicClassify(toInput(g));
      expect(result.confidence, `${g.id}: unresolved candidate scored confidence ${result.confidence}`).toBeLessThan(0.5);
    }
  });
});

// ── Optional paid mode: RUN_PAID_EVAL=1 scores the real LLM classifier ──
//
// Not run by this lane — measurement-only scope, no paid calls (see
// docs/PROJECT-LOG.md's Phase 29.3 task). A future gate sets
// OPENAI_API_KEY/ANTHROPIC_API_KEY and RUN_PAID_EVAL=1 to exercise this,
// then records its own measured macro-F1/kappa and (per the ScholarLens
// eval-gate precedent in packages/claims/src/eval/gates.ts) decides
// whether to raise CLASSIFY_PROMPT_VERSION's real-model floor above the
// heuristic's.
const RUN_PAID_EVAL = process.env.RUN_PAID_EVAL === "1";
const HAS_PROVIDER_KEY = Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY);

describe.skipIf(!RUN_PAID_EVAL)("classifyRelationship — real LLM classifier (paid, RUN_PAID_EVAL=1 only)", () => {
  it("meets a to-be-set gate against the real model", async () => {
    if (!HAS_PROVIDER_KEY) {
      throw new Error(
        "RUN_PAID_EVAL=1 was set but neither OPENAI_API_KEY nor ANTHROPIC_API_KEY is configured — " +
          "classifyRelationship() would silently fall back to the heuristic and this run would not " +
          "measure what it claims to. Set a provider key or unset RUN_PAID_EVAL.",
      );
    }

    const yTrue = GOLD.map((g) => g.category);
    const predictions = await Promise.all(GOLD.map((g) => classifyRelationship(toInput(g))));
    const yPred = predictions.map((p) => p.category);

    const { macro, kappa } = report("classifyRelationship (real provider, paid)", yTrue, yPred);

    // Deliberately no assertion floor yet — this mode has never been run
    // against real spend. The next session/lane to actually run it (with
    // owner-authorized cost) should measure, record the number with a
    // dated comment exactly like RATCHET_FLOOR_MACRO_F1 above, and only
    // then add a real gate here.
    expect(macro).toBeGreaterThanOrEqual(0);
    expect(kappa).toBeGreaterThanOrEqual(-1);
  });
});
