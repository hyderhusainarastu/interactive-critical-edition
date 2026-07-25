import assert from "node:assert/strict";
import {
  barLayout,
  buildAreaPath,
  buildLinePath,
  linearScale,
  niceTicks,
  radarAxisAngle,
  radarPoint,
  radarPolygonPath,
  radarRingPath,
  sparklinePath,
} from "./chartGeometry";

/**
 * Workstream G/H (v.5) chart components have no DOM/renderer to assert
 * against in this repo's CI-safe suite, so every geometric decision lives
 * as a pure function here instead (same convention as
 * `apps/web/src/components/graph/graphSceneScaling.test.ts`). Run via
 * `pnpm --filter worker exec tsx <absolute-path>` — no DB import, no
 * DATABASE_URL needed.
 */

// --- linearScale -----------------------------------------------------------

{
  const scale = linearScale(0, 10, 0, 100);
  assert.equal(scale(0), 0);
  assert.equal(scale(10), 100);
  assert.equal(scale(5), 50);
}

// Inverted range (used for y-axes, where a larger value needs a SMALLER
// pixel y) works the same as any other range.
{
  const scale = linearScale(0, 10, 100, 0);
  assert.equal(scale(0), 100);
  assert.equal(scale(10), 0);
  assert.equal(scale(5), 50);
}

// A zero-span domain (every value identical, or one data point) maps every
// value to the midpoint of the range rather than NaN/Infinity.
{
  const scale = linearScale(5, 5, 0, 100);
  assert.equal(scale(5), 50);
  assert.equal(scale(999), 50, "even an out-of-domain value maps to the midpoint, not NaN");
}

// Non-finite inputs degrade to safe defaults rather than propagating NaN.
{
  const scale = linearScale(Number.NaN, 10, 0, 100);
  assert.ok(Number.isFinite(scale(5)));
  const scale2 = linearScale(0, 10, 0, Number.POSITIVE_INFINITY);
  assert.ok(Number.isFinite(scale2(5)) || scale2(5) === 0, "an infinite range bound must not produce NaN downstream");
}

// --- niceTicks ---------------------------------------------------------

// A degenerate domain returns exactly that one value, not an invented
// spread.
assert.deepEqual(niceTicks(5, 5), [5]);
assert.deepEqual(niceTicks(0, 0), [0]);

// Ticks always span the requested domain (first tick <= min, last >= max).
{
  const ticks = niceTicks(0, 97, 5);
  assert.ok(ticks[0] <= 0);
  assert.ok(ticks[ticks.length - 1] >= 97);
  // Every step must be constant (evenly spaced, "nice" round numbers).
  const step = ticks[1] - ticks[0];
  for (let i = 2; i < ticks.length; i++) {
    assert.ok(Math.abs(ticks[i] - ticks[i - 1] - step) < 1e-9, "tick spacing must be constant");
  }
}

// Reversed min/max (caller passes max first) still produces an ascending,
// spanning tick set.
{
  const ticks = niceTicks(100, 0, 4);
  assert.ok(ticks[0] <= 0);
  assert.ok(ticks[ticks.length - 1] >= 100);
}

// count=1 still returns a valid, spanning set (never throws / never empty).
{
  const ticks = niceTicks(0, 10, 1);
  assert.ok(ticks.length >= 1);
}

// A small fractional domain (e.g. a 0-1 credibility score) doesn't collapse
// to a single [0] tick — the algorithm should choose sub-1 step sizes.
{
  const ticks = niceTicks(0, 1, 5);
  assert.ok(ticks.length > 1, "a 0-1 domain must produce more than one tick");
  assert.ok(ticks[ticks.length - 1] >= 1);
}

// --- buildLinePath -------------------------------------------------------

assert.equal(buildLinePath([]), "", "an empty series draws nothing");
assert.equal(buildLinePath([{ x: 1, y: 2 }]), "M 1,2", "a single point is a move with no line segment");
assert.equal(
  buildLinePath([{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 5 }]),
  "M 0,0 L 10,20 L 20,5",
);
// Coordinates round to hundredths (compact, deterministic output).
assert.equal(buildLinePath([{ x: 1.23456, y: 2 }, { x: 3, y: 4 }]), "M 1.23,2 L 3,4");

// --- buildAreaPath -------------------------------------------------------

assert.equal(buildAreaPath([], 100), "", "an empty series draws nothing");
{
  const path = buildAreaPath([{ x: 0, y: 10 }, { x: 10, y: 5 }], 100);
  assert.equal(path, "M 0,10 L 10,5 L 10,100 L 0,100 Z", "area closes down to the baseline and back to the start");
}
// A non-finite baseline degrades to the first point's own y rather than
// producing a NaN coordinate.
{
  const path = buildAreaPath([{ x: 0, y: 10 }, { x: 10, y: 5 }], Number.NaN);
  assert.ok(!path.includes("NaN"));
}

// --- barLayout -----------------------------------------------------------

assert.deepEqual(barLayout([], { width: 100, height: 50 }), [], "an empty series produces no bars");
assert.deepEqual(barLayout([1, 2, 3], { width: 0, height: 50 }), [], "a zero-width box produces no bars");
assert.deepEqual(barLayout([1, 2, 3], { width: 100, height: 0 }), [], "a zero-height box produces no bars");

// Bars grow UP from the bottom of the box: the tallest bar's y is the
// smallest (closest to 0, SVG's top), and every bar's y + height === the
// box height (bars share one baseline).
{
  const bars = barLayout([10, 30, 20], { width: 90, height: 60, gapRatio: 0 });
  assert.equal(bars.length, 3);
  assert.ok(bars[1].y < bars[0].y, "the tallest bar (30) sits higher (smaller y) than a shorter one (10)");
  for (const bar of bars) {
    assert.ok(Math.abs(bar.y + bar.height - 60) < 1e-6, "every bar's y+height must equal the box height");
  }
  // Evenly spaced, no gap: bars should exactly tile the width.
  assert.ok(Math.abs(bars[0].x) < 1e-6);
  assert.ok(Math.abs(bars[0].width - 30) < 1e-6);
}

// All-zero series still returns bars (zero height each), not an empty
// array or a division-by-zero NaN.
{
  const bars = barLayout([0, 0, 0], { width: 90, height: 60 });
  assert.equal(bars.length, 3);
  for (const bar of bars) {
    assert.equal(bar.height, 0);
    assert.ok(!Number.isNaN(bar.x) && !Number.isNaN(bar.width));
  }
}

// Negative/non-finite values clamp to a zero-height bar rather than a
// negative or NaN height.
{
  const bars = barLayout([-5, Number.NaN, 10], { width: 90, height: 60 });
  assert.equal(bars[0].value, 0);
  assert.equal(bars[0].height, 0);
  assert.equal(bars[1].value, 0);
  assert.equal(bars[1].height, 0);
  assert.ok(bars[2].height > 0);
}

// An explicit maxValue (shared axis ceiling across charts) overrides the
// series' own max.
{
  const bars = barLayout([5], { width: 90, height: 60, maxValue: 50 });
  assert.ok(Math.abs(bars[0].height - 6) < 1e-6, "5/50 of a 60-tall box is 6");
}

// A single-bar series still lays out correctly (no divide-by-count-1 bug).
{
  const bars = barLayout([7], { width: 40, height: 20 });
  assert.equal(bars.length, 1);
  assert.ok(bars[0].height > 0);
}

// --- sparklinePath -------------------------------------------------------

assert.equal(sparklinePath([], 100, 20), "", "an empty series draws nothing");
assert.equal(sparklinePath([5], 100, 20), "", "a single point has no line segment (caller draws a dot instead)");
{
  const path = sparklinePath([1, 5, 3, 8, 2], 100, 20);
  assert.ok(path.startsWith("M "));
  assert.ok(!path.includes("NaN"));
}
// A flat series (no variation) still produces a valid, finite path — every
// point lands at the same y rather than NaN from a zero-span y-domain.
{
  const path = sparklinePath([4, 4, 4, 4], 100, 20);
  assert.ok(!path.includes("NaN"));
  const segments = path.split(" L ");
  assert.equal(segments.length, 4);
}

// --- radarAxisAngle --------------------------------------------------------

// First axis is always straight up (-90deg).
assert.ok(Math.abs(radarAxisAngle(0, 4) - -Math.PI / 2) < 1e-9);
// Axes are evenly spaced clockwise: for 4 axes, the second is 90deg (PI/2
// radians) further clockwise than the first.
assert.ok(Math.abs(radarAxisAngle(1, 4) - (-Math.PI / 2 + Math.PI / 2)) < 1e-9);
// Going all the way around returns to the start angle (mod 2*PI).
{
  const full = radarAxisAngle(6, 6);
  const start = radarAxisAngle(0, 6);
  assert.ok(Math.abs(((full - start) % (2 * Math.PI))) < 1e-9);
}

// --- radarPoint ------------------------------------------------------------

// A value at exactly maxValue sits exactly `radius` away from center.
{
  const p = radarPoint(0, 4, 10, 10, 50, 50, 30);
  const dist = Math.hypot(p.x - 50, p.y - 50);
  assert.ok(Math.abs(dist - 30) < 1e-6);
}
// A value of 0 sits exactly at the center, regardless of axis index.
for (const index of [0, 1, 2, 3]) {
  const p = radarPoint(index, 4, 0, 10, 50, 50, 30);
  assert.ok(Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 50) < 1e-6);
}
// A value ABOVE maxValue clamps to the outer ring, never past it.
{
  const atMax = radarPoint(0, 4, 10, 10, 50, 50, 30);
  const overMax = radarPoint(0, 4, 999, 10, 50, 50, 30);
  assert.ok(Math.abs(atMax.x - overMax.x) < 1e-9 && Math.abs(atMax.y - overMax.y) < 1e-9);
}
// A negative/non-finite value clamps to the center, not off-chart.
{
  const p = radarPoint(0, 4, -50, 10, 50, 50, 30);
  assert.ok(Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 50) < 1e-6);
  const p2 = radarPoint(0, 4, Number.NaN, 10, 50, 50, 30);
  assert.ok(Math.abs(p2.x - 50) < 1e-6 && Math.abs(p2.y - 50) < 1e-6);
}

// --- radarPolygonPath / radarRingPath (3-8 axes) --------------------------

assert.equal(radarPolygonPath([], 10, 50, 50, 30), "", "an empty series draws nothing");

for (const axisCount of [3, 4, 5, 6, 7, 8]) {
  const values = Array.from({ length: axisCount }, (_, i) => (i + 1) * 2);
  const path = radarPolygonPath(values, axisCount * 2, 50, 50, 30);
  assert.ok(path.startsWith("M "), `${axisCount}-axis polygon must start with a move command`);
  assert.ok(path.endsWith("Z"), `${axisCount}-axis polygon must be closed`);
  assert.ok(!path.includes("NaN"));

  const ring = radarRingPath(axisCount, 50, 50, 30, 0.5);
  assert.ok(ring.startsWith("M "), `${axisCount}-axis ring must start with a move command`);
  assert.ok(ring.endsWith("Z"));
  assert.ok(!ring.includes("NaN"));
}

// Fewer than 3 axes has no meaningful ring to draw — returns empty rather
// than a degenerate 1-2-point "polygon" masquerading as a grid line.
assert.equal(radarRingPath(0, 50, 50, 30, 0.5), "");
assert.equal(radarRingPath(2, 50, 50, 30, 0.5), "");

console.log("chartGeometry.test.ts: all assertions passed");
