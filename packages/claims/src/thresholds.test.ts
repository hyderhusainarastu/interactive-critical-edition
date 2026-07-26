import { describe, expect, it } from "vitest";
import {
  NOVELTY_THRESHOLDS,
  RETRIEVAL_THRESHOLDS,
  assertThresholdsCalibratedFor,
  assertThresholdsSet,
} from "./thresholds";

describe("RETRIEVAL_THRESHOLDS", () => {
  it("has the fixed, already-calibrated constants at their documented values", () => {
    expect(RETRIEVAL_THRESHOLDS.bm25TopK).toBe(5);
    expect(RETRIEVAL_THRESHOLDS.bm25MinScore).toBe(0.25);
    expect(RETRIEVAL_THRESHOLDS.locusScore).toBe(1.0);
    expect(RETRIEVAL_THRESHOLDS.locusSectionScore).toBe(0.7);
  });

  it("defaults the uncalibrated dense thresholds to NaN when no env var is set", () => {
    expect(Number.isNaN(RETRIEVAL_THRESHOLDS.denseMin)).toBe(true);
    expect(Number.isNaN(RETRIEVAL_THRESHOLDS.denseStrong)).toBe(true);
  });

  it("defaults calibratedFor to the standard embedding model", () => {
    expect(RETRIEVAL_THRESHOLDS.calibratedFor).toBe("text-embedding-3-small");
  });
});

describe("NOVELTY_THRESHOLDS", () => {
  it("defaults high/low to NaN when uncalibrated", () => {
    expect(Number.isNaN(NOVELTY_THRESHOLDS.high)).toBe(true);
    expect(Number.isNaN(NOVELTY_THRESHOLDS.low)).toBe(true);
  });
});

describe("assertThresholdsCalibratedFor", () => {
  it("does not throw when the model matches", () => {
    expect(() => assertThresholdsCalibratedFor("text-embedding-3-small", RETRIEVAL_THRESHOLDS)).not.toThrow();
  });
  it("throws on a mismatched model", () => {
    expect(() => assertThresholdsCalibratedFor("text-embedding-3-large", RETRIEVAL_THRESHOLDS)).toThrow(
      /calibrated for/,
    );
  });
});

describe("assertThresholdsSet", () => {
  it("throws when any numeric field is NaN", () => {
    expect(() => assertThresholdsSet(RETRIEVAL_THRESHOLDS)).toThrow(/unset \(NaN default\)/);
    expect(() => assertThresholdsSet(NOVELTY_THRESHOLDS)).toThrow(/unset \(NaN default\)/);
  });

  it("does not throw once every numeric field is a real number", () => {
    expect(() => assertThresholdsSet({ ...RETRIEVAL_THRESHOLDS, denseMin: 0.5, denseStrong: 0.8 })).not.toThrow();
  });

  it("ignores non-numeric fields entirely", () => {
    expect(() => assertThresholdsSet({ calibratedFor: "text-embedding-3-small", ok: true })).not.toThrow();
  });
});
