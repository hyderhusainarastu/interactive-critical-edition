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
  boundaryRect,
}: {
  glyph: string;
  colorVar: string;
  categoryLabel: string;
  summary: string;
  anchorRect: { top: number; left: number; bottom: number };
  /** Clamp to the processed-reader region so the fixed tooltip never paints
   * across either sticky reader rail. */
  boundaryRect: { left: number; right: number };
}) {
  const width = 256;
  const gap = 8;
  const minLeft = Math.max(gap, boundaryRect.left + gap);
  const maxLeft = Math.max(minLeft, Math.min(window.innerWidth - width - gap, boundaryRect.right - width - gap));
  const left = Math.min(Math.max(anchorRect.left - 110, minLeft), maxLeft);
  const placeAbove = anchorRect.bottom + 120 > window.innerHeight;
  return (
    <div
      role="tooltip"
      data-reader-hover-preview
      className="reader-hover-preview pointer-events-none fixed w-64 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs shadow-lg"
      style={{
        top: placeAbove ? anchorRect.top - 6 : anchorRect.bottom + 6,
        left,
        transform: placeAbove ? "translateY(-100%)" : undefined,
      }}
    >
      <p className="flex items-center gap-1 font-medium" style={{ color: `var(${colorVar})` }}>
        <span aria-hidden>{glyph}</span> {categoryLabel}
      </p>
      <p className="mt-0.5 leading-snug text-[var(--color-text-muted)]">{summary}</p>
    </div>
  );
}
