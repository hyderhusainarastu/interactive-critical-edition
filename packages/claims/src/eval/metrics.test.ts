import { describe, expect, it } from "vitest";
import {
  binaryTensionF1,
  cohenKappa,
  confusionMatrix,
  macroF1,
  perClassPRF1,
  perDomainMacroF1,
} from "./metrics";

// ── Shared hand-computed fixture ────────────────────────────────
// yTrue = [a, a, b, b], yPred = [a, b, b, b]
//
// Confusion matrix (rows=true, cols=pred, classes sorted [a,b]):
//        pred_a  pred_b
// true_a    1       1      (support 2)
// true_b    0       2      (support 2)
//
// precision_a = TP_a / predicted_a = 1 / (1+0) = 1
// recall_a    = TP_a / support_a   = 1 / 2     = 0.5
// f1_a        = 2*(1*0.5)/(1+0.5) = 1/1.5      = 0.666667
//
// precision_b = TP_b / predicted_b = 2 / (1+2) = 0.666667
// recall_b    = TP_b / support_b   = 2 / 2     = 1
// f1_b        = 2*(0.666667*1)/(0.666667+1) = 1.333333/1.666667 = 0.8
//
// macroF1 = (0.666667 + 0.8) / 2 = 0.733333
//
// Cohen's kappa:
//   total = 4, observed = (1+2)/4 = 0.75
//   chance = (rowSum_a/total * colSum_a/total) + (rowSum_b/total * colSum_b/total)
//          = (2/4 * 1/4) + (2/4 * 3/4) = 0.125 + 0.375 = 0.5
//   kappa = (0.75 - 0.5) / (1 - 0.5) = 0.5
const Y_TRUE = ["a", "a", "b", "b"];
const Y_PRED = ["a", "b", "b", "b"];

describe("confusionMatrix", () => {
  it("matches the hand-computed matrix", () => {
    const cm = confusionMatrix(Y_TRUE, Y_PRED);
    expect(cm.classes).toEqual(["a", "b"]);
    expect(cm.matrix).toEqual([
      [1, 1],
      [0, 2],
    ]);
  });

  it("throws when yTrue and yPred have different lengths", () => {
    expect(() => confusionMatrix(["a"], ["a", "b"])).toThrow(/must be the same length/);
  });

  it("respects an explicit class list, ignoring out-of-vocabulary labels", () => {
    const cm = confusionMatrix(["a", "z"], ["a", "z"], ["a", "b"]);
    expect(cm.classes).toEqual(["a", "b"]);
    // "z" isn't in the class list, so that row/col contributes nothing —
    // not miscounted into an existing class.
    expect(cm.matrix).toEqual([
      [1, 0],
      [0, 0],
    ]);
  });
});

describe("perClassPRF1", () => {
  it("matches the hand-computed precision/recall/f1 for both classes", () => {
    const cm = confusionMatrix(Y_TRUE, Y_PRED);
    const perClass = perClassPRF1(cm);
    const a = perClass.find((c) => c.className === "a")!;
    const b = perClass.find((c) => c.className === "b")!;
    expect(a.precision).toBeCloseTo(1, 6);
    expect(a.recall).toBeCloseTo(0.5, 6);
    expect(a.f1).toBeCloseTo(0.666667, 5);
    expect(a.support).toBe(2);
    expect(b.precision).toBeCloseTo(0.666667, 5);
    expect(b.recall).toBeCloseTo(1, 6);
    expect(b.f1).toBeCloseTo(0.8, 6);
    expect(b.support).toBe(2);
  });

  it("a class with zero support has precision/recall/f1 of 0, not NaN", () => {
    const cm = confusionMatrix(["a"], ["a"], ["a", "b"]);
    const b = perClassPRF1(cm).find((c) => c.className === "b")!;
    expect(b).toEqual({ className: "b", precision: 0, recall: 0, f1: 0, support: 0 });
  });
});

describe("macroF1", () => {
  it("matches the hand-computed macro average", () => {
    expect(macroF1(confusionMatrix(Y_TRUE, Y_PRED))).toBeCloseTo(0.733333, 5);
  });

  it("is 1.0 for a perfect predictor", () => {
    expect(macroF1(confusionMatrix(["a", "b", "a"], ["a", "b", "a"]))).toBeCloseTo(1, 6);
  });

  it("is 0 for an empty confusion matrix (no classes)", () => {
    expect(macroF1({ classes: [], matrix: [] })).toBe(0);
  });
});

describe("cohenKappa", () => {
  it("matches the hand-computed kappa of exactly 0.5", () => {
    expect(cohenKappa(confusionMatrix(Y_TRUE, Y_PRED))).toBeCloseTo(0.5, 6);
  });

  it("is 1.0 for perfect agreement", () => {
    expect(cohenKappa(confusionMatrix(["a", "b", "a", "b"], ["a", "b", "a", "b"]))).toBeCloseTo(1, 6);
  });

  it("is 0 for an empty confusion matrix", () => {
    expect(cohenKappa({ classes: [], matrix: [] })).toBe(0);
  });

  it("does not throw (returns 0) in the degenerate all-one-class case", () => {
    // Every true and predicted label is the same single class — chance
    // agreement is 1, so kappa's denominator would be 0.
    expect(() => cohenKappa(confusionMatrix(["a", "a"], ["a", "a"]))).not.toThrow();
  });
});

describe("binaryTensionF1", () => {
  it("matches the hand-computed tension-class F1 of 0.666667", () => {
    // yTrue: contradiction, nuance, support, unrelated
    // yPred: contradiction, support,        support, unrelated
    // binary yTrue: tension, tension, no_tension, no_tension
    // binary yPred: tension, no_tension, no_tension, no_tension
    // — identical shape to the shared Y_TRUE/Y_PRED fixture above (class "a" == "tension").
    const yTrue = ["contradiction", "nuance", "support", "unrelated"];
    const yPred = ["contradiction", "support", "support", "unrelated"];
    expect(binaryTensionF1(yTrue, yPred)).toBeCloseTo(0.666667, 5);
  });

  it("is 1.0 when every tension pair is correctly flagged and every non-tension pair correctly cleared", () => {
    const yTrue = ["contradiction", "nuance", "support", "unrelated"];
    const yPred = ["contradiction", "nuance", "support", "unrelated"];
    expect(binaryTensionF1(yTrue, yPred)).toBeCloseTo(1, 6);
  });

  it("is 0 when every tension pair is missed", () => {
    const yTrue = ["contradiction", "nuance"];
    const yPred = ["support", "unrelated"];
    expect(binaryTensionF1(yTrue, yPred)).toBe(0);
  });
});

describe("perDomainMacroF1", () => {
  it("computes macro-F1 independently per domain, matching the hand-computed value for one domain", () => {
    const samples = [
      { domain: "empirical", yTrue: "a", yPred: "a" },
      { domain: "empirical", yTrue: "a", yPred: "b" },
      { domain: "empirical", yTrue: "b", yPred: "b" },
      { domain: "empirical", yTrue: "b", yPred: "b" },
      { domain: "humanities", yTrue: "x", yPred: "x" },
      { domain: "humanities", yTrue: "y", yPred: "y" },
    ];
    const result = perDomainMacroF1(samples);
    expect(result.empirical).toBeCloseTo(0.733333, 5); // same shape as the shared fixture
    expect(result.humanities).toBeCloseTo(1, 6); // perfect predictions
  });

  it("a domain regression is visible even when it would be averaged away in a pooled score", () => {
    const samples = [
      { domain: "empirical", yTrue: "a", yPred: "a" },
      { domain: "empirical", yTrue: "a", yPred: "a" },
      { domain: "humanities", yTrue: "x", yPred: "y" }, // total miss
      { domain: "humanities", yTrue: "y", yPred: "x" }, // total miss
    ];
    const result = perDomainMacroF1(samples);
    expect(result.empirical).toBeCloseTo(1, 6);
    expect(result.humanities).toBeCloseTo(0, 6);
  });
});
