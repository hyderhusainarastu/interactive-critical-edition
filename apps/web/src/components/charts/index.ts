/**
 * Workstream G/H (v.5) chart package — hand-rolled SVG, no chart library
 * dependency (see the plan's "Charts — hand-rolled SVG, no chart lib"
 * section). Consumed by later lanes (Workstream G's account/usage/plan
 * pages, Workstream H's admin dashboard); this lane does not wire any page.
 */
export { AnimatedStat, type AnimatedStatProps } from "./AnimatedStat";
export { BarChart, type BarChartDatum, type BarChartProps } from "./BarChart";
export { InitialsAvatar, type InitialsAvatarProps } from "./InitialsAvatar";
export { LineChart, type LineChartProps, type LineChartSeries } from "./LineChart";
export { RadarChart, type RadarChartProps, type RadarChartSeries } from "./RadarChart";
export { Sparkline, type SparklineProps } from "./Sparkline";

export {
  avatarBackgroundColor,
  hueForId,
  initialsForName,
} from "./avatarColor";

export {
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
  type BarLayoutOptions,
  type BarRect,
  type Point,
} from "./chartGeometry";

export {
  chartMarkerShape,
  chartSeriesColorVar,
  CHART_MARKER_SHAPES,
  CHART_SERIES_COLOR_VARS,
  type ChartMarkerShape,
} from "./chartPalette";
