import { describe, expect, it } from "vitest";
import { computeNodeScale, computeVisibleDegrees, MAX_SCALE, MIN_SCALE, percentileOf, ROOT_SCALE } from "./sizing";

describe("computeNodeScale", () => {
  it("overrides the root to exactly 1.5 regardless of degree/bonuses", () => {
    expect(
      computeNodeScale({
        isRoot: true,
        visibleDegree: 999,
        p95VisibleDegree: 3,
        isDirectEvidenceNeighborOfRoot: true,
        isAggregate: true,
      }),
    ).toBe(ROOT_SCALE);
  });

  it("clamps a zero-degree leaf to the 0.8 floor", () => {
    const scale = computeNodeScale({
      isRoot: false,
      visibleDegree: 0,
      p95VisibleDegree: 4,
      isDirectEvidenceNeighborOfRoot: false,
      isAggregate: false,
    });
    expect(scale).toBeCloseTo(0.9, 5);
    expect(scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });

  it("never exceeds the 1.6 ceiling even at max degree component plus both bonuses", () => {
    // degreeComponent saturates at 1 once visibleDegree >= p95VisibleDegree,
    // so the formula's own natural maximum (0.9 + 0.35 + 0.15 + 0.05 = 1.45)
    // sits comfortably under the 1.6 clamp — this asserts the clamp is a
    // genuine upper bound, not that these particular bonuses reach it.
    const scale = computeNodeScale({
      isRoot: false,
      visibleDegree: 50,
      p95VisibleDegree: 5,
      isDirectEvidenceNeighborOfRoot: true,
      isAggregate: true,
    });
    expect(scale).toBeCloseTo(1.45, 5);
    expect(scale).toBeLessThanOrEqual(MAX_SCALE);
  });

  it("degree is capped at p95 before the sqrt component", () => {
    const atP95 = computeNodeScale({
      isRoot: false,
      visibleDegree: 10,
      p95VisibleDegree: 10,
      isDirectEvidenceNeighborOfRoot: false,
      isAggregate: false,
    });
    const aboveP95 = computeNodeScale({
      isRoot: false,
      visibleDegree: 40,
      p95VisibleDegree: 10,
      isDirectEvidenceNeighborOfRoot: false,
      isAggregate: false,
    });
    expect(atP95).toBeCloseTo(aboveP95, 10);
  });

  it("handles a degenerate p95 of 0 without dividing by zero", () => {
    const scale = computeNodeScale({
      isRoot: false,
      visibleDegree: 0,
      p95VisibleDegree: 0,
      isDirectEvidenceNeighborOfRoot: false,
      isAggregate: false,
    });
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeCloseTo(0.9, 5);
  });
});

describe("percentileOf", () => {
  it("returns 0 for an empty array", () => {
    expect(percentileOf([], 95)).toBe(0);
  });

  it("uses nearest-rank on sorted data", () => {
    expect(percentileOf([1, 2, 3, 4, 5], 95)).toBe(5);
    expect(percentileOf([1, 2, 3, 4, 5], 50)).toBe(3);
  });
});

describe("computeVisibleDegrees", () => {
  const links = [
    { source: "a", target: "b", isSelfLink: false },
    { source: "a", target: "c", isSelfLink: false },
    { source: "b", target: "b", isSelfLink: true },
  ];

  it("counts only links the visibility predicate allows", () => {
    const { visibleDegreeById } = computeVisibleDegrees(["a", "b", "c"], links, () => true);
    expect(visibleDegreeById.get("a")).toBe(2);
    expect(visibleDegreeById.get("b")).toBe(2); // one from a-b, one self-link
    expect(visibleDegreeById.get("c")).toBe(1);
  });

  it("excludes filtered-out links from degree and p95", () => {
    const { visibleDegreeById, p95VisibleDegree } = computeVisibleDegrees(
      ["a", "b", "c"],
      links,
      (l) => !l.isSelfLink,
    );
    expect(visibleDegreeById.get("b")).toBe(1);
    expect(p95VisibleDegree).toBeGreaterThanOrEqual(1);
  });
});
