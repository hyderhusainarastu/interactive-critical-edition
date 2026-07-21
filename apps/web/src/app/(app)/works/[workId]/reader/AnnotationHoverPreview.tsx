"use client";

/**
 * Lightweight hover preview for an in-text annotation marker (plan §36
 * 11.5) — neither reader had this before. Shown on hover/pointerenter next
 * to the marker; purely a convenience for pointer users. The click path
 * (opening the sidebar card) remains fully sufficient on its own for touch
 * devices, which never fire hover.
 */
export function AnnotationHoverPreview({
  glyph,
  colorVar,
  categoryLabel,
  summary,
  anchorRect,
}: {
  glyph: string;
  colorVar: string;
  categoryLabel: string;
  summary: string;
  anchorRect: { top: number; left: number; bottom: number };
}) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-40 w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs shadow-lg"
      style={{
        top: anchorRect.bottom + 6,
        left: Math.max(8, anchorRect.left - 110),
      }}
    >
      <p className="flex items-center gap-1 font-medium" style={{ color: `var(${colorVar})` }}>
        <span aria-hidden>{glyph}</span> {categoryLabel}
      </p>
      <p className="mt-0.5 leading-snug text-[var(--color-text-muted)]">{summary}</p>
    </div>
  );
}
