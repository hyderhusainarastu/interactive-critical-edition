import { describe, expect, it } from "vitest";
import { computeNodeScale, computeVisibleDegrees, MAX_SCALE, MIN_SCALE, percentileOf, ROOT_SCALE } from "./sizing";

/**
 * Ported from `prototypes/graph-bakeoff/src/protoA/sizing.test.ts`.
 */

describe("computeNodeScale", () => {
  it("overrides the root to exactly 1.5 regardless of degree/bonuses", () => {
    expect(
      computeNodeScale({ isRoot: true, visibleDegree: 999, p95VisibleDegree: 3, isDirectEvidenceNeighborOfRoot: true, isAggregate: true }),
    ).toBe(ROOT_SCALE);
  });

  it("lands a zero-degree leaf at the 0.9 base, at or above MIN_SCALE", () => {
    const scale = computeNodeScale({ isRoot: false, visibleDegree: 0, p95VisibleDegree: 4, isDirectEvidenceNeighborOfRoot: false, isAggregate: false });
    expect(Math.abs(scale - 0.9) < 1e-5).toBeTruthy();
    expect(scale >= MIN_SCALE).toBeTruthy();
  });

  // degreeComponent saturates at 1 once visibleDegree >= p95VisibleDegree, so
  // the formula's own natural maximum (0.9 + 0.35 + 0.15 + 0.05 = 1.45) sits
  // comfortably under the 1.6 clamp — this asserts the clamp is a genuine
  // upper bound, not that these particular bonuses reach it.
  it("keeps the formula's natural maximum (1.45) under the MAX_SCALE clamp", () => {
    const scale = computeNodeScale({ isRoot: false, visibleDegree: 50, p95VisibleDegree: 5, isDirectEvidenceNeighborOfRoot: true, isAggregate: true });
    expect(Math.abs(scale - 1.45) < 1e-5).toBeTruthy();
    expect(scale <= MAX_SCALE).toBeTruthy();
  });

  it("caps degree at p95 before the sqrt component", () => {
    const atP95 = computeNodeScale({ isRoot: false, visibleDegree: 10, p95VisibleDegree: 10, isDirectEvidenceNeighborOfRoot: false, isAggregate: false });
    const aboveP95 = computeNodeScale({ isRoot: false, visibleDegree: 40, p95VisibleDegree: 10, isDirectEvidenceNeighborOfRoot: false, isAggregate: false });
    expect(Math.abs(atP95 - aboveP95) < 1e-9).toBeTruthy();
  });

  it("never divides by zero into NaN/Infinity on a degenerate p95 of 0", () => {
    const scale = computeNodeScale({ isRoot: false, visibleDegree: 0, p95VisibleDegree: 0, isDirectEvidenceNeighborOfRoot: false, isAggregate: false });
    expect(Number.isFinite(scale)).toBeTruthy();
    expect(Math.abs(scale - 0.9) < 1e-5).toBeTruthy();
  });
});

describe("percentileOf", () => {
  it("returns 0 for an empty sample and the expected percentile otherwise", () => {
    expect(percentileOf([], 95)).toBe(0);
    expect(percentileOf([1, 2, 3, 4, 5], 95)).toBe(5);
    expect(percentileOf([1, 2, 3, 4, 5], 50)).toBe(3);
  });
});

describe("computeVisibleDegrees", () => {
  it("counts self-links and honors the link-visibility predicate", () => {
    const links = [
      { source: "a", target: "b", isSelfLink: false },
      { source: "a", target: "c", isSelfLink: false },
      { source: "b", target: "b", isSelfLink: true },
    ];
    const { visibleDegreeById } = computeVisibleDegrees(["a", "b", "c"], links, () => true);
    expect(visibleDegreeById.get("a")).toBe(2);
    expect(visibleDegreeById.get("b")).toBe(2); // one from a-b, one self-link
    expect(visibleDegreeById.get("c")).toBe(1);

    const excluded = computeVisibleDegrees(["a", "b", "c"], links, (l) => !l.isSelfLink);
    expect(excluded.visibleDegreeById.get("b")).toBe(1);
    expect(excluded.p95VisibleDegree >= 1).toBeTruthy();
  });
});
