/**
 * D-25-L4: dynamic two-column detection for the PDF flat-fallback path
 * (no GROBID structure — see `parsers/pdf.ts`). Ported from ScholarLens's
 * `_find_column_split` (scholarlens_src/utils/pdf_parser.py `_find_column_split`).
 *
 * ScholarLens uses PyMuPDF, which returns paragraph-level BLOCK bounding
 * boxes in a top-left-origin, y-down space. unpdf/pdf.js instead exposes
 * individual TEXT ITEMS (a run of glyphs sharing one font/position) via
 * `page.getTextContent()`, each with an affine `transform` whose `e`/`f`
 * components are its x/y origin in raw PDF user space — bottom-left
 * origin, y increasing UPWARD (the PDF spec's own convention, not screen
 * space). The bucket-halves-plus-sparse-gutter heuristic itself is
 * geometry-only and applies identically to item x-origins as it does to
 * block x-origins; only the y-sort direction differs, handled in
 * `orderItemsForColumns` below.
 */

export interface PositionedTextItem {
  /** x-origin in raw PDF user space (pdf.js TextItem.transform[4]). */
  x: number;
  /** y-origin in raw PDF user space (pdf.js TextItem.transform[5]); larger = higher on the page. */
  y: number;
  str: string;
  hasEOL: boolean;
}

/**
 * Given the x-origin of every text item on a page, decide whether the page
 * has two columns and, if so, return the x-coordinate of the gap between
 * them. Direct port of ScholarLens's `_find_column_split`: bucket x-origins
 * into left/right halves of the page (ignoring a 5%-of-width margin around
 * the centre — headers/footers/full-width lines land there), and call it
 * two-column only when both halves are meaningfully populated (>20% each)
 * and the centre gap is sparse (<10%). Intentionally coarse, matching the
 * original's own rationale: academic two-column layouts have a clear
 * gutter, so this doesn't need k-means or a real gap-density scan.
 */
export function findColumnSplit(xOrigins: readonly number[], pageWidth: number): number | null {
  if (xOrigins.length === 0 || pageWidth <= 0) return null;

  const mid = pageWidth / 2;
  const margin = pageWidth * 0.05;

  let left = 0;
  let right = 0;
  let gap = 0;
  for (const x of xOrigins) {
    if (x < mid - margin) left += 1;
    else if (x > mid + margin) right += 1;
    else gap += 1;
  }

  const total = xOrigins.length;
  const leftFrac = left / total;
  const rightFrac = right / total;
  const gapFrac = gap / total;

  if (leftFrac > 0.2 && rightFrac > 0.2 && gapFrac < 0.1) return mid;
  return null;
}

/**
 * Order a page's text items into reading order: for a detected two-column
 * page, left column top-to-bottom then right column top-to-bottom; for a
 * single-column page, the ORIGINAL stream order, unchanged.
 *
 * The two-column sort is DESCENDING by y (largest y first) — the opposite
 * direction from ScholarLens's own `key=lambda b: b[1]` ascending sort —
 * because PyMuPDF's y-down convention makes a smaller y "higher on the
 * page," while pdf.js/unpdf's raw user-space y is bottom-left-origin and
 * y-up, so a LARGER y is higher on the page there. Same visual top-to-bottom
 * result, opposite numeric direction, because the two libraries hand back
 * different coordinate spaces for the same physical page.
 *
 * Returning items unchanged when no split is detected means a page this
 * function judges single-column produces byte-identical joined text to
 * unpdf's own flattening (see `parsers/pdf.ts`) — no regression risk for the
 * overwhelming majority (and every existing fixture), which is single-column.
 */
export function orderItemsForColumns(items: readonly PositionedTextItem[], pageWidth: number): PositionedTextItem[] {
  const split = findColumnSplit(items.map((item) => item.x), pageWidth);
  if (split === null) return [...items];

  const left = items.filter((item) => item.x < split).sort((a, b) => b.y - a.y);
  const right = items.filter((item) => item.x >= split).sort((a, b) => b.y - a.y);
  return [...left, ...right];
}

/** Mirrors unpdf's own `getPageText` join: each item's string, plus a
 *  newline where pdf.js marked the item as ending a line (`hasEOL`). */
export function joinPositionedItems(items: readonly PositionedTextItem[]): string {
  return items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");
}
