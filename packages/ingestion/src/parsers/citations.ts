/**
 * Heuristic citation extraction (plan §10 step 6) — the cheap first
 * stage of the two-stage analysis pipeline. Pattern matching, not a
 * parser: it finds a trailing references/bibliography/notes section and
 * splits it into candidate citation entries, plus catches inline
 * author–year citations in the body. Each raw citation is kept verbatim
 * (with a cleaned query string for lookup) and resolved separately
 * against real bibliographic sources — no bibliographic fact is ever
 * invented here (plan §12).
 *
 * Documented limitation (mirrors footnotes.ts): this won't catch every
 * citation style, and doesn't attempt PDF layout analysis. Irregular
 * styles are where the plan's optional LLM-assisted extraction would
 * help later; the regex pass is the always-on, zero-cost baseline.
 */

export type CitationKind = "reference" | "inline";

export interface RawCitation {
  /** The verbatim citation text as it appears in the document. */
  text: string;
  /** A normalized query string for bibliographic lookup (numbering,
   *  trailing page ranges, and "ibid."-style noise stripped). */
  query: string;
  kind: CitationKind;
}

const SECTION_HEADING =
  /^\s*(references|bibliography|works\s+cited|works\s+consulted|further\s+reading|notes|endnotes|footnotes)\s*:?\s*$/i;

// A 4-digit year in a plausible range — the strongest single signal a
// line is a citation rather than prose or a page number.
const YEAR = /\b(1[0-9]{3}|20[0-2][0-9])\b/;

// Inline author–year: "(Kant 1781)", "(Verene 1981, 12)", "Kant (1781)".
const INLINE_PAREN = /\(([A-Z][A-Za-z.'-]+(?:\s+(?:and|&|et al\.?)\s+[A-Z][A-Za-z.'-]+)?),?\s+((?:1[0-9]{3}|20[0-2][0-9]))[a-z]?(?:,\s*\d+)?\)/g;
const INLINE_NARRATIVE = /\b([A-Z][A-Za-z.'-]+)\s+\((?:1[0-9]{3}|20[0-2][0-9])[a-z]?\)/g;

/**
 * Note-style citations — the humanities convention, where full references live
 * in footnotes and there is no reference list at all.
 *
 * This is not a stylistic nicety: measured on a real production run over a
 * 2001 philosophy article, the reference-section and author–year passes above
 * extracted ZERO citations, because the paper cites entirely in numbered
 * footnotes. GROBID could not help either — it recovered 4 notes of roughly
 * forty and no bibliography, since there is no bibliography to find. Without
 * these two patterns the pipeline cannot see a single work such a paper cites.
 *
 * Journal form:  Julia Annas, "Plato and Aristotle on Friendship," Mind 86 (1977)
 * Book form:     Sarah Broadie, Ethics with Aristotle (Oxford: OUP, 1991)
 */
const NAME = String.raw`[A-Z][A-Za-z.'’-]+(?:\s+[A-Z][A-Za-z.'’-]+){0,3}`;
const YEAR_IN = String.raw`1[89]\d\d|20[0-2]\d`;
const NOTE_QUOTED = new RegExp(
  String.raw`(${NAME}),\s*["“]([^"”]{8,200}?)[,.]?["”][^.]{0,160}?\((?:${YEAR_IN})\)`,
  "g",
);
const NOTE_BOOK = new RegExp(
  String.raw`(${NAME}),\s+([A-Z][^()\n]{6,120}?)\s*\([^)\n]{0,80}?(?:${YEAR_IN})[^)\n]{0,20}\)`,
  "g",
);

/** Signal words that introduce a note citation but are not part of the author's
 *  name ("See W.F.R. Hardie…", "Cf. Broadie…"). */
const LEADING_CUE = /^(?:see\s+also|see|cf\.?|compare|contrast|e\.g\.?,?|cited\s+in|quoted\s+in|following|so\s+also)\s+/i;

function cleanQuery(entry: string): string {
  return entry
    .replace(/^\s*\[?\(?\d{1,3}\)?[.):\]]\s*/, "") // leading "1." / "[1]" / "(1)"
    .replace(/^\s*[-•*–—]\s*/, "") // leading bullet
    .replace(LEADING_CUE, "") // "See ...", "Cf. ..."
    .replace(/\bpp?\.\s*\d+(?:[-–]\d+)?\.?\s*$/i, "") // trailing "p. 12" / "pp. 12-15"
    // Collapse a publisher parenthetical to just its year. "(Oxford: Oxford
    // University Press, 1991)" is imprint noise that pushes catalogue search
    // away from the work: measured against real note citations, searching the
    // full string found 1 of 9 cited works, since the publisher tokens swamp
    // the title. The year is the part worth keeping.
    .replace(/\(([^()]*?)\b(1[89]\d\d|20[0-2]\d)\b([^()]*?)\)/g, " $2")
    .replace(/\bibid\.?|op\.\s*cit\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeCitation(line: string): boolean {
  const t = line.trim();
  if (t.length < 12) return false;
  // A year, or an author-comma-title shape ("Surname, First, Title.").
  return YEAR.test(t) || /^[A-Z][A-Za-z.'-]+,\s+[A-Z]/.test(t);
}

/**
 * Extracts up to `max` candidate citations. Reference-section entries
 * are preferred (they resolve best); inline author–year mentions are
 * added to fill out the set. De-duplicated by normalized query.
 */
export function extractCitations(text: string, max = 300): RawCitation[] {
  const lines = text.split("\n");
  const out: RawCitation[] = [];
  const seen = new Set<string>();

  const add = (text: string, query: string, kind: CitationKind) => {
    const key = query.toLowerCase();
    if (query.length < 8 || seen.has(key)) return;
    seen.add(key);
    out.push({ text: text.trim(), query, kind });
  };

  // --- Reference-section entries ---
  // Use the LAST matching heading (a doc may say "notes" mid-body; the
  // real reference list is at the end).
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (SECTION_HEADING.test(lines[i])) headingIdx = i;
  }

  if (headingIdx !== -1) {
    // Group the post-heading lines into entries: a blank line ends an
    // entry, and a new entry also starts when a line begins with a
    // citation marker (number/bullet) or a Surname-comma pattern.
    let buffer: string[] = [];
    const flush = () => {
      if (buffer.length === 0) return;
      const joined = buffer.join(" ").trim();
      if (looksLikeCitation(joined)) add(joined, cleanQuery(joined), "reference");
      buffer = [];
    };
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (trimmed === "") {
        flush();
        continue;
      }
      const startsNewEntry =
        /^\s*\[?\(?\d{1,3}\)?[.):\]]\s/.test(raw) ||
        /^\s*[-•*–—]\s/.test(raw) ||
        /^[A-Z][A-Za-z.'-]+,\s+[A-Z]/.test(trimmed);
      if (startsNewEntry && buffer.length > 0) flush();
      buffer.push(trimmed);
      if (out.length >= max) break;
    }
    flush();
  }

  // --- Note-style citations (footnote apparatus, no reference list) ---
  // Run over the WHOLE text, not just the pre-heading body: in note-style
  // documents the citations are scattered through footnotes at page bottoms,
  // which land anywhere in the extracted text.
  //
  // Matched against a whitespace-FLATTENED copy, because a citation routinely
  // wraps across lines and the extracted text preserves those breaks. Measured
  // on a real production document: matching the raw per-page text found 7
  // citations where the same document flattened yields 9 — Broadie and Charles
  // were lost purely to a line break inside the title.
  const flat = text.replace(/\s+/g, " ");
  for (const re of [NOTE_QUOTED, NOTE_BOOK]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) && out.length < max) {
      const full = m[0].replace(/\s+/g, " ").trim();
      add(full, cleanQuery(full), "reference");
    }
  }

  // --- Inline author–year mentions from the body (before the heading) ---
  const body = headingIdx === -1 ? text : lines.slice(0, headingIdx).join("\n");
  for (const re of [INLINE_PAREN, INLINE_NARRATIVE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) && out.length < max) {
      // Unwrap ONLY a fully parenthesised match, "(Kant 1781)" → "Kant 1781".
      // Applying it to the narrative form stripped the closing paren of the
      // year instead: "Ethics (2001)" became the unbalanced "Ethics (2001",
      // which then went out as a search query.
      const raw = m[0].trim();
      const full = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1).trim() : raw;
      add(full, cleanQuery(full), "inline");
    }
  }

  return out.slice(0, max);
}
