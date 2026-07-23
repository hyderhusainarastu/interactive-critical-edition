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

export function findQuoteOffset(
  fullText: string,
  quote: string,
  prefix: string,
  suffix: string,
): number | null {
  const combined = prefix + quote + suffix;
  const exact = fullText.indexOf(combined);
  if (exact !== -1) return exact + prefix.length;

  const occurrences: number[] = [];
  let from = 0;
  for (;;) {
    const found = fullText.indexOf(quote, from);
    if (found === -1) break;
    occurrences.push(found);
    from = found + 1;
  }
  if (occurrences.length === 0) return null;
  if (occurrences.length === 1) return occurrences[0];

  let best = occurrences[0];
  let bestScore = -1;
  for (const occ of occurrences) {
    const before = fullText.slice(Math.max(0, occ - prefix.length), occ);
    const after = fullText.slice(occ + quote.length, occ + quote.length + suffix.length);
    const score = (before === prefix ? 1 : 0) + (after === suffix ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = occ;
    }
  }
  return best;
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
