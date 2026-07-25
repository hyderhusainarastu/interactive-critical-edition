import { radarAxisAngle, radarPoint, radarPolygonPath, radarRingPath } from "./chartGeometry";
import { chartMarkerShape, chartSeriesColorVar } from "./chartPalette";
import { ChartMarker } from "./ChartMarker";

export interface RadarChartSeries {
  label: string;
  /** One value per axis, same order and length as `axes`. */
  values: number[];
  colorVar?: string;
}

export interface RadarChartProps {
  axes: string[];
  series: RadarChartSeries[];
  /** The scale ceiling every axis shares, e.g. 100 for a 0-100 mastery/
   *  credibility scale. */
  maxValue?: number;
  width?: number;
  height?: number;
  className?: string;
  title: string;
  emptyLabel?: string;
}

const GRID_RINGS = [0.25, 0.5, 0.75, 1];

/**
 * A pure-SVG, server-renderable radar/spider chart (RSC-compatible, zero
 * client JS — same posture as the other charts in this folder). Needs at
 * least 3 axes to read as a polygon at all; fewer than that renders the
 * empty state rather than a degenerate line. A value of 0 on every axis is
 * real, legible data (e.g. "no mastery yet" on every concept) and is NOT
 * treated as an empty state — only a genuinely empty `axes`/`series` input
 * is.
 */
export function RadarChart({
  axes,
  series,
  maxValue = 100,
  width = 260,
  height = 260,
  className,
  title,
  emptyLabel = "No data yet",
}: RadarChartProps) {
  if (axes.length < 3 || series.length === 0) {
    return (
      <div className={`flex items-center justify-center text-sm text-[var(--color-text-muted)] ${className ?? ""}`} style={{ height }}>
        {emptyLabel}
      </div>
    );
  }

  const cx = width / 2;
  const cy = height / 2;
  const labelPadding = 44;
  const radius = Math.max(20, Math.min(width, height) / 2 - labelPadding);

  return (
    <figure className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title} className="max-w-full">
        <title>{title}</title>
        {/* Grid rings */}
        {GRID_RINGS.map((fraction) => (
          <path
            key={fraction}
            d={radarRingPath(axes.length, cx, cy, radius, fraction)}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth={1}
          />
        ))}
        {/* Spokes + axis labels */}
        {axes.map((axis, index) => {
          const angle = radarAxisAngle(index, axes.length);
          const outer = radarPoint(index, axes.length, maxValue, maxValue, cx, cy, radius);
          const labelRadius = radius + 16;
          const lx = cx + labelRadius * Math.cos(angle);
          const ly = cy + labelRadius * Math.sin(angle);
          const cos = Math.cos(angle);
          const anchor = cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle";
          return (
            <g key={axis}>
              <line x1={cx} y1={cy} x2={outer.x} y2={outer.y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" fontSize={10} fill="var(--color-text-muted)">
                {axis}
              </text>
            </g>
          );
        })}
        {/* Series */}
        {series.map((s, seriesIndex) => {
          const colorVar = s.colorVar ?? chartSeriesColorVar(seriesIndex);
          const shape = chartMarkerShape(seriesIndex);
          const path = radarPolygonPath(s.values, maxValue, cx, cy, radius);
          return (
            <g key={s.label} className="chart-radar-grow">
              {path && (
                <path
                  d={path}
                  fill={`var(${colorVar})`}
                  fillOpacity={0.14}
                  stroke={`var(${colorVar})`}
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              )}
              {s.values.map((value, axisIndex) => {
                const p = radarPoint(axisIndex, axes.length, value, maxValue, cx, cy, radius);
                return <ChartMarker key={axisIndex} shape={shape} cx={p.x} cy={p.y} colorVar={colorVar} size={3} />;
              })}
            </g>
          );
        })}
      </svg>
      {series.length > 1 && (
        <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
          {series.map((s, index) => {
            const colorVar = s.colorVar ?? chartSeriesColorVar(index);
            const shape = chartMarkerShape(index);
            return (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <svg width={10} height={10} aria-hidden="true">
                  <ChartMarker shape={shape} cx={5} cy={5} colorVar={colorVar} size={3} />
                </svg>
                {s.label}
              </span>
            );
          })}
        </figcaption>
      )}
    </figure>
  );
}
