/**
 * Page-bottom numbered-footnote recovery — the footnote analogue of
 * `endnoteRecovery.ts` (D-20-89). On some scanned journal PDFs (confirmed on
 * the Brickhouse "Does Aristotle Have a Consistent Account of Vice?" fixture)
 * GROBID emits ZERO `<note>` elements: every footnote is either dropped or
 * mis-segmented into a body block. The footnotes are still fully present in
 * the text layer, numbered continuously across the document and printed at the
 * bottom of each page.
 *
 * This scans the same per-page text layer `parsePdf` already extracts and
 * recovers entries whose marker number GROBID's structural output did not
 * already produce, feeding the existing `doc_footnote` / `document_apparatus`
 * path with a `recovered` flag (source "text-layer-recovery") so provenance
 * stays honest — never presented as GROBID/layout-aware structure.
 *
 * Precision, mirroring endnote recovery:
 *  - A SEQUENTIAL document-running expected counter (1, 2, 3, …) — a line is a
 *    footnote start only if it begins with exactly the next expected integer
 *    (and the character after it is not another digit), so a Bekker number or
 *    a running header is never mistaken for a marker.
 *  - Running headers/footers are skipped via the shared boilerplate signal, so
 *    a page-number-plus-author running head ("4 Thomas C. Brickhouse") whose
 *    leading number happens to equal the expected footnote is never matched.
 *  - A footnote's continuation is confined to its own page: page-bottom
 *    footnotes do not flow onto the next page's body, so the current entry is
 *    closed at every page boundary and the next page's top prose (body) is
 *    never swallowed as footnote text.
 *  - A single-gap forward resync: a corrupted superscript marker (a real
 *    fixture rendered footnote 10's "10" as `"W?`) would otherwise halt the
 *    sequence and merge every later footnote into the last clean entry. When
 *    the scan is already inside a page's footnote region (an entry is open) and
 *    the next line begins with exactly `expected + 1`, it skips the one
 *    unreadable marker and resumes. It fires ONLY forward, ONLY by one, and
 *    ONLY mid-region, so a Bekker continuation line ("3.10.433b5-8.") — whose
 *    leading number is not `expected + 1` — never triggers it.
 *  - `MIN_ENTRIES_TO_TRUST`: a short or non-sequential match is treated as "not
 *    a real footnote series" and recovers nothing.
 */

import { collectBoilerplateLines, normalizeBoilerplateCandidate } from "./boilerplate";

export interface RecoveredFootnote {
  /** 0-based page index where the entry's numbered line begins. */
  pageIndex: number;
  marker: string;
  text: string;
}

const MIN_ENTRIES_TO_TRUST = 3;
const MAX_ENTRIES = 500;

/**
 * If `line` begins with exactly the integer `expected` (not a longer number),
 * return the note text after the marker; otherwise null. The number may be
 * glued directly to the text ("4JVE7.4…", a lost superscript) or separated by
 * a space/punctuation ("5 NE 7.1…") — both are real footnote-start shapes in
 * scanned text. Anchoring to the SPECIFIC next-expected integer is what keeps
 * this immune to unrelated numbers: a scan expecting 4 never matches "15".
 */
export function matchFootnoteMarker(line: string, expected: number): string | null {
  const s = String(expected);
  if (!line.startsWith(s)) return null;
  const rest = line.slice(s.length);
  if (/^\d/.test(rest)) return null; // a longer number, not marker `expected`
  if (/^\.\d/.test(rest)) return null; // a decimal (Bekker/section number "3.10", "9.4"), not a marker
  const text = rest.replace(/^[.):\]]?\s*/, "").trim();
  return text;
}

/**
 * Scan a document's per-page text layer for page-bottom numbered footnotes
 * GROBID's structural pass missed, returning only entries whose marker number
 * is not already in `structuredMarkers`.
 */
export function recoverPageBottomFootnotes(params: {
  pageTexts: readonly string[];
  structuredMarkers: ReadonlySet<number>;
}): RecoveredFootnote[] {
  const { pageTexts, structuredMarkers } = params;
  if (pageTexts.length === 0) return [];

  const boilerplate = collectBoilerplateLines(pageTexts);
  const entries: { marker: number; pageIndex: number; parts: string[] }[] = [];
  let expected = 1;

  for (let p = 0; p < pageTexts.length; p += 1) {
    let current: { marker: number; pageIndex: number; parts: string[] } | null = null;
    for (const rawLine of pageTexts[p].split("\n")) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (boilerplate.has(normalizeBoilerplateCandidate(trimmed))) continue;

      const matched = matchFootnoteMarker(trimmed, expected);
      if (matched !== null) {
        if (current) entries.push(current);
        current = { marker: expected, pageIndex: p, parts: matched ? [matched] : [] };
        expected += 1;
        continue;
      }
      // Single-gap forward resync over one unreadable marker (see doc comment).
      if (current) {
        const skipped = matchFootnoteMarker(trimmed, expected + 1);
        if (skipped !== null) {
          entries.push(current);
          current = { marker: expected + 1, pageIndex: p, parts: skipped ? [skipped] : [] };
          expected += 2;
          continue;
        }
      }
      if (current) current.parts.push(trimmed);
    }
    // Page-bottom footnotes do not continue onto the next page's body.
    if (current) entries.push(current);
    if (entries.length >= MAX_ENTRIES) break;
  }

  if (entries.length < MIN_ENTRIES_TO_TRUST) return [];

  return entries
    .filter((entry) => !structuredMarkers.has(entry.marker))
    .map((entry) => ({
      pageIndex: entry.pageIndex,
      marker: String(entry.marker),
      text: entry.parts.join(" ").replace(/\s+/g, " ").trim(),
    }))
    .filter((entry) => entry.text.length > 0);
}
