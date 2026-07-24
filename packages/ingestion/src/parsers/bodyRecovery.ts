/**
 * Body-coverage recovery: on some scanned journal PDFs GROBID's body-
 * segmentation model skips the article's opening paragraph (and the top of a
 * page that continues it) entirely — it locks onto the header/apparatus region
 * and never emits the drop-cap opening as a `<p>`. Confirmed on a real fixture
 * (Brickhouse, "Does Aristotle Have a Consistent Account of Vice?"): the
 * opening "How ARE WE TO UNDERSTAND THE PSYCHOLOGY OF VICE…" is present in the
 * PDF text layer but absent from every GROBID body block; GROBID's only page-1
 * body block is actually a footnote's text, mis-segmented.
 *
 * This recovers the LEADING body prose of a page — and only when GROBID does
 * not already represent it — from the same text layer `parsePdf` already
 * extracts. It mirrors the D-20-89 endnote-recovery precedent: conservative
 * recall that only ADDS content GROBID's structural output omitted, marked
 * `recovered` so downstream provenance stays honest (0.6 confidence, never
 * presented as layout-aware structure).
 *
 * Precision guards (all deliberate):
 *  - Only a page that ALREADY carries at least one GROBID body block is
 *    eligible: recovery fills a gap in GROBID's coverage of a genuine body
 *    page, it never fabricates body from a page GROBID found no body on at all
 *    (a JSTOR cover / front-matter page, whose "Author(s): … Source: … JSTOR
 *    is a not-for-profit service…" metadata is real English prose a
 *    letter-ratio test cannot distinguish from article text).
 *  - Header/title/author lines and running-header/footer furniture at the top
 *    of the page are skipped, so the recovered block never swallows the title
 *    or a page stamp.
 *  - Collection stops at the first apparatus cue (a numbered footnote marker,
 *    a "Correspondence"/affiliation line, or learned boilerplate), so it never
 *    reaches into the page's footnote region.
 *  - The tail is truncated at the first collected line GROBID ALREADY emitted
 *    ANYWHERE in the document (conservative normalized-substring containment),
 *    so prose GROBID captured "in altered form" — including a block it
 *    mis-attributed to an adjacent page — is never duplicated (the pdf.ts
 *    "structural lie" warning).
 *  - Nothing is recovered unless the surviving prose is substantial and mostly
 *    letters — a page whose top is only garbled apparatus recovers nothing.
 */

const MIN_RECOVERED_CHARS = 120;
const MIN_LINE_MATCH_CHARS = 20;
const SIGNATURE_CHARS = 60;
const MIN_LETTER_RATIO = 0.55;

/** A line that opens the page's apparatus region: a numbered footnote marker
 *  ("1 Unless…", "4JVE7…" — a number not followed by another digit), or a
 *  journal correspondence/affiliation line. */
const APPARATUS_BOUNDARY = /^\d{1,3}(?!\d)|^correspondence\b|^address for correspondence\b/i;

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

/** True for a leading line that is page furniture rather than body prose:
 *  blank, a running header/footer, part of the detected title/author, or an
 *  all-caps line with no lowercase (a title/author/section head). */
function isSkippableHeaderLine(
  line: string,
  titleNorm: string,
  authorNorm: string,
  boilerplateKeys: ReadonlySet<string>,
  normalizeBoilerplate: (line: string) => string,
): boolean {
  if (!line) return true;
  if (boilerplateKeys.has(normalizeBoilerplate(line))) return true;
  const n = normalize(line);
  if (!n) return true;
  if (titleNorm && titleNorm.includes(n)) return true;
  if (authorNorm && authorNorm.includes(n)) return true;
  if (!/[a-z]/.test(line)) return true; // ALL-CAPS header/author line
  return false;
}

export function recoverLeadingBodyProse(params: {
  pageText: string;
  /** GROBID body blocks on THIS page. Recovery is skipped entirely when empty
   *  — a page with no GROBID body is treated as non-body (cover/front-matter),
   *  not a body page with a coverage gap. */
  pageBodyBlockTexts: readonly string[];
  /** GROBID body blocks across the WHOLE document, for dedup: prose GROBID
   *  captured anywhere (even mis-attributed to an adjacent page) must not be
   *  recovered again. */
  allBodyBlockTexts: readonly string[];
  title: string | null;
  author: string | null;
  boilerplateKeys: ReadonlySet<string>;
  normalizeBoilerplate: (line: string) => string;
}): string | null {
  const { pageText, pageBodyBlockTexts, allBodyBlockTexts, title, author, boilerplateKeys, normalizeBoilerplate } = params;
  if (pageBodyBlockTexts.length === 0) return null;
  const titleNorm = title ? normalize(title) : "";
  const authorNorm = author ? normalize(author) : "";
  const bodyNorms = allBodyBlockTexts.map(normalize);

  const rawLines = pageText.split("\n").map((line) => line.trim());

  // Skip the leading header/title/author/furniture region.
  let i = 0;
  while (i < rawLines.length && isSkippableHeaderLine(rawLines[i], titleNorm, authorNorm, boilerplateKeys, normalizeBoilerplate)) i += 1;
  if (i >= rawLines.length) return null;

  // Collect the leading prose run until the apparatus region begins.
  const collected: string[] = [];
  for (; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    if (!line) continue;
    if (boilerplateKeys.has(normalizeBoilerplate(line))) break;
    if (APPARATUS_BOUNDARY.test(line)) break;
    collected.push(line);
  }
  if (collected.length === 0) return null;

  // Truncate at the first collected line GROBID already emitted, so we never
  // duplicate prose GROBID captured (possibly re-hyphenated) elsewhere.
  let cut = collected.length;
  for (let k = 0; k < collected.length; k += 1) {
    const lineNorm = normalize(collected[k]);
    if (lineNorm.length < MIN_LINE_MATCH_CHARS) continue;
    if (bodyNorms.some((body) => body.includes(lineNorm))) { cut = k; break; }
  }
  const kept = collected.slice(0, cut).join(" ").replace(/\s+/g, " ").trim();
  if (kept.length < MIN_RECOVERED_CHARS) return null;

  // The recovered head must be genuinely absent from GROBID's body blocks.
  const headSig = normalize(kept).slice(0, SIGNATURE_CHARS);
  if (bodyNorms.some((body) => body.includes(headSig))) return null;

  // A page whose "top" is really garbled apparatus (mostly non-letters)
  // recovers nothing — precision over recall.
  const letters = (kept.match(/\p{L}/gu) ?? []).length;
  if (letters / kept.length < MIN_LETTER_RATIO) return null;

  return kept;
}
