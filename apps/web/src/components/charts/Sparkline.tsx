import { sparklinePath } from "./chartGeometry";
import { chartSeriesColorVar } from "./chartPalette";

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  colorVar?: string;
  className?: string;
  /** Accessible name — sparklines carry no visible axis, so this is the
   *  only description assistive tech gets. */
  title: string;
}

/**
 * A minimal trend line with no axes or labels — for a compact inline
 * indicator (e.g. "chat activity" beside a stat tile), not a standalone
 * chart. Pure SVG, RSC-compatible, zero client JS, same draw-in convention
 * as `LineChart.tsx`. A single data point has no line to draw, so it
 * renders one static dot instead of an empty chart.
 */
export function Sparkline({ values, width = 96, height = 28, colorVar = chartSeriesColorVar(0), className, title }: SparklineProps) {
  const finiteValues = values.filter((v) => Number.isFinite(v));
  if (finiteValues.length === 0) {
    return <svg width={width} height={height} className={className} role="img" aria-label={`${title}: no data yet`} />;
  }
  if (finiteValues.length === 1) {
    return (
      <svg width={width} height={height} role="img" aria-label={title} className={className}>
        <title>{title}</title>
        <circle cx={width / 2} cy={height / 2} r={3} fill={`var(${colorVar})`} />
      </svg>
    );
  }
  const path = sparklinePath(finiteValues, width, height, 3);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={title} className={className}>
      <title>{title}</title>
      <path
        d={path}
        fill="none"
        stroke={`var(${colorVar})`}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray={1}
        className="chart-draw-line"
      />
    </svg>
  );
}
