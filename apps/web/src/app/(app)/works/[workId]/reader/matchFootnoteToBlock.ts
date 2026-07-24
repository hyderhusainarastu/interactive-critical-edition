/**
 * Read-time anchoring for authorial footnotes/endnotes (Lane G Fix 2b). Like
 * `matchNoteToBlock`, anchors are NEVER persisted — they are recomputed on read
 * by conservative matching, so the pipeline never stores a fabricated block id.
 *
 * A footnote carries a numeric marker (e.g. "3"), not an evidence quote, so the
 * "quote" we search for is the marker's inline reference in the body text — the
 * superscript digit printed where the note is called out ("…choice".3 This…").
 * The zero-or-one rule from `matchNoteToBlock` is applied DOCUMENT-WIDE: a
 * marker anchors only when its reference occurs in exactly one place across all
 * body blocks. Numeric markers are ambiguous by nature (a "2" appears in
 * Bekker numbers, years, and page ranges everywhere), so most markers match
 * zero or many positions and fall back to the Apparatus panel list — which is
 * expected and correct, not a failure.
 */

export interface FootnoteBlockMatch {
  footnoteId: string;
  blockId: string;
  marker: string;
  /** A findQuoteOffset-style anchor: the token ending in the marker, plus a
   *  small surrounding context. Re-located in the rendered DOM on read (not a
   *  raw offset), so it survives the reader replacing untranscribable/verified
   *  spans with different display text. */
  quote: string;
  prefix: string;
  suffix: string;
}

const CONTEXT = 24;
const SUFFIX = 8;

/** Occurrences of the numeric marker `marker` in `text` in a footnote-reference
 *  position: preceded by a letter or closing punctuation (the end of the word
 *  the superscript hangs off), not part of a longer number, and not a decimal
 *  or Bekker fragment (no digit or '.' immediately on either side). */
function referenceOffsets(text: string, marker: string): number[] {
  const offsets: number[] = [];
  // `marker` is validated as digits-only by the caller, so this is a safe,
  // fully-escaped pattern despite being built from a variable.
  const pattern = new RegExp(`(?<=[\\p{L}”"'’).,;:!?])${marker}(?![\\d.])`, "gu");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const before = text[match.index - 1];
    const twoBefore = text[match.index - 2];
    // Reject a Bekker fragment like "b29": a single letter preceded by a digit
    // is not the end of a word the superscript would hang off.
    if (before && /\p{L}/u.test(before) && twoBefore && /\d/.test(twoBefore)) continue;
    if (/\d/.test(text[match.index - 1] ?? "")) continue; // defensive: never mid-number
    offsets.push(match.index);
  }
  return offsets;
}

/** Build a findQuoteOffset anchor for a marker reference at `offset` in `text`:
 *  the token that ends in the marker (e.g. "choice3"), plus a short prefix and
 *  suffix for disambiguation. */
function anchorAt(text: string, offset: number, marker: string): { quote: string; prefix: string; suffix: string } {
  let tokenStart = offset;
  while (tokenStart > 0 && !/\s/.test(text[tokenStart - 1])) tokenStart -= 1;
  const quoteEnd = offset + marker.length;
  return {
    quote: text.slice(tokenStart, quoteEnd),
    prefix: text.slice(Math.max(0, tokenStart - CONTEXT), tokenStart),
    suffix: text.slice(quoteEnd, quoteEnd + SUFFIX),
  };
}

export function matchFootnotesToBlocks(
  footnotes: Array<{ id: string; marker: string | null }>,
  blocks: Array<{ id: string; text: string }>,
): FootnoteBlockMatch[] {
  const matches: FootnoteBlockMatch[] = [];
  for (const footnote of footnotes) {
    const marker = footnote.marker?.trim();
    if (!marker || !/^\d{1,4}$/.test(marker)) continue; // numeric markers only

    const hits: Array<{ blockId: string; text: string; offset: number }> = [];
    for (const block of blocks) {
      for (const offset of referenceOffsets(block.text, marker)) {
        hits.push({ blockId: block.id, text: block.text, offset });
      }
    }
    if (hits.length !== 1) continue; // zero-or-many → fall back to the apparatus list
    const hit = hits[0];
    matches.push({ footnoteId: footnote.id, blockId: hit.blockId, marker, ...anchorAt(hit.text, hit.offset, marker) });
  }
  return matches;
}
