import { describe, expect, it } from "vitest";
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

describe("linearScale", () => {
  it("maps the domain onto the range linearly", () => {
    const scale = linearScale(0, 10, 0, 100);
    expect(scale(0)).toBe(0);
    expect(scale(10)).toBe(100);
    expect(scale(5)).toBe(50);
  });

  // Inverted range (used for y-axes, where a larger value needs a SMALLER
  // pixel y) works the same as any other range.
  it("handles an inverted range (y-axes, where a larger value needs a SMALLER pixel y) like any other range", () => {
    const scale = linearScale(0, 10, 100, 0);
    expect(scale(0)).toBe(100);
    expect(scale(10)).toBe(0);
    expect(scale(5)).toBe(50);
  });

  // A zero-span domain (every value identical, or one data point) maps every
  // value to the midpoint of the range rather than NaN/Infinity.
  it("maps a zero-span domain to the range midpoint rather than NaN/Infinity — even an out-of-domain value maps to the midpoint, not NaN", () => {
    const scale = linearScale(5, 5, 0, 100);
    expect(scale(5)).toBe(50);
    expect(scale(999)).toBe(50);
  });

  // Non-finite inputs degrade to safe defaults rather than propagating NaN.
  it("degrades non-finite inputs to safe defaults rather than propagating NaN — an infinite range bound must not produce NaN downstream", () => {
    const scale = linearScale(Number.NaN, 10, 0, 100);
    expect(Number.isFinite(scale(5))).toBeTruthy();
    const scale2 = linearScale(0, 10, 0, Number.POSITIVE_INFINITY);
    expect(Number.isFinite(scale2(5)) || scale2(5) === 0).toBeTruthy();
  });
});

// --- niceTicks ---------------------------------------------------------

describe("niceTicks", () => {
  // A degenerate domain returns exactly that one value, not an invented
  // spread.
  it("returns exactly the one value for a degenerate domain, not an invented spread", () => {
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(0, 0)).toEqual([0]);
  });

  // Ticks always span the requested domain (first tick <= min, last >= max).
  it("always spans the requested domain (first tick <= min, last >= max) with constant tick spacing", () => {
    const ticks = niceTicks(0, 97, 5);
    expect(ticks[0] <= 0).toBeTruthy();
    expect(ticks[ticks.length - 1] >= 97).toBeTruthy();
    // Every step must be constant (evenly spaced, "nice" round numbers).
    const step = ticks[1] - ticks[0];
    for (let i = 2; i < ticks.length; i++) {
      // message: "tick spacing must be constant"
      expect(Math.abs(ticks[i] - ticks[i - 1] - step) < 1e-9).toBeTruthy();
    }
  });

  // Reversed min/max (caller passes max first) still produces an ascending,
  // spanning tick set.
  it("still produces an ascending, spanning tick set when min/max are reversed (caller passes max first)", () => {
    const ticks = niceTicks(100, 0, 4);
    expect(ticks[0] <= 0).toBeTruthy();
    expect(ticks[ticks.length - 1] >= 100).toBeTruthy();
  });

  // count=1 still returns a valid, spanning set (never throws / never empty).
  it("returns a valid, spanning set for count=1 (never throws / never empty)", () => {
    const ticks = niceTicks(0, 10, 1);
    expect(ticks.length >= 1).toBeTruthy();
  });

  // A small fractional domain (e.g. a 0-1 credibility score) doesn't collapse
  // to a single [0] tick — the algorithm should choose sub-1 step sizes.
  it("does not collapse a small fractional domain (e.g. a 0-1 credibility score) to a single [0] tick", () => {
    const ticks = niceTicks(0, 1, 5);
    // message: "a 0-1 domain must produce more than one tick"
    expect(ticks.length > 1).toBeTruthy();
    expect(ticks[ticks.length - 1] >= 1).toBeTruthy();
  });
});

// --- buildLinePath -------------------------------------------------------

describe("buildLinePath", () => {
  it("an empty series draws nothing", () => {
    expect(buildLinePath([])).toBe("");
  });

  it("a single point is a move with no line segment", () => {
    expect(buildLinePath([{ x: 1, y: 2 }])).toBe("M 1,2");
  });

  it("joins multiple points with line segments", () => {
    expect(buildLinePath([{ x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 5 }])).toBe("M 0,0 L 10,20 L 20,5");
  });

  // Coordinates round to hundredths (compact, deterministic output).
  it("rounds coordinates to hundredths (compact, deterministic output)", () => {
    expect(buildLinePath([{ x: 1.23456, y: 2 }, { x: 3, y: 4 }])).toBe("M 1.23,2 L 3,4");
  });
});

// --- buildAreaPath -------------------------------------------------------

describe("buildAreaPath", () => {
  it("an empty series draws nothing", () => {
    expect(buildAreaPath([], 100)).toBe("");
  });

  it("area closes down to the baseline and back to the start", () => {
    const path = buildAreaPath([{ x: 0, y: 10 }, { x: 10, y: 5 }], 100);
    expect(path).toBe("M 0,10 L 10,5 L 10,100 L 0,100 Z");
  });

  // A non-finite baseline degrades to the first point's own y rather than
  // producing a NaN coordinate.
  it("degrades a non-finite baseline to the first point's own y rather than producing a NaN coordinate", () => {
    const path = buildAreaPath([{ x: 0, y: 10 }, { x: 10, y: 5 }], Number.NaN);
    expect(!path.includes("NaN")).toBeTruthy();
  });
});

// --- barLayout -----------------------------------------------------------

describe("barLayout", () => {
  it("an empty series produces no bars", () => {
    expect(barLayout([], { width: 100, height: 50 })).toEqual([]);
  });

  it("a zero-width box produces no bars", () => {
    expect(barLayout([1, 2, 3], { width: 0, height: 50 })).toEqual([]);
  });

  it("a zero-height box produces no bars", () => {
    expect(barLayout([1, 2, 3], { width: 100, height: 0 })).toEqual([]);
  });

  // Bars grow UP from the bottom of the box: the tallest bar's y is the
  // smallest (closest to 0, SVG's top), and every bar's y + height === the
  // box height (bars share one baseline).
  it("grows bars UP from the bottom of the box, sharing one baseline, tiling the width with no gap", () => {
    const bars = barLayout([10, 30, 20], { width: 90, height: 60, gapRatio: 0 });
    expect(bars.length).toBe(3);
    // message: "the tallest bar (30) sits higher (smaller y) than a shorter one (10)"
    expect(bars[1].y < bars[0].y).toBeTruthy();
    for (const bar of bars) {
      // message: "every bar's y+height must equal the box height"
      expect(Math.abs(bar.y + bar.height - 60) < 1e-6).toBeTruthy();
    }
    // Evenly spaced, no gap: bars should exactly tile the width.
    expect(Math.abs(bars[0].x) < 1e-6).toBeTruthy();
    expect(Math.abs(bars[0].width - 30) < 1e-6).toBeTruthy();
  });

  // All-zero series still returns bars (zero height each), not an empty
  // array or a division-by-zero NaN.
  it("returns zero-height bars for an all-zero series, not an empty array or a division-by-zero NaN", () => {
    const bars = barLayout([0, 0, 0], { width: 90, height: 60 });
    expect(bars.length).toBe(3);
    for (const bar of bars) {
      expect(bar.height).toBe(0);
      expect(!Number.isNaN(bar.x) && !Number.isNaN(bar.width)).toBeTruthy();
    }
  });

  // Negative/non-finite values clamp to a zero-height bar rather than a
  // negative or NaN height.
  it("clamps negative/non-finite values to a zero-height bar rather than a negative or NaN height", () => {
    const bars = barLayout([-5, Number.NaN, 10], { width: 90, height: 60 });
    expect(bars[0].value).toBe(0);
    expect(bars[0].height).toBe(0);
    expect(bars[1].value).toBe(0);
    expect(bars[1].height).toBe(0);
    expect(bars[2].height > 0).toBeTruthy();
  });

  // An explicit maxValue (shared axis ceiling across charts) overrides the
  // series' own max.
  it("lets an explicit maxValue (shared axis ceiling across charts) override the series' own max", () => {
    const bars = barLayout([5], { width: 90, height: 60, maxValue: 50 });
    // message: "5/50 of a 60-tall box is 6"
    expect(Math.abs(bars[0].height - 6) < 1e-6).toBeTruthy();
  });

  // A single-bar series still lays out correctly (no divide-by-count-1 bug).
  it("lays out a single-bar series correctly (no divide-by-count-1 bug)", () => {
    const bars = barLayout([7], { width: 40, height: 20 });
    expect(bars.length).toBe(1);
    expect(bars[0].height > 0).toBeTruthy();
  });
});

// --- sparklinePath -------------------------------------------------------

describe("sparklinePath", () => {
  it("an empty series draws nothing", () => {
    expect(sparklinePath([], 100, 20)).toBe("");
  });

  it("a single point has no line segment (caller draws a dot instead)", () => {
    expect(sparklinePath([5], 100, 20)).toBe("");
  });

  it("draws a finite path for a varying series", () => {
    const path = sparklinePath([1, 5, 3, 8, 2], 100, 20);
    expect(path.startsWith("M ")).toBeTruthy();
    expect(!path.includes("NaN")).toBeTruthy();
  });

  // A flat series (no variation) still produces a valid, finite path — every
  // point lands at the same y rather than NaN from a zero-span y-domain.
  it("still produces a valid, finite path for a flat series — every point lands at the same y rather than NaN from a zero-span y-domain", () => {
    const path = sparklinePath([4, 4, 4, 4], 100, 20);
    expect(!path.includes("NaN")).toBeTruthy();
    const segments = path.split(" L ");
    expect(segments.length).toBe(4);
  });
});

// --- radarAxisAngle --------------------------------------------------------

describe("radarAxisAngle", () => {
  // First axis is always straight up (-90deg).
  it("puts the first axis straight up (-90deg)", () => {
    expect(Math.abs(radarAxisAngle(0, 4) - -Math.PI / 2) < 1e-9).toBeTruthy();
  });

  // Axes are evenly spaced clockwise: for 4 axes, the second is 90deg (PI/2
  // radians) further clockwise than the first.
  it("spaces axes evenly clockwise — for 4 axes the second is 90deg (PI/2 radians) further clockwise than the first", () => {
    expect(Math.abs(radarAxisAngle(1, 4) - (-Math.PI / 2 + Math.PI / 2)) < 1e-9).toBeTruthy();
  });

  // Going all the way around returns to the start angle (mod 2*PI).
  it("returns to the start angle (mod 2*PI) after going all the way around", () => {
    const full = radarAxisAngle(6, 6);
    const start = radarAxisAngle(0, 6);
    expect(Math.abs(((full - start) % (2 * Math.PI))) < 1e-9).toBeTruthy();
  });
});

// --- radarPoint ------------------------------------------------------------

describe("radarPoint", () => {
  // A value at exactly maxValue sits exactly `radius` away from center.
  it("puts a value at exactly maxValue exactly `radius` away from center", () => {
    const p = radarPoint(0, 4, 10, 10, 50, 50, 30);
    const dist = Math.hypot(p.x - 50, p.y - 50);
    expect(Math.abs(dist - 30) < 1e-6).toBeTruthy();
  });

  // A value of 0 sits exactly at the center, regardless of axis index.
  it("puts a value of 0 exactly at the center, regardless of axis index", () => {
    for (const index of [0, 1, 2, 3]) {
      const p = radarPoint(index, 4, 0, 10, 50, 50, 30);
      expect(Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 50) < 1e-6).toBeTruthy();
    }
  });

  // A value ABOVE maxValue clamps to the outer ring, never past it.
  it("clamps a value ABOVE maxValue to the outer ring, never past it", () => {
    const atMax = radarPoint(0, 4, 10, 10, 50, 50, 30);
    const overMax = radarPoint(0, 4, 999, 10, 50, 50, 30);
    expect(Math.abs(atMax.x - overMax.x) < 1e-9 && Math.abs(atMax.y - overMax.y) < 1e-9).toBeTruthy();
  });

  // A negative/non-finite value clamps to the center, not off-chart.
  it("clamps a negative/non-finite value to the center, not off-chart", () => {
    const p = radarPoint(0, 4, -50, 10, 50, 50, 30);
    expect(Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 50) < 1e-6).toBeTruthy();
    const p2 = radarPoint(0, 4, Number.NaN, 10, 50, 50, 30);
    expect(Math.abs(p2.x - 50) < 1e-6 && Math.abs(p2.y - 50) < 1e-6).toBeTruthy();
  });
});

// --- radarPolygonPath / radarRingPath (3-8 axes) --------------------------

describe("radarPolygonPath / radarRingPath (3-8 axes)", () => {
  it("an empty series draws nothing", () => {
    expect(radarPolygonPath([], 10, 50, 50, 30)).toBe("");
  });

  it("draws a closed, NaN-free polygon and ring for 3-8 axes", () => {
    for (const axisCount of [3, 4, 5, 6, 7, 8]) {
      const values = Array.from({ length: axisCount }, (_, i) => (i + 1) * 2);
      const path = radarPolygonPath(values, axisCount * 2, 50, 50, 30);
      // message: `${axisCount}-axis polygon must start with a move command`
      expect(path.startsWith("M ")).toBeTruthy();
      // message: `${axisCount}-axis polygon must be closed`
      expect(path.endsWith("Z")).toBeTruthy();
      expect(!path.includes("NaN")).toBeTruthy();

      const ring = radarRingPath(axisCount, 50, 50, 30, 0.5);
      // message: `${axisCount}-axis ring must start with a move command`
      expect(ring.startsWith("M ")).toBeTruthy();
      expect(ring.endsWith("Z")).toBeTruthy();
      expect(!ring.includes("NaN")).toBeTruthy();
    }
  });

  // Fewer than 3 axes has no meaningful ring to draw — returns empty rather
  // than a degenerate 1-2-point "polygon" masquerading as a grid line.
  it("returns empty for fewer than 3 axes rather than a degenerate 1-2-point \"polygon\" masquerading as a grid line", () => {
    expect(radarRingPath(0, 50, 50, 30, 0.5)).toBe("");
    expect(radarRingPath(2, 50, 50, 30, 0.5)).toBe("");
  });
});
