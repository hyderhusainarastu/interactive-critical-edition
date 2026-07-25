/**
 * Classical-citation recognizer (Bekker/Stephanus loci) — closes a real
 * production defect: a footnote/endnote segment that cites Aristotle by
 * Bekker number (never a proper reference-list entry, since Aristotle's
 * works predate anything a catalogue lookup could resolve) fell through
 * `extractCitationMentions`'s low-confidence fallback in
 * `citations.ts` and was persisted as a junk Library row —
 * "Needs bibliographic resolution — Af?;7.8.1151a20-8." — because the
 * fallback's only bar is `query.length >= 8`, which any locus-heavy
 * fragment clears trivially.
 *
 * The locus (the Bekker/Stephanus number itself) is the PRIMARY signal
 * here, not the abbreviation that conventionally precedes it. The real
 * fixture this module was built against demonstrates why: PDF text
 * extraction turned the abbreviation "NE" (or a similar short form) into
 * mojibake — "Af?;" — while the numeric locus "7.8.1151a20-8." survived
 * intact. An abbreviation table alone would have missed this citation
 * completely; a locus-first design with a curated page-range table still
 * recognizes it as Aristotle's Nicomachean Ethics purely from the number.
 *
 * Two recognition paths:
 *   - "Full form": an abbreviation (NE, Pol., Rep., ...) appears anywhere
 *     in the segment alongside a locus-shaped number. The abbreviation is
 *     authoritative — no range check needed, and this is the ONLY path
 *     that ever recognizes a Stephanus (Platonic) locus, since Stephanus
 *     page numbers overlap the same numeric space Bekker numbers use and
 *     are never distinguishable from a bare number alone.
 *   - "Standalone": no abbreviation is present (the mojibake case), but a
 *     Bekker-shaped locus sits at the very end of the segment ("line
 *     suffix" — real note-style citations end on their own locus, not
 *     mid-sentence) and its page number falls inside exactly ONE curated
 *     `BEKKER_WORK_RANGES` entry. A page landing on a work-boundary
 *     (Nicomachean Ethics/Magna Moralia both claim page 1181) is
 *     deliberately left unresolved rather than guessed — this project's
 *     standing anti-hallucination rule (plan §11/§12) applies here just
 *     as it does to every other resolution path.
 *
 * A "modern-work veto" guards both paths: a quoted title or a
 * modern-looking year (1500-2029) anywhere in the segment means this is
 * actually a secondary-source citation that happens to mention a locus —
 * e.g. an article titled "A Note on Bekker 1106a14" — never a primary
 * citation of the ancient text itself.
 */

export type ClassicalAuthor = "aristotle" | "plato";

export interface ClassicalReferenceMatch {
  author: ClassicalAuthor;
  /** Canonical English title, e.g. "Nicomachean Ethics". */
  work: string;
  /** "Aristotle, Nicomachean Ethics" — the Library title/query string. */
  query: string;
  /** The verbatim locus text matched (e.g. "1151a20-8"), for display. */
  locus: string;
}

export interface BekkerWorkRange {
  work: string;
  /** Bekker page bounds, inclusive. Approximate to the traditional 1831
   *  edition's page boundaries — precise enough to route a citation to the
   *  right work, not a scholarly critical apparatus. Deliberately left
   *  overlapping at a few genuine boundary pages (see the Nicomachean
   *  Ethics/Magna Moralia pair at 1181) rather than picking an arbitrary
   *  split; `recognizeClassicalReference` treats an overlap as ambiguous
   *  and refuses to guess. */
  startPage: number;
  endPage: number;
}

/** Curated Aristotle corpus, Categories (1a) through Poetics (1462b), in
 *  the traditional Bekker page order. Not every minor work is included —
 *  curated for the works this project's own fixtures and citations
 *  actually reference, not an exhaustive corpus edition. */
export const BEKKER_WORK_RANGES: readonly BekkerWorkRange[] = [
  { work: "Categories", startPage: 1, endPage: 15 },
  { work: "On Interpretation", startPage: 16, endPage: 24 },
  { work: "Prior Analytics", startPage: 24, endPage: 70 },
  { work: "Posterior Analytics", startPage: 71, endPage: 100 },
  { work: "Topics", startPage: 100, endPage: 164 },
  { work: "On Sophistical Refutations", startPage: 164, endPage: 184 },
  { work: "Physics", startPage: 184, endPage: 267 },
  { work: "On the Heavens", startPage: 268, endPage: 313 },
  { work: "On Generation and Corruption", startPage: 314, endPage: 338 },
  { work: "Meteorology", startPage: 338, endPage: 390 },
  { work: "On the Soul", startPage: 402, endPage: 435 },
  { work: "Parva Naturalia", startPage: 436, endPage: 486 },
  { work: "History of Animals", startPage: 486, endPage: 638 },
  { work: "Parts of Animals", startPage: 639, endPage: 697 },
  { work: "Movement of Animals", startPage: 698, endPage: 704 },
  { work: "Progression of Animals", startPage: 704, endPage: 714 },
  { work: "Generation of Animals", startPage: 715, endPage: 789 },
  { work: "Metaphysics", startPage: 980, endPage: 1093 },
  { work: "Nicomachean Ethics", startPage: 1094, endPage: 1181 },
  // Deliberate overlap with Nicomachean Ethics at page 1181 — the real
  // boundary in the traditional edition. A standalone locus at exactly
  // page 1181 is genuinely ambiguous without a corroborating abbreviation
  // and must stay unresolved (tested explicitly below).
  { work: "Magna Moralia", startPage: 1181, endPage: 1213 },
  { work: "Eudemian Ethics", startPage: 1214, endPage: 1249 },
  { work: "On Virtues and Vices", startPage: 1249, endPage: 1251 },
  { work: "Politics", startPage: 1252, endPage: 1342 },
  { work: "Economics", startPage: 1343, endPage: 1353 },
  { work: "Rhetoric", startPage: 1354, endPage: 1420 },
  { work: "Rhetoric to Alexander", startPage: 1420, endPage: 1447 },
  { work: "Poetics", startPage: 1447, endPage: 1462 },
];

interface AbbreviationEntry {
  /** Leading-\b anchored; deliberately has NO trailing \b for
   *  period-terminated forms ("Pol.") — `\b` cannot detect a boundary
   *  between two non-word characters (the period and the space/comma
   *  that usually follows it), so a trailing \b there would silently
   *  never match. Forms ending in a bare letter (NE, EN, EE, MM) keep a
   *  trailing \b, since a real word boundary exists there. */
  pattern: RegExp;
  author: ClassicalAuthor;
  work: string;
}

// Case-sensitive by design: real Bekker/Stephanus abbreviations are always
// capitalized this way in scholarly prose, and case-insensitive matching
// would risk false positives against ordinary lowercase words (loosening
// "top." or "rep." to match casually, for instance).
const ABBREVIATIONS: readonly AbbreviationEntry[] = [
  { pattern: /\bEth\.\s*Nic\./, author: "aristotle", work: "Nicomachean Ethics" },
  { pattern: /\bNE\b/, author: "aristotle", work: "Nicomachean Ethics" },
  { pattern: /\bEN\b/, author: "aristotle", work: "Nicomachean Ethics" },
  { pattern: /\bEE\b/, author: "aristotle", work: "Eudemian Ethics" },
  { pattern: /\bMM\b/, author: "aristotle", work: "Magna Moralia" },
  { pattern: /\bMet\./, author: "aristotle", work: "Metaphysics" },
  { pattern: /\bPol\./, author: "aristotle", work: "Politics" },
  { pattern: /\bRhet\./, author: "aristotle", work: "Rhetoric" },
  { pattern: /\bDe\s+An\./, author: "aristotle", work: "On the Soul" },
  { pattern: /\bPhys\./, author: "aristotle", work: "Physics" },
  { pattern: /\bTop\./, author: "aristotle", work: "Topics" },
  { pattern: /\bRep\./, author: "plato", work: "Republic" },
  { pattern: /\bGorg\./, author: "plato", work: "Gorgias" },
  { pattern: /\bPhdr\./, author: "plato", work: "Phaedrus" },
];

/** Plain substrings for `isLocusDominated`'s stripping pass — the
 *  regex-escaped source text behind each `ABBREVIATIONS` pattern. Kept as
 *  a separate flat list rather than deriving it from the regexes above so
 *  the stripping pass stays a trivial literal replace, not a second regex
 *  engine pass per token. */
const ABBREVIATION_TOKENS: readonly string[] = [
  "Eth. Nic.", "Eth.Nic.", "NE", "EN", "EE", "MM",
  "Met.", "Pol.", "Rhet.", "De An.", "Phys.", "Top.",
  "Rep.", "Gorg.", "Phdr.",
];

// A locus: a 1-4 digit Bekker/Stephanus page, a letter a-e marking the
// page's column/margin division, and an optional line number or line
// range ("1151a20-8" — the second number is the compressed tens-sharing
// form scholarly convention uses for "lines 20 to 28").
const LOCUS_CORE = String.raw`(\d{1,4})([a-e])(?:[.,]?\s*\d{1,3})?(?:[-–—]\d{1,3})?`;
const LOCUS_ANYWHERE = new RegExp(`\\b${LOCUS_CORE}\\b`);

// Standalone recognition (no corroborating abbreviation) is deliberately
// stricter than full-form: the locus must anchor the END of the segment
// ("line suffix" — a real note-style citation ends on its own locus, distinct
// from an ordinary sentence that happens to contain a number-letter pair
// mid-clause), and the page must be 3-4 digits. Real Bekker citations in
// practice are always in this range (Categories' opening pages in the 1-9
// range are essentially never cited bare, without a work name); requiring
// 3-4 digits here cuts off the false-positive risk of an ordinary sentence
// ending "...continued on page 45a." being mistaken for a citation, without
// weakening the full-form path (which is corroborated by an explicit
// abbreviation and does not need this extra guard).
const STANDALONE_LOCUS = new RegExp(String.raw`\b(\d{3,4})([a-e])(?:[.,]?\s*\d{1,3})?(?:[-–—]\d{1,3})?\.?\s*$`);

// A quoted title is the humanities convention for an article/chapter
// citation (matches `@ice/ingestion`'s own NOTE_QUOTED shape); a
// modern-looking year signals a real publication date. Either one means
// this segment is a secondary-source citation that happens to mention a
// locus, not a primary citation of the ancient text — e.g. an article
// titled "A Note on Bekker 1106a14" published in 2015. The year band
// (1500-2029) never overlaps a real Bekker page number (max ~1462), so
// this never vetoes a genuine locus by accident.
const QUOTED_TITLE_VETO = /["“][^"”]{4,}["”]/;
const MODERN_YEAR_VETO = /\b(1[5-9]\d{2}|20[0-2]\d)\b/;

function hasModernWorkVeto(segment: string): boolean {
  return QUOTED_TITLE_VETO.test(segment) || MODERN_YEAR_VETO.test(segment);
}

function findAbbreviation(segment: string): AbbreviationEntry | null {
  for (const entry of ABBREVIATIONS) {
    if (entry.pattern.test(segment)) return entry;
  }
  return null;
}

function canonicalQuery(author: ClassicalAuthor, work: string): string {
  return `${author === "aristotle" ? "Aristotle" : "Plato"}, ${work}`;
}

/**
 * Recognizes a segment as a classical (Bekker/Stephanus) primary-source
 * citation, or returns null when it isn't one — including when a locus is
 * present but genuinely ambiguous (a work-boundary page with no
 * corroborating abbreviation) or vetoed as a modern secondary source.
 * Never guesses: a null result means the caller's existing fallback (or
 * `isLocusDominated`'s suppression) decides what happens next.
 */
export function recognizeClassicalReference(segment: string): ClassicalReferenceMatch | null {
  const trimmed = segment.trim();
  if (!trimmed || hasModernWorkVeto(trimmed)) return null;

  // Full form: an abbreviation anywhere, corroborated by a locus anywhere
  // (order-independent — "NE, VII.3, 1151a20-8" and "1151a20-8 (NE)" both
  // count). The abbreviation alone decides the work; no range check.
  const abbreviation = findAbbreviation(trimmed);
  if (abbreviation) {
    const locusMatch = LOCUS_ANYWHERE.exec(trimmed);
    if (locusMatch) {
      return {
        author: abbreviation.author,
        work: abbreviation.work,
        query: canonicalQuery(abbreviation.author, abbreviation.work),
        locus: locusMatch[0],
      };
    }
  }

  // Standalone: no abbreviation survived (the mojibake case). Aristotle
  // only — Stephanus (Plato) is never recognizable from a bare number, see
  // the module doc comment.
  const standalone = STANDALONE_LOCUS.exec(trimmed);
  if (standalone) {
    const page = Number(standalone[1]);
    const matches = BEKKER_WORK_RANGES.filter((range) => page >= range.startPage && page <= range.endPage);
    if (matches.length === 1) {
      const work = matches[0].work;
      return {
        author: "aristotle",
        work,
        query: canonicalQuery("aristotle", work),
        locus: standalone[0].replace(/\.$/, "").trim(),
      };
    }
    // 0 matches (page outside any curated range) or >1 (a genuine
    // work-boundary page, e.g. 1181) — both stay unresolved rather than
    // guessed.
  }

  return null;
}

/**
 * True when, after stripping every recognized abbreviation token and every
 * locus-shaped number from the segment, fewer than 8 alphabetic characters
 * remain — i.e. the segment is essentially just locus noise with no real
 * prose content. Used by the extraction gate to suppress a citation
 * candidate ENTIRELY (rather than emitting it as a low-confidence junk
 * fallback) when `recognizeClassicalReference` couldn't identify a
 * specific work but the segment plainly isn't a resolvable citation
 * either — e.g. the real production case "Af?;7.8.1151a20-8." reduces to
 * "Af" (2 alphabetic characters) once the locus is stripped.
 */
export function isLocusDominated(segment: string): boolean {
  let stripped = segment;
  for (const token of ABBREVIATION_TOKENS) {
    stripped = stripped.split(token).join("");
  }
  stripped = stripped.replace(new RegExp(LOCUS_CORE, "gi"), "");
  const alphabetic = stripped.replace(/[^a-zA-Z]/g, "");
  return alphabetic.length < 8;
}
