import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { cohenKappa, confusionMatrix, macroF1, perClassPRF1, splitItems } from "@ice/claims";

import { classifyCitationForm } from "../types";
import { parseGoldCitationFormFile, type GoldCitationFormExample } from "./goldSchema";

/**
 * Eval retrofit for `classifyCitationForm` (Phase 29.3, ScholarLens
 * reverse-direction eval-discipline upgrade — see
 * `docs/architecture/scholarlens-integration-plan.md`, "What ScholarLens
 * improves in *existing* Palimnote (reverse direction)").
 *
 * CI-safe and zero-network by construction: `classifyCitationForm` is a pure
 * regex-based function over a string, so this whole file never touches a
 * provider, a database, or an LLM. Its only job is measuring that pure
 * function against `gold/citationForms.json` with the same metric/split
 * machinery `@ice/claims`'s judge eval uses (`macroF1`/`cohenKappa`/
 * `confusionMatrix`/`splitItems`) — not a parallel, ad hoc scoring scheme.
 *
 * Ratchet discipline: the floor below is measured, then hard-coded with a
 * dated comment (see `RATCHET_MACRO_F1_FLOOR`) — never asserted "aspirationally"
 * ahead of a real number. A future change to `classifyCitationForm`'s
 * regexes/branch order should either keep clearing this floor, or the floor
 * (and its dated comment) should be deliberately re-measured and updated in
 * the same commit that explains why the score moved.
 */

const GOLD_PATH = join(dirname(fileURLToPath(import.meta.url)), "gold", "citationForms.json");
const CITATION_FORM_CLASSES = ["book", "journal", "classical", "unknown"] as const;

function loadGold(): GoldCitationFormExample[] {
  return parseGoldCitationFormFile(readFileSync(GOLD_PATH, "utf-8"));
}

/**
 * Below this, a class has too few gold examples for its own precision/
 * recall/F1 to mean much (same discipline as `@ice/claims`'s
 * `MIN_GOLD_PER_VALUE`) — reported regardless, but not a reason on its own
 * to treat a low per-class score as a regression.
 */
const MIN_GOLD_PER_CLASS = 6;

function formatTable(rows: Array<Record<string, string | number>>): string {
  if (rows.length === 0) return "(no rows)";
  const cols = Object.keys(rows[0]);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(cols), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(cols.map((c) => String(r[c]))))].join(
    "\n",
  );
}

describe("classifyCitationForm — gold-set eval", () => {
  const gold = loadGold();
  const yTrue = gold.map((g) => g.goldForm);
  const yPred = gold.map((g) => classifyCitationForm(g.citation));
  const cm = confusionMatrix(yTrue, yPred, [...CITATION_FORM_CLASSES]);
  const perClass = perClassPRF1(cm);
  const overallMacroF1 = macroF1(cm);
  const kappa = cohenKappa(cm);

  const { train, test } = splitItems(gold, 0.3);
  const trainCm = confusionMatrix(
    train.map((g) => g.goldForm),
    train.map((g) => classifyCitationForm(g.citation)),
    [...CITATION_FORM_CLASSES],
  );
  const testCm = confusionMatrix(
    test.map((g) => g.goldForm),
    test.map((g) => classifyCitationForm(g.citation)),
    [...CITATION_FORM_CLASSES],
  );
  const trainMacroF1 = macroF1(trainCm);
  const testMacroF1 = macroF1(testCm);

  it("loads a gold set of at least 40 labeled citations, every one sourced", () => {
    expect(gold.length).toBeGreaterThanOrEqual(40);
    for (const g of gold) {
      expect(g.source.length).toBeGreaterThan(0);
    }
  });

  it("prints the full per-class table, confusion matrix, and split breakdown (before/after visibility for future changes)", () => {
    // eslint-disable-next-line no-console
    console.log(`\nclassifyCitationForm gold-set eval — n=${gold.length} (train=${train.length}, test=${test.length})\n`);
    // eslint-disable-next-line no-console
    console.log(
      formatTable(
        perClass.map((c) => ({
          class: c.className,
          precision: c.precision.toFixed(3),
          recall: c.recall.toFixed(3),
          f1: c.f1.toFixed(3),
          support: c.support,
        })),
      ),
    );
    // eslint-disable-next-line no-console
    console.log(`\nmacro-F1 (full set): ${overallMacroF1.toFixed(4)}`);
    // eslint-disable-next-line no-console
    console.log(`Cohen's kappa (full set): ${kappa.toFixed(4)}`);
    // eslint-disable-next-line no-console
    console.log(`macro-F1 (train split, n=${train.length}): ${trainMacroF1.toFixed(4)}`);
    // eslint-disable-next-line no-console
    console.log(`macro-F1 (test split, n=${test.length}): ${testMacroF1.toFixed(4)}`);
    // eslint-disable-next-line no-console
    console.log("\nConfusion matrix (rows=gold, cols=predicted):");
    // eslint-disable-next-line no-console
    console.log(formatTable(cm.classes.map((cls, i) => ({ gold: cls, ...Object.fromEntries(cm.classes.map((c2, j) => [c2, cm.matrix[i][j]])) }))));

    const misclassified = gold
      .map((g, i) => ({ g, pred: yPred[i] }))
      .filter(({ g, pred }) => pred !== g.goldForm);
    // eslint-disable-next-line no-console
    console.log(`\nMisclassifications (${misclassified.length}):`);
    for (const { g, pred } of misclassified) {
      // eslint-disable-next-line no-console
      console.log(
        `  [${g.id}] gold=${g.goldForm} pred=${pred}${g.provisional ? " (provisional gold label)" : ""} — "${g.citation}"`,
      );
    }

    // This test only reports — the assertions that actually gate the suite
    // are below. Always-true so this table prints on every run, including
    // green ones (Vitest still shows console output from a passing test).
    expect(cm.classes).toEqual([...CITATION_FORM_CLASSES]);
  });

  /**
   * RATCHET FLOOR — measured 2026-07-26 against the 43-example gold set
   * above: full-set macro-F1 = 0.9558 (4 sig figs from the measured run —
   * see this test file's own printed table for the exact per-class
   * breakdown at any time: book P=1.000/R=0.857/F1=0.923, journal
   * P=0.818/R=1.000/F1=0.900, classical P=1.000/R=1.000/F1=1.000, unknown
   * P=1.000/R=1.000/F1=1.000; Cohen's kappa = 0.9377). The two misses are
   * both the deliberately provisional cf_042/cf_043 chapter-in-edited-volume
   * probes (see their `notes` in `gold/citationForms.json`), not a surprise.
   * Floor set to that measurement minus 0.02 (0.9558 - 0.02 = 0.9358), per
   * this lane's brief: "measure first, then hard-code the floor." A
   * regression below this floor means a change to `classifyCitationForm`'s
   * regexes/branch order made real citations misclassify — investigate
   * before assuming the floor itself is wrong. Raising the floor after a
   * genuine improvement is expected maintenance, not a special event; when
   * doing so, re-run this test and copy the newly printed macro-F1, matching
   * this same dated-comment discipline.
   */
  const RATCHET_MACRO_F1_FLOOR = 0.9358;

  it(`meets the macro-F1 ratchet floor (>= ${RATCHET_MACRO_F1_FLOOR}, measured 2026-07-26 minus 0.02 margin)`, () => {
    expect(overallMacroF1).toBeGreaterThanOrEqual(RATCHET_MACRO_F1_FLOOR);
  });

  it("reports per-class F1 with at least the minimum gold support per class (informational floor, not a hard gate)", () => {
    for (const c of perClass) {
      if (c.support < MIN_GOLD_PER_CLASS) {
        // eslint-disable-next-line no-console
        console.warn(
          `[classifyCitationForm eval] class "${c.className}" has only ${c.support} gold examples (< ${MIN_GOLD_PER_CLASS}) — its F1 (${c.f1.toFixed(3)}) is too noisy to gate on alone.`,
        );
      }
    }
    // Every class in this gold set does clear the minimum support today;
    // this assertion catches the set shrinking back below it later.
    for (const c of perClass) {
      expect(c.support).toBeGreaterThan(0);
    }
  });

  it("classifies every non-provisional gold example correctly (provisional edge-case labels are allowed to miss — see cf_042/cf_043)", () => {
    const nonProvisionalMisses = gold
      .map((g, i) => ({ g, pred: yPred[i] }))
      .filter(({ g, pred }) => !g.provisional && pred !== g.goldForm);
    expect(nonProvisionalMisses.map(({ g, pred }) => `${g.id}: gold=${g.goldForm} pred=${pred}`)).toEqual([]);
  });
});
