import type { ChartMarkerShape } from "./chartPalette";

/**
 * A small shape glyph at `(cx, cy)`, one of four distinct silhouettes so a
 * series is legible by shape alone even in grayscale/color-blind viewing —
 * never color as the only distinguishing signal (see `chartPalette.ts`'s
 * doc comment). Internal to this folder, not part of the public chart API.
 */
export function ChartMarker({ shape, cx, cy, colorVar, size = 3.5 }: {
  shape: ChartMarkerShape;
  cx: number;
  cy: number;
  colorVar: string;
  size?: number;
}) {
  const fill = `var(${colorVar})`;
  switch (shape) {
    case "square":
      return <rect x={cx - size} y={cy - size} width={size * 2} height={size * 2} fill={fill} />;
    case "diamond":
      return (
        <rect
          x={cx - size}
          y={cy - size}
          width={size * 2}
          height={size * 2}
          fill={fill}
          transform={`rotate(45 ${cx} ${cy})`}
        />
      );
    case "triangle": {
      const points = [
        [cx, cy - size * 1.15],
        [cx + size * 1.05, cy + size * 0.75],
        [cx - size * 1.05, cy + size * 0.75],
      ]
        .map(([x, y]) => `${x},${y}`)
        .join(" ");
      return <polygon points={points} fill={fill} />;
    }
    case "circle":
    default:
      return <circle cx={cx} cy={cy} r={size} fill={fill} />;
  }
}
