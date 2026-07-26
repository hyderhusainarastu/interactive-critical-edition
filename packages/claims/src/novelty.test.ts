import { describe, expect, it } from "vitest";
import { noveltyFor } from "./novelty";
import type { NoveltyThresholds } from "./thresholds";

const MODEL = "text-embedding-3-small";
const THRESHOLDS: NoveltyThresholds = { high: 0.5, low: 0.2, calibratedFor: MODEL };

describe("noveltyFor", () => {
  it("throws if the thresholds weren't calibrated for the given model", () => {
    expect(() => noveltyFor([1, 0], [[1, 0]], THRESHOLDS, "text-embedding-3-large")).toThrow(/calibrated for/);
  });

  it("returns 'unknown' for an empty corpus, without requiring thresholds to be set", () => {
    const uncalibrated: NoveltyThresholds = { high: NaN, low: NaN, calibratedFor: MODEL };
    // Even with NaN thresholds, an empty corpus short-circuits before the
    // assertThresholdsSet gate — there is genuinely nothing to compare, so
    // this must not throw.
    expect(noveltyFor([1, 0], [], uncalibrated, MODEL)).toEqual({ distance: 0, tier: "unknown" });
  });

  it("throws if thresholds are unset (NaN) and the corpus is non-empty", () => {
    const uncalibrated: NoveltyThresholds = { high: NaN, low: NaN, calibratedFor: MODEL };
    expect(() => noveltyFor([1, 0], [[1, 0]], uncalibrated, MODEL)).toThrow(/unset \(NaN default\)/);
  });

  it("an identical vector in the corpus gives distance 0 and tier 'low'", () => {
    const result = noveltyFor([1, 0], [[1, 0]], THRESHOLDS, MODEL);
    expect(result.distance).toBe(0);
    expect(result.tier).toBe("low");
  });

  it("an orthogonal vector gives distance 1 and tier 'high'", () => {
    const result = noveltyFor([1, 0], [[0, 1]], THRESHOLDS, MODEL);
    expect(result.distance).toBe(1);
    expect(result.tier).toBe("high");
  });

  it("takes the MINIMUM distance across the whole corpus (nearest neighbour), not the average", () => {
    // One very close neighbour and one very far one — nearest-neighbour
    // distance must reflect the close one, not an average that would land
    // in "medium".
    const result = noveltyFor([1, 0], [[1, 0], [0, 1], [0, 1], [0, 1]], THRESHOLDS, MODEL);
    expect(result.distance).toBe(0);
    expect(result.tier).toBe("low");
  });

  it("a distance strictly between low and high is 'medium'", () => {
    // cos([1,1],[1,0]) = 1/sqrt(2) ≈ 0.7071 -> distance ≈ 0.2929, between 0.2 and 0.5
    const result = noveltyFor([1, 1], [[1, 0]], THRESHOLDS, MODEL);
    expect(result.distance).toBeGreaterThan(THRESHOLDS.low);
    expect(result.distance).toBeLessThan(THRESHOLDS.high);
    expect(result.tier).toBe("medium");
  });
});
