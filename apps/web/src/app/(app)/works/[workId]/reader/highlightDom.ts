/**
 * Quote-anchored highlighting, shared between the PDF text layer and
 * the plain-text reader (plan §25 risk R3: "position anchoring by
 * stable offsets/text-fingerprint, not raw pixel/page coordinates").
 * A highlight is stored as {quote, prefix, suffix} — enough context to
 * relocate it deterministically inside a container's rendered text on
 * every render, even across re-renders where DOM nodes are recreated.
 * If a quote can't be found (e.g. underlying text genuinely changed),
 * it's skipped rather than mis-rendered or crashing.
 */

import { findQuoteOffset } from "@ice/claims";

// Re-exported for existing importers (`./matchNoteToBlock` and any future
// caller) — the actual matching algorithm now lives in `@ice/claims`'s
// `anchoring.ts` (Phase 26.1), moved there so the worker's claim-rebind step
// can share the exact same pure logic instead of re-implementing it. This
// file keeps the DOM-specific helpers below (`getTextNodeSpans`,
// `wrapRange`, `applyHighlights`, ...), which never moved — they all take a
// live `HTMLElement`, which `@ice/claims` deliberately stays free of.
export { findQuoteOffset };

export interface HighlightAnchor {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  color: string;
}

interface TextNodeSpan {
  node: Text;
  start: number;
  end: number;
}

function getTextNodeSpans(container: HTMLElement): TextNodeSpan[] {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const spans: TextNodeSpan[] = [];
  let offset = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const len = node.textContent?.length ?? 0;
    if (len > 0) {
      spans.push({ node, start: offset, end: offset + len });
      offset += len;
    }
    node = walker.nextNode() as Text | null;
  }
  return spans;
}

function wrapRange(container: HTMLElement, matchStart: number, matchEnd: number, id: string, color: string) {
  for (const { node, start, end } of getTextNodeSpans(container)) {
    if (end <= matchStart || start >= matchEnd) continue;
    const text = node.textContent ?? "";
    const localStart = Math.max(0, matchStart - start);
    const localEnd = Math.min(text.length, matchEnd - start);
    const before = text.slice(0, localStart);
    const mid = text.slice(localStart, localEnd);
    const after = text.slice(localEnd);

    const mark = document.createElement("mark");
    mark.textContent = mid;
    mark.dataset.highlightId = id;
    mark.className = `reader-highlight reader-highlight-${color}`;

    const parent = node.parentNode;
    if (!parent) continue;
    if (before) parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(mark, node);
    if (after) parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);
  }
}

export function clearHighlights(container: HTMLElement) {
  const marks = container.querySelectorAll("mark[data-highlight-id]");
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
    parent.normalize();
  });
}

/** Re-renders idempotently: clears prior marks, then reapplies every highlight. */
export function applyHighlights(container: HTMLElement, list: HighlightAnchor[]) {
  clearHighlights(container);
  for (const h of list) {
    const spans = getTextNodeSpans(container);
    const fullText = spans.map((s) => s.node.textContent).join("");
    const matchStart = findQuoteOffset(fullText, h.quote, h.prefix, h.suffix);
    if (matchStart === null) continue;
    wrapRange(container, matchStart, matchStart + h.quote.length, h.id, h.color);
  }
}

export interface AnnotationMarkerAnchor {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  /** CSS var name (e.g. "--color-accent-ink") from CATEGORY_META — the
   *  one source of truth for category colors (plan §36 11.2). Applied as
   *  an inline custom property rather than a per-category CSS class. */
  colorVar: string;
  /** Short glyph shown inside the marker. */
  glyph: string;
  /** Distinguishes DB-anchored passage annotations from inferred note matches. */
  markerKind?: "annotation" | "matched-note";
  ariaLabel?: string;
}

/**
 * Renders AI annotations as single-point clickable superscript markers
 * inserted at the start of each anchored passage — deliberately NOT
 * range-wrapping like highlights, so this layer can coexist with the
 * user-highlight layer on the same text without the two fighting over
 * overlapping DOM ranges. The marker is visually distinct from both the
 * original-footnote markers and user highlights (plan §9/§18 four-way
 * distinction): a colored, glyph-bearing superscript. Idempotent —
 * clears its own markers first, then reapplies.
 */
export function applyAnnotationMarkers(
  container: HTMLElement,
  list: AnnotationMarkerAnchor[],
) {
  clearAnnotationMarkers(container);
  for (const a of list) {
    const spans = getTextNodeSpans(container);
    const fullText = spans.map((s) => s.node.textContent).join("");
    const offset = findQuoteOffset(fullText, a.quote, a.prefix, a.suffix);
    if (offset === null) continue;

    // Find the text node containing `offset` and split it there.
    const span = spans.find((s) => offset >= s.start && offset < s.end);
    if (!span) continue;
    const localOffset = offset - span.start;
    const node = span.node;
    const insertionPoint = localOffset === 0 ? node : node.splitText(localOffset);

    const marker = document.createElement("button");
    marker.type = "button";
    marker.dataset.annotationId = a.id;
    if (a.markerKind) marker.dataset.markerKind = a.markerKind;
    marker.className = `reader-annotation-marker${a.markerKind === "matched-note" ? " reader-annotation-marker-matched" : ""}`;
    marker.style.setProperty("--reader-annotation-color", `var(${a.colorVar})`);
    marker.textContent = a.glyph;
    marker.setAttribute("aria-label", a.ariaLabel ?? "Automated annotation — open details");
    node.parentNode?.insertBefore(marker, insertionPoint);
  }
}

export function clearAnnotationMarkers(container: HTMLElement) {
  container.querySelectorAll("button[data-annotation-id]").forEach((m) => {
    const parent = m.parentNode;
    m.remove();
    parent?.normalize();
  });
}

export interface FootnoteMarkerAnchor {
  id: string;
  /** findQuoteOffset anchor for the marker reference (the token ending in the
   *  marker, plus context). Re-located in the rendered DOM, so it survives the
   *  reader displaying untranscribable/verified spans differently from the
   *  stored block text. */
  quote: string;
  prefix: string;
  suffix: string;
  /** The note's marker number (aria/label only; the glyph is drawn via CSS). */
  marker: string;
  ariaLabel: string;
}

/**
 * Authorial-footnote reference markers (Lane G Fix 2b). Rendered as a distinct
 * superscript button — a separate class and `data-footnote-id`, never the
 * `data-annotation-id` used for AI-generated annotations — so the four-way
 * source distinction (plan §9/§18) is preserved: an authorial note reference
 * never looks like a generated annotation. The marker is placed just AFTER the
 * reference (re-located by quote, same mechanism as highlights/annotations),
 * and adds no text node of its own. Idempotent — clears its own markers first.
 */
export function applyFootnoteMarkers(container: HTMLElement, list: FootnoteMarkerAnchor[]) {
  clearFootnoteMarkers(container);
  for (const a of list) {
    const spans = getTextNodeSpans(container);
    const fullText = spans.map((s) => s.node.textContent).join("");
    const start = findQuoteOffset(fullText, a.quote, a.prefix, a.suffix);
    if (start === null) continue;
    const offset = start + a.quote.length; // just after the reference

    const span = spans.find((s) => offset >= s.start && offset < s.end)
      ?? spans.find((s) => offset === s.end); // reference at the very end of a text node
    if (!span) continue;
    const localOffset = Math.min(offset - span.start, span.node.textContent?.length ?? 0);
    const node = span.node;
    const insertionPoint = localOffset === 0 ? node : node.splitText(localOffset);

    const marker = document.createElement("button");
    marker.type = "button";
    marker.dataset.footnoteId = a.id;
    marker.dataset.marker = a.marker;
    marker.className = "reader-footnote-marker";
    // No textContent: the glyph is drawn from `data-marker` via CSS ::before,
    // so this button adds no text node and cannot shift the offsets the
    // reader's quote/untranscribable matching relies on.
    marker.setAttribute("aria-label", a.ariaLabel);
    node.parentNode?.insertBefore(marker, insertionPoint);
  }
}

export function clearFootnoteMarkers(container: HTMLElement) {
  container.querySelectorAll("button[data-footnote-id]").forEach((m) => {
    const parent = m.parentNode;
    m.remove();
    parent?.normalize();
  });
}

/**
 * Captures the current browser selection within `container` as a
 * stable anchor. Returns null if there's no selection or it falls
 * outside the container.
 */
export function captureSelectionAnchor(
  container: HTMLElement,
): { quote: string; prefix: string; suffix: string } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const quote = range.toString().trim();
  if (!quote) return null;

  const spans = getTextNodeSpans(container);
  const fullText = spans.map((s) => s.node.textContent).join("");

  // Locate the selection's start offset within the container's flattened text.
  const preRange = range.cloneRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.startContainer, range.startOffset);
  const startOffset = preRange.toString().length;

  const CONTEXT = 40;
  const prefix = fullText.slice(Math.max(0, startOffset - CONTEXT), startOffset);
  const suffix = fullText.slice(startOffset + quote.length, startOffset + quote.length + CONTEXT);

  return { quote, prefix, suffix };
}
