/**
 * Workstream G/H (v.5): pure, deterministic SVG-geometry math for the
 * hand-rolled chart components in this folder (`LineChart`/`BarChart`/
 * `Sparkline`/`RadarChart`). No chart library is used (see the plan's
 * "Charts — hand-rolled SVG, no chart lib" section) — four small,
 * editorial-styled chart shapes don't justify a new dependency, and keeping
 * every geometric decision in one pure module (this file) rather than
 * scattered across JSX means it is fully unit-testable without a DOM,
 * following the same pattern as `apps/web/src/components/graph/
 * graphSceneScaling.ts` (see that file's own doc comment). Every function
 * degrades safely on non-finite/degenerate input (empty series, a single
 * point, a zero-span domain) instead of producing `NaN`/`Infinity` in an SVG
 * `d`/coordinate attribute, which silently drops the whole shape in most
 * renderers with no visible error.
 */

export interface Point {
  x: number;
  y: number;
}

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Rounds to hundredths so generated `d` strings stay compact and
 *  deterministic (no float-noise digits) — cosmetic only, never changes
 *  which pixel a coordinate lands on at any realistic chart size. */
function formatCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

// --- Scale -----------------------------------------------------------------

/**
 * A linear domain->range mapping, returned as a plain function so callers
 * can apply it to many values without re-deriving the ratio each time. A
 * zero-span domain (every value identical, or a single data point) can't be
 * divided into a ratio — rather than throwing or returning `NaN`, it maps
 * every value to the midpoint of the range, which is the only geometrically
 * honest placement for "there is no variation to plot."
 */
export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (value: number) => number {
  const safeDomainMin = safeNumber(domainMin, 0);
  const safeDomainMax = safeNumber(domainMax, safeDomainMin + 1);
  const safeRangeMin = safeNumber(rangeMin, 0);
  const safeRangeMax = safeNumber(rangeMax, safeRangeMin + 1);
  const domainSpan = safeDomainMax - safeDomainMin;
  if (domainSpan === 0) {
    const mid = (safeRangeMin + safeRangeMax) / 2;
    return () => mid;
  }
  return (value: number) => {
    const ratio = (safeNumber(value, safeDomainMin) - safeDomainMin) / domainSpan;
    return safeRangeMin + ratio * (safeRangeMax - safeRangeMin);
  };
}

// --- Ticks -------------------------------------------------------------

/**
 * "Nice" round tick values spanning `[min, max]`, the standard
 * round-to-1/2/5/10-times-a-power-of-ten algorithm (same family as d3's
 * `ticks()`). `count` is a target, not a guarantee — the algorithm always
 * prefers round numbers over hitting the count exactly, which is what makes
 * axis labels readable. A degenerate domain (`min === max`, e.g. a single
 * data point or a series that never changes) returns exactly that one value
 * rather than inventing a spread the data doesn't have.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const safeMin = safeNumber(min, 0);
  const safeMax = safeNumber(max, safeMin);
  if (safeMin === safeMax) return [safeMin];
  const lo = Math.min(safeMin, safeMax);
  const hi = Math.max(safeMin, safeMax);
  const safeCount = Math.max(1, Math.floor(safeNumber(count, 5)));
  const span = hi - lo;
  const rawStep = span / safeCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceStep =
    residual >= 5 ? 10 * magnitude : residual >= 2 ? 5 * magnitude : residual >= 1 ? 2 * magnitude : magnitude;
  const niceMin = Math.floor(lo / niceStep) * niceStep;
  const niceMax = Math.ceil(hi / niceStep) * niceStep;
  const ticks: number[] = [];
  // The `+ niceStep * 1e-9` guard covers float drift that would otherwise
  // silently drop the final tick (e.g. 1 + 0.1 + 0.1 + ... never exactly
  // reaching 1.3 in floating point).
  for (let t = niceMin; t <= niceMax + niceStep * 1e-9; t += niceStep) {
    ticks.push(Math.round(t / niceStep) * niceStep);
  }
  return ticks;
}

// --- Line / area paths -------------------------------------------------

/**
 * An SVG `d` path string through `points`, in order. An empty series
 * produces an empty string (nothing to draw, not an error); a single point
 * produces a path with only a move command (`M x,y`, no `L`) — SVG renders
 * that as nothing visible on its own, which is correct: a genuine one-point
 * "line" has no line segment to show, and callers (e.g. `Sparkline`) should
 * render an explicit point marker for that case instead of relying on this
 * path.
 */
export function buildLinePath(points: readonly Point[]): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return rest.reduce(
    (path, point) => `${path} L ${formatCoord(point.x)},${formatCoord(point.y)}`,
    `M ${formatCoord(first.x)},${formatCoord(first.y)}`,
  );
}

/**
 * The same line, closed down to `baselineY` and back to the first point's
 * x, for a filled area under the line. Shares `buildLinePath`'s empty/
 * single-point degradation.
 */
export function buildAreaPath(points: readonly Point[], baselineY: number): string {
  if (points.length === 0) return "";
  const linePath = buildLinePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  const safeBaseline = safeNumber(baselineY, first.y);
  return `${linePath} L ${formatCoord(last.x)},${formatCoord(safeBaseline)} L ${formatCoord(first.x)},${formatCoord(safeBaseline)} Z`;
}

// --- Bar layout ----------------------------------------------------------

export interface BarRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The clamped (non-negative, finite) value this bar actually represents —
   *  callers can use it for the accessible label without re-deriving it. */
  value: number;
}

export interface BarLayoutOptions {
  width: number;
  height: number;
  /** Fraction of each bar's slot spent on the gap rather than the bar
   *  itself, clamped to [0, 0.9] so a bar never fully disappears. */
  gapRatio?: number;
  /** Explicit scale ceiling (e.g. a fixed axis max shared across charts);
   *  defaults to the series' own maximum. */
  maxValue?: number;
}

/**
 * Evenly spaced bar rectangles across `width`, scaled to `height` against
 * `maxValue` (or the series' own max). Bars grow UP from the bottom of the
 * given box (`y=0` is the top, matching SVG's coordinate system — a bar's
 * `y` is `height - barHeight`, not `0`). Negative or non-finite values clamp
 * to zero (a bar can't have negative height in this layout; the plan's chart
 * usages — doc counts, chat counts, spend — are never meaningfully negative).
 * An empty series or a non-positive box returns no rectangles at all.
 */
export function barLayout(values: readonly number[], options: BarLayoutOptions): BarRect[] {
  const safeWidth = safeNumber(options.width, 0);
  const safeHeight = safeNumber(options.height, 0);
  if (values.length === 0 || safeWidth <= 0 || safeHeight <= 0) return [];
  const gapRatio = clamp(safeNumber(options.gapRatio ?? 0.35, 0.35), 0, 0.9);
  const seriesMax = Math.max(0, ...values.map((v) => safeNumber(v, 0)));
  const maxValue = options.maxValue !== undefined ? safeNumber(options.maxValue, seriesMax) : seriesMax;
  const safeMax = maxValue > 0 ? maxValue : 1;
  const slot = safeWidth / values.length;
  const barWidth = slot * (1 - gapRatio);
  const gap = slot * gapRatio;
  return values.map((raw, index) => {
    const value = Math.max(0, safeNumber(raw, 0));
    const barHeight = (value / safeMax) * safeHeight;
    return {
      x: formatCoord(index * slot + gap / 2),
      y: formatCoord(safeHeight - barHeight),
      width: formatCoord(barWidth),
      height: formatCoord(barHeight),
      value,
    };
  });
}

// --- Sparkline -----------------------------------------------------------

/**
 * A minimal trend path with no axes — domain is the series' own min/max
 * (not zero-based, since a sparkline's job is to show relative movement in
 * a small space, not an absolute scale). Fewer than two points has no line
 * to draw (`""`); `Sparkline.tsx` renders a single dot itself for the
 * one-point case, same reasoning as `buildLinePath`'s single-point note.
 */
export function sparklinePath(values: readonly number[], width: number, height: number, padding = 2): string {
  if (values.length < 2) return "";
  const safeWidth = safeNumber(width, 0);
  const safeHeight = safeNumber(height, 0);
  const safePadding = clamp(safeNumber(padding, 2), 0, Math.min(safeWidth, safeHeight) / 2 || 0);
  const min = Math.min(...values.map((v) => safeNumber(v, 0)));
  const max = Math.max(...values.map((v) => safeNumber(v, 0)));
  const xScale = linearScale(0, values.length - 1, safePadding, safeWidth - safePadding);
  // Inverted range: a larger value must land at a SMALLER y (SVG's y grows
  // downward), so the visual "up" for a bigger number is actually up.
  const yScale = linearScale(min, max, safeHeight - safePadding, safePadding);
  const points = values.map((v, index) => ({ x: xScale(index), y: yScale(safeNumber(v, min)) }));
  return buildLinePath(points);
}

// --- Radar -----------------------------------------------------------------

/**
 * The angle (radians) of axis `index` out of `axisCount`, evenly spaced
 * clockwise starting straight up (`-90°`) — the conventional radar-chart
 * layout (first axis at 12 o'clock).
 */
export function radarAxisAngle(index: number, axisCount: number): number {
  const safeCount = Math.max(1, Math.floor(safeNumber(axisCount, 1)));
  return -Math.PI / 2 + (index * 2 * Math.PI) / safeCount;
}

/**
 * The point for axis `index`'s value on a radar chart centered at
 * `(cx, cy)` with outer `radius`. `value`/`maxValue` are clamped to
 * `[0, radius]` worth of distance from center — a value at or above
 * `maxValue` sits exactly on the outer ring, never past it, and a
 * non-finite/negative value sits at the center rather than off-chart.
 */
export function radarPoint(
  index: number,
  axisCount: number,
  value: number,
  maxValue: number,
  cx: number,
  cy: number,
  radius: number,
): Point {
  const safeMax = safeNumber(maxValue, 1) > 0 ? safeNumber(maxValue, 1) : 1;
  const ratio = clamp(safeNumber(value, 0) / safeMax, 0, 1);
  const angle = radarAxisAngle(index, axisCount);
  const r = safeNumber(radius, 0) * ratio;
  return {
    x: cx + r * Math.cos(angle),
    y: cy + r * Math.sin(angle),
  };
}

/**
 * The closed polygon path for one radar series — one point per value, in
 * axis order, closed back to the start. An empty series draws nothing.
 */
export function radarPolygonPath(
  values: readonly number[],
  maxValue: number,
  cx: number,
  cy: number,
  radius: number,
): string {
  if (values.length === 0) return "";
  const points = values.map((value, index) => radarPoint(index, values.length, value, maxValue, cx, cy, radius));
  const path = buildLinePath(points);
  return path ? `${path} Z` : "";
}

/**
 * One concentric grid ring at `ringFraction` (0-1) of the outer radius,
 * e.g. `[0.25, 0.5, 0.75, 1]` for a standard 4-ring grid. Shares
 * `radarPoint`'s clamping, so a fraction outside `[0, 1]` still degrades to
 * a valid ring rather than an off-chart shape.
 */
export function radarRingPath(axisCount: number, cx: number, cy: number, radius: number, ringFraction: number): string {
  const safeCount = Math.max(0, Math.floor(safeNumber(axisCount, 0)));
  if (safeCount < 3) return "";
  const points = Array.from({ length: safeCount }, (_, index) =>
    radarPoint(index, safeCount, ringFraction, 1, cx, cy, radius),
  );
  const path = buildLinePath(points);
  return path ? `${path} Z` : "";
}
