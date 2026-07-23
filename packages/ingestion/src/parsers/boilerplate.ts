/**
 * Cross-page repeated-line detection, shared by two consumers that both need
 * to recognize running headers/footers (JSTOR-style download stamps, journal
 * running heads) as page furniture rather than prose:
 *
 *  - `endnoteRecovery.ts` skips these lines while scanning a document's raw
 *    text layer for a numbered endnotes list GROBID's structural pass missed
 *    (D-20-89), so a footer line is never folded into a recovered entry's
 *    text.
 *  - `parsers/pdf.ts` strips these same lines from the PDF text-layer
 *    ("structure-limited") body-assembly path before citation extraction ever
 *    sees the merged document text (D-23-8): a JSTOR-style running footer
 *    repeating on every page was observed leaking into body text at page
 *    boundaries and polluting citation extraction.
 *
 * A line qualifies as boilerplate only if a normalized form of it repeats
 * across multiple pages of the SAME document: at least 3 pages, or at least
 * 30% of the document's pages, whichever is the larger (stricter) bound — so
 * a short document still needs a real, document-relative fraction of its
 * pages to repeat a line before it's treated as furniture, and a long
 * document doesn't get a fixed count of 3 pages treated as significant
 * repetition on its own. A line appearing on only one page is NEVER
 * stripped, no matter what it looks like — this is a repetition signal only,
 * never a keyword or publisher-name match.
 */

const MAX_CANDIDATE_LENGTH = 120;
const MIN_REPEAT_PAGES = 3;
const REPEAT_FRACTION = 0.3;

/** How many of a page's own leading/trailing non-blank lines are eligible to
 *  be stripped as page furniture (see `stripBoilerplateLines`) — a JSTOR-style
 *  stamp is commonly two physical lines ("This content downloaded from ...
 *  UTC" then "All use subject to ..."). A repeated line further inside a
 *  page (i.e. actual body prose) is never a candidate no matter how often it
 *  repeats — this is what protects a legitimately repeated short quote from
 *  ever being removed. */
const BOUNDARY_WINDOW = 2;

// A dotted-quad IP address, e.g. the "downloaded from 128.61.7.44" a JSTOR
// stamp embeds. Collapsed to a placeholder before comparison so the same
// stamp with a different reader's IP still normalizes identically.
const IP_PATTERN = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

// A "Weekday, D Month YYYY HH:MM[:SS] [AM/PM|UTC|GMT]"-shaped timestamp, e.g.
// "Mon, 01 Jan 2024 12:00:00 UTC" — the JSTOR download-stamp shape. Matched
// and collapsed as ONE unit (not just its digits), so two stamps that differ
// in weekday and month name, not only in the numbers, still normalize
// identically.
const TIMESTAMP_PATTERN =
  /\b(?:sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?,?\s+\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:utc|gmt|a\.?m\.?|p\.?m\.?)?\b/gi;

/**
 * Collapse a line's volatile per-page/per-download furniture — a timestamp,
 * an IP address, or any other bare digit run (a page number) — into a
 * placeholder before comparing two header/footer candidate lines for
 * equality, so e.g. "downloaded from 10.0.0.1 on Mon, 1 Jan 2001 00:00:00 AM"
 * and "downloaded from 74.12.9.100 on Tue, 2 Feb 2002 01:15:00 PM" are
 * recognized as the same repeating line. Deliberately narrow: only these
 * three shapes are collapsed, nothing else is treated as fuzzy-equal.
 */
export function normalizeBoilerplateCandidate(line: string): string {
  return line
    .trim()
    .replace(TIMESTAMP_PATTERN, "#")
    .replace(IP_PATTERN, "#")
    .replace(/\d+/g, "#")
    .toLowerCase();
}

/**
 * Lines that repeat verbatim (once volatile furniture is normalized away)
 * across several pages of the SAME document are running headers/footers, not
 * prose — a standard, document-agnostic signal, not specific to any one
 * publisher's boilerplate text. Threshold is deliberately a document-relative
 * fraction (not a fixed count) so it scales with document length; a
 * genuinely repeated short prose sentence would need to occur on roughly a
 * third of the whole document's pages to be caught by mistake.
 */
export function collectBoilerplateLines(pageTexts: readonly string[]): Set<string> {
  const counts = new Map<string, number>();
  for (const text of pageTexts) {
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.length > MAX_CANDIDATE_LENGTH) continue;
      const key = normalizeBoilerplateCandidate(line);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(MIN_REPEAT_PAGES, Math.ceil(pageTexts.length * REPEAT_FRACTION));
  const boilerplate = new Set<string>();
  for (const [key, count] of counts) {
    if (count >= threshold) boilerplate.add(key);
  }
  return boilerplate;
}

/**
 * Strip repeated running headers/footers from a document's per-page text
 * (D-23-8): only a page's own first/last `BOUNDARY_WINDOW` non-blank lines
 * are ever candidates for removal, and only when they match a line that
 * repeats across pages per `collectBoilerplateLines` above. Restricting
 * candidates to page boundaries — where a header/footer physically sits — is
 * what protects a legitimately repeated short quote or refrain inside body
 * prose: that text sits in the middle of a page's lines, never at the very
 * top or bottom on every occurrence, so it is never considered, regardless
 * of how often it repeats.
 */
/**
 * True when `text` is ENTIRELY running-header/footer furniture and carries no
 * prose of its own — used to drop a GROBID-mis-segmented footer block (a JSTOR
 * "This content downloaded from … All use subject to …" stamp GROBID emitted as
 * its own `note`) from the citation-extraction source set (D-23-8): unlike the
 * text-layer fallback in `parsers/pdf.ts`, GROBID's own apparatus blocks are
 * never routed through `stripBoilerplateLines`, so the footer survives into
 * citation extraction as a bogus reference query.
 *
 * Deliberately narrow and conservative:
 *  - Matches on a NORMALIZED SUBSTRING (not whole-line), because GROBID
 *    space-joins a two-physical-line footer into one run-on block, which a
 *    line-anchored strip would miss.
 *  - WHOLE-BLOCK only: it returns true only when removing the learned
 *    boilerplate keys leaves nothing but placeholders/whitespace. A block that
 *    carries any real content beyond the footer keeps every character (the
 *    caller drops it or keeps it entire — it is never partially truncated), so
 *    a footer accidentally merged into a genuine citation is never silently
 *    mangled, only a footer-ONLY block is removed.
 *  - Requires at least one learned key to actually be present (`stripped !==
 *    normalized`), so a block of unrelated bare numbers that merely normalizes
 *    to placeholders is NOT dropped on the digit-normalizer alone — the drop is
 *    driven by the cross-page repetition signal, never by shape alone.
 *  - Reuses exactly the same three normalizers and the same repetition-derived
 *    key set as `stripBoilerplateLines`; introduces no new fuzzy matching.
 */
export function isEntirelyBoilerplate(text: string, boilerplateKeys: ReadonlySet<string>): boolean {
  if (boilerplateKeys.size === 0) return false;
  const normalized = normalizeBoilerplateCandidate(text);
  if (!normalized) return false;
  let stripped = normalized;
  for (const key of boilerplateKeys) {
    if (key) stripped = stripped.split(key).join(" ");
  }
  if (stripped === normalized) return false; // no learned boilerplate line present → not furniture
  return stripped.replace(/[#\s]+/g, "").length === 0;
}

export function stripBoilerplateLines(pageTexts: readonly string[]): string[] {
  const boilerplate = collectBoilerplateLines(pageTexts);
  if (boilerplate.size === 0) return pageTexts.slice();

  return pageTexts.map((pageText) => {
    const lines = pageText.split("\n");
    const nonBlankIndexes = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.trim().length > 0)
      .map(({ index }) => index);
    if (nonBlankIndexes.length === 0) return pageText;

    const boundary = new Set<number>([
      ...nonBlankIndexes.slice(0, BOUNDARY_WINDOW),
      ...nonBlankIndexes.slice(-BOUNDARY_WINDOW),
    ]);

    return lines
      .filter((line, index) => {
        if (!boundary.has(index)) return true;
        const trimmed = line.trim();
        if (!trimmed) return true;
        return !boilerplate.has(normalizeBoilerplateCandidate(trimmed));
      })
      .join("\n");
  });
}
