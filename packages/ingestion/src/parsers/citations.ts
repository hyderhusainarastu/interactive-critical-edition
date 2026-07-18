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

function cleanQuery(entry: string): string {
  return entry
    .replace(/^\s*\[?\(?\d{1,3}\)?[.):\]]\s*/, "") // leading "1." / "[1]" / "(1)"
    .replace(/^\s*[-•*–—]\s*/, "") // leading bullet
    .replace(/\bpp?\.\s*\d+(?:[-–]\d+)?\.?\s*$/i, "") // trailing "p. 12" / "pp. 12-15"
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

  // --- Inline author–year mentions from the body (before the heading) ---
  const body = headingIdx === -1 ? text : lines.slice(0, headingIdx).join("\n");
  for (const re of [INLINE_PAREN, INLINE_NARRATIVE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) && out.length < max) {
      const full = m[0].replace(/^\(|\)$/g, "").trim();
      add(full, cleanQuery(full), "inline");
    }
  }

  return out.slice(0, max);
}
