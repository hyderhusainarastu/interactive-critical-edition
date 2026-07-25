import { buildLinePath, linearScale, niceTicks } from "./chartGeometry";
import { chartMarkerShape, chartSeriesColorVar } from "./chartPalette";
import { ChartMarker } from "./ChartMarker";

export interface LineChartSeries {
  label: string;
  values: number[];
  /** Overrides the palette's rotating default, e.g. to keep a series'
   *  color stable across two charts that show different subsets. */
  colorVar?: string;
}

export interface LineChartProps {
  series: LineChartSeries[];
  /** Shared x-axis category labels, same length/order as each series'
   *  `values`. Rendered under every 3rd-or-so tick when there are many, to
   *  avoid overlapping text. */
  xLabels?: string[];
  width?: number;
  height?: number;
  /** Formats a y-axis tick value for display, e.g. `(n) => \`${n}\`` or a
   *  currency/percent formatter. Defaults to plain integers. */
  yFormat?: (value: number) => string;
  /** Whether the y-axis always includes 0 — on by default so the chart
   *  never visually exaggerates a small change by truncating the axis. */
  includeZero?: boolean;
  className?: string;
  /** Accessible name for the chart's own `role="img"`. */
  title: string;
  emptyLabel?: string;
}

const PADDING = { top: 12, right: 12, bottom: 26, left: 34 };

/**
 * A pure-SVG, server-renderable multi-series line chart (RSC-compatible,
 * zero client JS — no tooltip/hover interactivity by design, see the plan's
 * "Charts — hand-rolled SVG, no chart lib" section). Series are
 * distinguished by marker shape AND a text legend, never color alone.
 * Draw-in animation is applied via the `.chart-draw-line` CSS class
 * (`globals.css`), which is itself motion-gated in pure CSS — see that
 * class's doc comment for why no client-side reduced-motion check is
 * needed here.
 */
export function LineChart({
  series,
  xLabels,
  width = 480,
  height = 220,
  yFormat = (value) => `${Math.round(value)}`,
  includeZero = true,
  className,
  title,
  emptyLabel = "No data yet",
}: LineChartProps) {
  const pointCount = Math.max(0, ...series.map((s) => s.values.length));
  const hasData = series.length > 0 && pointCount > 0 && series.some((s) => s.values.some((v) => Number.isFinite(v)));

  if (!hasData) {
    return (
      <div className={`flex items-center justify-center text-sm text-[var(--color-text-muted)] ${className ?? ""}`} style={{ height }}>
        {emptyLabel}
      </div>
    );
  }

  const allValues = series.flatMap((s) => s.values.filter((v) => Number.isFinite(v)));
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const domainMin = includeZero ? Math.min(0, rawMin) : rawMin;
  const domainMax = includeZero ? Math.max(0, rawMax) : rawMax;
  const ticks = niceTicks(domainMin, domainMax, 4);
  const tickMin = Math.min(...ticks);
  const tickMax = Math.max(...ticks);

  const plotLeft = PADDING.left;
  const plotRight = width - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = height - PADDING.bottom;

  const xScale = linearScale(0, Math.max(1, pointCount - 1), plotLeft, plotRight);
  const yScale = linearScale(tickMin, tickMax, plotBottom, plotTop);

  // Render at most 6 x-axis labels so long series never overlap their text.
  const labelStride = xLabels && xLabels.length > 6 ? Math.ceil(xLabels.length / 6) : 1;

  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={title}
        className="max-w-full"
      >
        <title>{title}</title>
        {/* Y-axis grid + tick labels */}
        {ticks.map((tick) => {
          const y = yScale(tick);
          return (
            <g key={tick}>
              <line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={plotLeft - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--color-text-muted)">
                {yFormat(tick)}
              </text>
            </g>
          );
        })}
        {/* X-axis category labels */}
        {xLabels?.map((label, index) =>
          index % labelStride === 0 ? (
            <text
              key={index}
              x={xScale(index)}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-text-muted)"
            >
              {label}
            </text>
          ) : null,
        )}
        {series.map((s, seriesIndex) => {
          const colorVar = s.colorVar ?? chartSeriesColorVar(seriesIndex);
          const shape = chartMarkerShape(seriesIndex);
          const points = s.values
            .map((value, index) => (Number.isFinite(value) ? { x: xScale(index), y: yScale(value) } : null))
            .filter((p): p is { x: number; y: number } => p !== null);
          const path = buildLinePath(points);
          return (
            <g key={s.label}>
              {path && (
                <path
                  d={path}
                  fill="none"
                  stroke={`var(${colorVar})`}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray={1}
                  className="chart-draw-line"
                  style={{ "--chart-stagger-index": seriesIndex } as React.CSSProperties}
                />
              )}
              {points.map((p, i) => (
                <ChartMarker key={i} shape={shape} cx={p.x} cy={p.y} colorVar={colorVar} />
              ))}
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
