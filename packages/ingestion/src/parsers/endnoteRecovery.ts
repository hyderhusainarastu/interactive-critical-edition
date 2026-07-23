/**
 * D-20-89: on some documents GROBID's body-segmentation model fails to
 * recognize a numbered endnotes list as back-matter at all (zero
 * `<note place="end">` elements emitted) — instead of losing nothing, it
 * either (a) folds the section heading and its first one or two entries into
 * the tail of the preceding body paragraph, or (b) drops an entire run of
 * entries out of the linearized reading order altogether. Confirmed directly
 * against the Roochnik `baseline-test` fixture (2026-07-23, see
 * `docs/audits/phase-19-product-audit.md` D-20-89): GROBID's own TEI has
 * `place="end"` occurring zero times, and the last body `<p>` reads (in
 * effect) "...illuminating.23 Boston University NOTES 1. ... 2. ... Cambridge
 * 21. It is equally difficult..." — endnotes 3 through 20 are not merely
 * mis-typed, they are entirely absent from GROBID's flowing body/note text.
 * (GROBID's separate citation-parsing pass — which builds `<listBibl>` —
 * independently recovers most of the same entries' *bibliographic* content as
 * `<biblStruct>` "reference" blocks; that pass is unaffected and untouched by
 * this module. This module is about the reader-facing endnote apparatus,
 * which has no other source.)
 *
 * This is a genuine GROBID model-behavior gap on this document's layout, not
 * a request-parameter choice: re-running the same fixture with and without
 * `teiCoordinates` produced byte-identical `place="end"`/`<biblStruct>`
 * counts (0 and 18 respectively in both runs).
 *
 * The remedy implemented here is conservative recall, not "trust GROBID
 * less": it only ever ADDS an endnote entry whose number GROBID's own
 * structural output did not already produce, and it only does that when a
 * sequential (N, N+1, N+2, ...) numbered list is found in the document's own
 * text layer directly under a standalone "NOTES"/"ENDNOTES" heading line —
 * the same text layer `parsePdf` already extracts via unpdf before GROBID
 * ever runs. A short or non-sequential match is treated as "not a real
 * endnotes list" and recovers nothing (`MIN_ENTRIES_TO_TRUST`), matching this
 * project's precision-over-recall, never-guess discipline elsewhere (see
 * `parsers/apparatus.ts`'s own heading/marker fallback, which this
 * complements rather than duplicates — that one operates on already-parsed
 * *structural* blocks; this one operates on the raw text layer for the case
 * where GROBID's structural output has no trace of the section at all).
 */

import { collectBoilerplateLines, normalizeBoilerplateCandidate } from "./boilerplate";

export interface RecoveredEndnote {
  /** 0-based page index where this entry's own numbered line begins. */
  pageIndex: number;
  marker: string;
  text: string;
}

const NOTES_HEADING_LINE = /^\s*(?:end)?notes\s*:?\s*$/i;
const MIN_ENTRIES_TO_TRUST = 3;
const MAX_ENTRIES = 200;

// Cross-page repeated-line (running header/footer) detection now lives in
// `./boilerplate` — extracted so `parsers/pdf.ts`'s body-text path can reuse
// the same signal (D-23-8). See that module's doc comment for the repeat
// threshold and normalization rules; behavior here is unchanged.

/** If `line` begins with exactly "`expected`. " (only that integer — "20. "
 *  never matches when `expected` is 2), returns the remainder after the
 *  marker; otherwise null. Anchoring to the SPECIFIC next-expected integer
 *  (rather than "any leading number") is what keeps this immune to
 *  unrelated numbered text elsewhere on the page, e.g. a running header
 *  like "220 History of Philosophy Quarterly" is never mistaken for entry
 *  "220." because a sequential scan is never expecting 220 to come next. */
function matchExpectedMarker(line: string, expected: number): string | null {
  const prefix = `${expected}.`;
  if (!line.startsWith(prefix)) return null;
  const rest = line.slice(prefix.length);
  if (rest.length > 0 && !/^\s/.test(rest)) return null; // "20." must not match when expecting "2"
  return rest.trim();
}

/**
 * Scan a document's own per-page text layer for a numbered endnotes list
 * GROBID's structural pass missed, and return only the entries whose marker
 * number is not already present in `structuredMarkers`.
 */
export function recoverTruncatedEndnotes(params: {
  pageTexts: readonly string[];
  structuredMarkers: ReadonlySet<number>;
}): RecoveredEndnote[] {
  const { pageTexts, structuredMarkers } = params;
  if (pageTexts.length === 0) return [];

  let headingPage = -1;
  let headingLineIdx = -1;
  for (let p = 0; p < pageTexts.length && headingPage === -1; p++) {
    const lines = pageTexts[p].split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (NOTES_HEADING_LINE.test(lines[i].trim())) {
        headingPage = p;
        headingLineIdx = i;
        break;
      }
    }
  }
  if (headingPage === -1) return [];

  const boilerplate = collectBoilerplateLines(pageTexts);
  const entries: { marker: number; pageIndex: number; parts: string[] }[] = [];
  let expected = 1;
  let current: { marker: number; pageIndex: number; parts: string[] } | null = null;

  for (let p = headingPage; p < pageTexts.length; p++) {
    const lines = pageTexts[p].split("\n");
    const startIdx = p === headingPage ? headingLineIdx + 1 : 0;
    for (let i = startIdx; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (boilerplate.has(normalizeBoilerplateCandidate(trimmed))) continue;

      const matched = matchExpectedMarker(trimmed, expected);
      if (matched !== null) {
        if (current) entries.push(current);
        current = { marker: expected, pageIndex: p, parts: matched ? [matched] : [] };
        expected += 1;
        continue;
      }
      if (current) current.parts.push(trimmed);
    }
    if (entries.length >= MAX_ENTRIES) break;
  }
  if (current) entries.push(current);

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
