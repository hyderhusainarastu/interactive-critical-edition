import assert from "node:assert/strict";
import { computeNodeScale, computeVisibleDegrees, MAX_SCALE, MIN_SCALE, percentileOf, ROOT_SCALE } from "./sizing";

/**
 * Ported from `prototypes/graph-bakeoff/src/protoA/sizing.test.ts`, run via
 * `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/sizing.test.ts`
 * (no vitest wiring under `apps/web` — see `graph/filterGraphData.test.ts`).
 */

// --- computeNodeScale ---
{
  assert.equal(
    computeNodeScale({ isRoot: true, visibleDegree: 999, p95VisibleDegree: 3, isDirectEvidenceNeighborOfRoot: true, isAggregate: true }),
    ROOT_SCALE,
    "root is overridden to exactly 1.5 regardless of degree/bonuses",
  );
}
{
  const scale = computeNodeScale({ isRoot: false, visibleDegree: 0, p95VisibleDegree: 4, isDirectEvidenceNeighborOfRoot: false, isAggregate: false });
  assert.ok(Math.abs(scale - 0.9) < 1e-5, "a zero-degree leaf lands at the 0.9 base");
  assert.ok(scale >= MIN_SCALE);
}
{
  // degreeComponent saturates at 1 once visibleDegree >= p95VisibleDegree, so
  // the formula's own natural maximum (0.9 + 0.35 + 0.15 + 0.05 = 1.45) sits
  // comfortably under the 1.6 clamp — this asserts the clamp is a genuine
  // upper bound, not that these particular bonuses reach it.
  const scale = computeNodeScale({ isRoot: false, visibleDegree: 50, p95VisibleDegree: 5, isDirectEvidenceNeighborOfRoot: true, isAggregate: true });
  assert.ok(Math.abs(scale - 1.45) < 1e-5);
  assert.ok(scale <= MAX_SCALE);
}
{
  const atP95 = computeNodeScale({ isRoot: false, visibleDegree: 10, p95VisibleDegree: 10, isDirectEvidenceNeighborOfRoot: false, isAggregate: false });
  const aboveP95 = computeNodeScale({ isRoot: false, visibleDegree: 40, p95VisibleDegree: 10, isDirectEvidenceNeighborOfRoot: false, isAggregate: false });
  assert.ok(Math.abs(atP95 - aboveP95) < 1e-9, "degree is capped at p95 before the sqrt component");
}
{
  const scale = computeNodeScale({ isRoot: false, visibleDegree: 0, p95VisibleDegree: 0, isDirectEvidenceNeighborOfRoot: false, isAggregate: false });
  assert.ok(Number.isFinite(scale), "a degenerate p95 of 0 never divides by zero into NaN/Infinity");
  assert.ok(Math.abs(scale - 0.9) < 1e-5);
}
console.log("computeNodeScale: OK");

// --- percentileOf ---
assert.equal(percentileOf([], 95), 0);
assert.equal(percentileOf([1, 2, 3, 4, 5], 95), 5);
assert.equal(percentileOf([1, 2, 3, 4, 5], 50), 3);
console.log("percentileOf: OK");

// --- computeVisibleDegrees ---
{
  const links = [
    { source: "a", target: "b", isSelfLink: false },
    { source: "a", target: "c", isSelfLink: false },
    { source: "b", target: "b", isSelfLink: true },
  ];
  const { visibleDegreeById } = computeVisibleDegrees(["a", "b", "c"], links, () => true);
  assert.equal(visibleDegreeById.get("a"), 2);
  assert.equal(visibleDegreeById.get("b"), 2); // one from a-b, one self-link
  assert.equal(visibleDegreeById.get("c"), 1);

  const excluded = computeVisibleDegrees(["a", "b", "c"], links, (l) => !l.isSelfLink);
  assert.equal(excluded.visibleDegreeById.get("b"), 1);
  assert.ok(excluded.p95VisibleDegree >= 1);
}
console.log("computeVisibleDegrees: OK");

console.log("sizing.test.ts: all assertions passed");
