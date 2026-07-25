import { barLayout, niceTicks } from "./chartGeometry";
import { chartSeriesColorVar } from "./chartPalette";

export interface BarChartDatum {
  label: string;
  value: number;
}

export interface BarChartProps {
  data: BarChartDatum[];
  width?: number;
  height?: number;
  yFormat?: (value: number) => string;
  colorVar?: string;
  className?: string;
  title: string;
  emptyLabel?: string;
}

const PADDING = { top: 12, right: 12, bottom: 26, left: 34 };

/**
 * A pure-SVG, server-renderable single-series bar chart (RSC-compatible,
 * zero client JS — same "no chart lib" posture as `LineChart.tsx`, see
 * that file's doc comment). Bars carry their own value as a visible
 * `<title>` tooltip-equivalent (no hover JS available) and as the shared
 * `aria-label` chart summary — never color-only, since there is only ever
 * one visual series here (categories are distinguished by their own text
 * label under each bar, not by color).
 */
export function BarChart({
  data,
  width = 480,
  height = 220,
  yFormat = (value) => `${Math.round(value)}`,
  colorVar = chartSeriesColorVar(0),
  className,
  title,
  emptyLabel = "No data yet",
}: BarChartProps) {
  const hasData = data.length > 0 && data.some((d) => Number.isFinite(d.value) && d.value > 0);
  if (!hasData) {
    return (
      <div className={`flex items-center justify-center text-sm text-[var(--color-text-muted)] ${className ?? ""}`} style={{ height }}>
        {emptyLabel}
      </div>
    );
  }

  const plotLeft = PADDING.left;
  const plotRight = width - PADDING.right;
  const plotTop = PADDING.top;
  const plotBottom = height - PADDING.bottom;
  const plotWidth = plotRight - plotLeft;
  const plotHeight = plotBottom - plotTop;

  const values = data.map((d) => d.value);
  const ticks = niceTicks(0, Math.max(...values), 4);
  const maxTick = Math.max(...ticks, 1);

  const bars = barLayout(values, { width: plotWidth, height: plotHeight, maxValue: maxTick, gapRatio: 0.4 });

  return (
    <figure className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={title} className="max-w-full">
        <title>{title}</title>
        {ticks.map((tick) => {
          const y = plotTop + plotHeight - (tick / maxTick) * plotHeight;
          return (
            <g key={tick}>
              <line x1={plotLeft} y1={y} x2={plotRight} y2={y} stroke="var(--color-border)" strokeWidth={1} />
              <text x={plotLeft - 6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--color-text-muted)">
                {yFormat(tick)}
              </text>
            </g>
          );
        })}
        {bars.map((bar, index) => (
          <g key={data[index]!.label} style={{ "--chart-stagger-index": index } as React.CSSProperties}>
            <rect
              x={plotLeft + bar.x}
              y={plotTop + bar.y}
              width={bar.width}
              height={bar.height}
              fill={`var(${colorVar})`}
              rx={2}
              className="chart-bar-grow"
            >
              <title>{`${data[index]!.label}: ${yFormat(bar.value)}`}</title>
            </rect>
            <text
              x={plotLeft + bar.x + bar.width / 2}
              y={height - 8}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-text-muted)"
            >
              {data[index]!.label}
            </text>
          </g>
        ))}
      </svg>
    </figure>
  );
}
