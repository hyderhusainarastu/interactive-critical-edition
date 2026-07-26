import { describe, expect, it } from "vitest";
import {
  CLASS_F1_FLOOR,
  CLAIM_NATURE_MACRO_F1_MIN,
  EMPIRICAL_REGRESSION_MAX,
  HUMANITIES_BRANCH_DELTA_MIN,
  JUDGE_CONTRADICTION_RECALL_MIN,
  JUDGE_KAPPA_MIN,
  JUDGE_VALENCE_MACRO_F1_MIN,
  MECHANISM_ACCURACY_MIN,
  MIN_GOLD_PER_VALUE,
} from "./gates";

describe("eval gates", () => {
  it("every fractional gate is a valid probability in (0,1]", () => {
    const fractional = [
      JUDGE_VALENCE_MACRO_F1_MIN,
      JUDGE_KAPPA_MIN,
      JUDGE_CONTRADICTION_RECALL_MIN,
      HUMANITIES_BRANCH_DELTA_MIN,
      MECHANISM_ACCURACY_MIN,
      EMPIRICAL_REGRESSION_MAX,
      CLASS_F1_FLOOR,
      CLAIM_NATURE_MACRO_F1_MIN,
    ];
    for (const gate of fractional) {
      expect(gate).toBeGreaterThan(0);
      expect(gate).toBeLessThanOrEqual(1);
    }
  });

  it("MIN_GOLD_PER_VALUE is a positive integer", () => {
    expect(Number.isInteger(MIN_GOLD_PER_VALUE)).toBe(true);
    expect(MIN_GOLD_PER_VALUE).toBeGreaterThan(0);
  });

  it("the ScholarLens-derived gates leave margin below the measured numbers (0.788 macro-F1, 0.683 kappa)", () => {
    expect(JUDGE_VALENCE_MACRO_F1_MIN).toBeLessThan(0.788);
    expect(JUDGE_KAPPA_MIN).toBeLessThan(0.683);
  });

  it("JUDGE_CONTRADICTION_RECALL_MIN is at least as strict as the general class floor", () => {
    expect(JUDGE_CONTRADICTION_RECALL_MIN).toBeGreaterThanOrEqual(CLASS_F1_FLOOR);
  });
});
