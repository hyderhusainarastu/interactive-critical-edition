/**
 * Workstream G/H (v.5) shared chart palette. `--color-accent-ink` is
 * primary; umber/burgundy are the secondary series colors, matching the
 * plan's explicit palette instruction. `--color-accent-green` is
 * deliberately never included here — the theme reserves it for a specific
 * "good"/positive meaning elsewhere (credibility bands, success states),
 * and reusing it as a generic series color would flip that meaning for any
 * chart that happens to put it on a series that isn't "good" (a polarity
 * flip the plan calls out by name).
 *
 * Every chart also distinguishes series by marker SHAPE and its text
 * label, never color alone (color-blind/grayscale-safe, matches the
 * project's existing "never color alone" discipline — see
 * `CredibilityMeter.tsx`/`edgeRelationLabel`).
 */
export const CHART_SERIES_COLOR_VARS = [
  "--color-accent-ink",
  "--color-accent-umber",
  "--color-accent-burgundy",
] as const;

export type ChartMarkerShape = "circle" | "square" | "diamond" | "triangle";

export const CHART_MARKER_SHAPES: readonly ChartMarkerShape[] = ["circle", "square", "diamond", "triangle"];

export function chartSeriesColorVar(index: number): string {
  return CHART_SERIES_COLOR_VARS[index % CHART_SERIES_COLOR_VARS.length];
}

export function chartMarkerShape(index: number): ChartMarkerShape {
  return CHART_MARKER_SHAPES[index % CHART_MARKER_SHAPES.length];
}
