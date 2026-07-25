import { isLocusDominated, recognizeClassicalReference, type ClassicalReferenceMatch } from "./classicalReferences";

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
 *
 * Classical (Bekker/Stephanus) citations are a special case, handled by
 * `classicalReferences.ts` and gated in at the two fallback sites below
 * (`extractCitationMentions`'s bibliography branch and its footnote/
 * endnote no-match fallback): a footnote citing Aristotle by locus number
 * alone (no reference-list entry is possible — the text predates any
 * catalogue) previously fell through this file's generic ">= 8 chars"
 * fallback and was persisted as a junk Library row. See that module's doc
 * comment for the full recognition design.
 */

export type CitationKind = "reference" | "inline";
export type CitationSourceType = "bibliography" | "footnote" | "endnote" | "inline";

/** The durable source anchor passed through to citation persistence. */
export interface CitationAnchor {
  textBlockId: string | null;
  pageIndex: number | null;
  blockOrder: number | null;
  marker: string | null;
  startOffset: number | null;
  endOffset: number | null;
}

export interface CitationSourceInput {
  sourceType: CitationSourceType;
  text: string;
  textBlockId?: string | null;
  pageIndex?: number | null;
  blockOrder?: number | null;
  marker?: string | null;
  /** Structural extraction has a stronger evidence basis than PDF fallback. */
  parserConfidence?: number | null;
}

export interface RawCitation {
  /** The verbatim citation text as it appears in the document. */
  text: string;
  /** A normalized query string for bibliographic lookup (numbering,
   *  trailing page ranges, and "ibid."-style noise stripped). */
  query: string;
  kind: CitationKind;
  /** Source form is intentionally independent from resolution. */
  sourceType?: CitationSourceType;
  parserConfidence?: number;
  anchor?: CitationAnchor;
  /** Set only when `recognizeClassicalReference` identified this as a
   *  Bekker/Stephanus primary-source citation (Aristotle/Plato). Consumed
   *  immediately by `createCitationLibraryProjection` at extraction time —
   *  never persisted to the `citation` row itself; `resolveCitationMetadata`
   *  re-derives it later by re-running the recognizer on the stored
   *  `rawText`, so there is no migration and no drift risk between the two. */
  classical?: ClassicalReferenceMatch;
}

const SECTION_HEADING =
  /^\s*(references|bibliography|works\s+cited|works\s+consulted|further\s+reading|notes|endnotes|footnotes)\s*:?\s*$/i;

// A 4-digit year in a plausible range — the strongest single signal a
// line is a citation rather than prose or a page number.
const YEAR = /\b(1[0-9]{3}|20[0-2][0-9])\b/;

// Inline author–year: "(Kant 1781)", "(Verene 1981, 12)", "Kant (1781)".
const INLINE_PAREN = /\(([A-Z][A-Za-z.'-]+(?:\s+(?:and|&|et al\.?)\s+[A-Z][A-Za-z.'-]+)?),?\s+((?:1[0-9]{3}|20[0-2][0-9]))[a-z]?(?:,\s*\d+)?\)/g;
const INLINE_NARRATIVE = /\b([A-Z][A-Za-z.'-]+)\s+\((?:1[0-9]{3}|20[0-2][0-9])[a-z]?\)/g;

// Direct citations without an author-year form are common in philosophy prose.
// Keep this deliberately narrow: it catches named canonical works, not every
// title-cased phrase in a reader's body text.
const DIRECT_CLASSICAL_WORK = /\b(Eudemian Ethics|Metaphysics|Nicomachean Ethics|Politics|Rhetoric|Gorgias|Phaedrus)\b/g;

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

/**
 * Conservative footnote/endnote unbundling. Audited directly against a real
 * local GROBID :8070 run over `baseline-test/AristotlesAccountoftheVicious.pdf`
 * (the Roochnik "Vicious Man" fixture): its endnote 2 bundles two independent
 * citations behind connective prose, no semicolon at all — "... does not
 * 'save the phenomena,' see A. Kosman, 'Saving the Phenomena...,' ... pp.
 * 54-72. For arguments closer to my own, see M. Nussbaum, The Fragility of
 * Goodness (Cambridge: Cambridge University Press, 1986)." Left as one block,
 * `extractCitationMentions` either silently drops whichever entry doesn't
 * independently match a known citation shape (whenever its sibling in the
 * same block DOES match — Kosman's own citation is a chapter-in-edited-
 * volume form neither NOTE_QUOTED nor NOTE_BOOK recognizes, a genuine,
 * separate shape gap, not itself a bundling defect) or — when NEITHER
 * matches — falls back to treating the WHOLE block as one unresolvable,
 * multi-author blob. See the call site in `extractCitationMentions` for
 * what splitting first actually buys back.
 *
 * A candidate boundary is only a semicolon or a period, each REQUIRING a
 * citation-introducing cue word ("see", "cf.", "compare", ...) between the
 * boundary punctuation and the next citation-start (a capitalized-name token
 * immediately followed by a comma, matched via `NAME`) — the period
 * alternative additionally tolerates a short (<=60 char) connective clause
 * before the cue, matching this fixture's own real "... pp. 54-72. For
 * arguments closer to my own, see M. Nussbaum, ..." shape. A split is then
 * only COMMITTED when EVERY resulting segment independently looks like a
 * citation per the existing `looksLikeCitation` gate the reference-section
 * parser above already trusts — "when in doubt, do not split".
 *
 * 23.5d repair: the semicolon alternative originally carried NO cue
 * requirement at all (just `;\s*(?:(?:and|or)\s+)?(?=NAME,)`), on the theory
 * that `looksLikeCitation` would catch anything it over-matched. That theory
 * was wrong: an ordinary scholarly-discourse sentence of the shape "Name1,
 * <capitalized appositive>, <prose>; Name2, <clause with a year>, <prose>."
 * satisfies `looksLikeCitation` on BOTH sides — a capitalized appositive
 * satisfies the Surname-comma-Capital shape, and a year anywhere in the
 * second clause satisfies the year check — even though neither side is a
 * citation at all. The gate is real but was never narrow enough to
 * compensate for a boundary regex with no cue discipline of its own.
 * Requiring the SAME cue-after-boundary discipline on the semicolon path
 * that the period path already enforced closes this at the boundary itself,
 * before the gate is ever consulted: a semicolon is only a candidate
 * boundary when a "see"/"cf."/"compare"/... cue immediately follows it (an
 * optional leading "and"/"or" is still tolerated). The accepted trade-off
 * (see the adversarial tests below): a semicolon-joined citation list whose
 * later entries carry no cue of their own — relying only on a single
 * leading cue at the very start of the whole note — no longer splits past
 * the first boundary. That is the conservative direction ("when in doubt,
 * do not split"), not a regression; a genuinely cue-bearing pair ("see X;
 * compare Y") still splits exactly as before.
 *
 * Requiring every segment to independently qualify (not just the two
 * nearest the boundary) is what keeps a genuinely incomplete fragment — this
 * fixture's own real, truncated Nussbaum clause, missing its own year
 * entirely — from being confidently split out of a real cue-bearing
 * boundary. A wrong split silently manufactures two bad lookup queries out
 * of one real one, which is worse than leaving a hard-to-parse block
 * unsplit.
 */
const CITATION_CUE = String.raw`(?:[Ss]ee\s+also|[Ss]ee|[Cc]f\.?|[Cc]ompare|[Cc]ontrast|[Cc]ited\s+in|[Qq]uoted\s+in|[Ff]ollowing)`;
const SPLIT_BOUNDARY = new RegExp(
  String.raw`;\s*(?:(?:and|or)\s+)?${CITATION_CUE}\s+(?=${NAME},)` +
    "|" +
    String.raw`\.\s+(?:[A-Z][^.;]{0,60}?\s+)?${CITATION_CUE}\s+(?=${NAME},)`,
  "g",
);

/**
 * Splits a single footnote/endnote block into independent citation entries,
 * but ONLY at a high-confidence boundary (see doc comment above), and only
 * when every resulting segment independently looks like a citation. Returns
 * the original (whitespace-flattened) text as a single-element array
 * whenever no boundary is found, or whenever committing to a detected
 * boundary would produce even one segment that doesn't itself look like a
 * citation.
 */
export function splitNoteEntries(text: string): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [flat];

  const matches = [...flat.matchAll(SPLIT_BOUNDARY)];
  if (matches.length === 0) return [flat];

  const segments: string[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.index === undefined) continue;
    segments.push(flat.slice(cursor, m.index).trim());
    cursor = m.index + m[0].length;
  }
  segments.push(flat.slice(cursor).trim());

  const allValid = segments.length > 1 && segments.every((segment) => looksLikeCitation(segment));
  return allValid ? segments : [flat];
}

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

function defaultConfidence(sourceType: CitationSourceType): number {
  switch (sourceType) {
    case "bibliography": return 0.98;
    case "footnote": return 0.92;
    case "endnote": return 0.9;
    case "inline": return 0.74;
  }
}

function kindForSource(sourceType: CitationSourceType): CitationKind {
  return sourceType === "inline" ? "inline" : "reference";
}

function anchorFor(source: CitationSourceInput, raw: string): CitationAnchor {
  const startOffset = source.text.indexOf(raw);
  return {
    textBlockId: source.textBlockId ?? null,
    pageIndex: source.pageIndex ?? null,
    blockOrder: source.blockOrder ?? null,
    marker: source.marker ?? null,
    startOffset: startOffset >= 0 ? startOffset : null,
    endOffset: startOffset >= 0 ? startOffset + raw.length : null,
  };
}

/**
 * Extract citation *mentions* from independently anchored structural sources.
 * The older `extractCitations` API remains the discovery-friendly de-duplicated
 * query list; this API preserves one result per source block/occurrence so a
 * bibliography entry, footnote, endnote, or direct body citation can be
 * persisted and shown with its own provenance.
 */
export function extractCitationMentions(
  sources: readonly CitationSourceInput[],
  max = 300,
): RawCitation[] {
  const mentions: RawCitation[] = [];

  const add = (source: CitationSourceInput, candidate: RawCitation) => {
    if (mentions.length >= max || candidate.query.trim().length < 3) return;
    mentions.push({
      ...candidate,
      kind: kindForSource(source.sourceType),
      sourceType: source.sourceType,
      parserConfidence: source.parserConfidence ?? defaultConfidence(source.sourceType),
      anchor: anchorFor(source, candidate.text),
    });
  };

  for (const source of sources) {
    if (mentions.length >= max || !source.text.trim()) continue;
    // Apparatus extraction has already separated bibliography entries into
    // individually anchored blocks. Preserve one exact entry here instead of
    // letting an author-year heuristic reinterpret words inside its title as
    // additional inline citations (for example, Bywater's title contains
    // "Nicomachean Ethics"). Foot/endnotes can contain several citations, so
    // they still use the reference parser below.
    if (source.sourceType === "bibliography") {
      const classical = recognizeClassicalReference(source.text);
      if (classical) {
        add(source, { text: source.text.trim(), query: classical.query, kind: "reference", classical });
      } else if (!isLocusDominated(source.text)) {
        const query = cleanQuery(source.text);
        if (query.length >= 3) add(source, { text: source.text.trim(), query, kind: "reference" });
      }
      // else: locus-dominated (junk that stripped to almost no prose, e.g. a
      // corrupted Bekker citation) but no specific work could be identified —
      // suppressed entirely rather than kept as an unresolvable junk row.
      continue;
    }

    if (source.sourceType === "footnote" || source.sourceType === "endnote") {
      // Split a bundled note into independent entries FIRST (see
      // `splitNoteEntries`'s doc comment for the exact fixture this fixes and
      // the guards against a wrong split), then run the same regex-pass +
      // low-confidence-fallback logic per entry that a single-citation block
      // already got, scoped to that entry's own text, not the whole
      // (possibly multi-citation) block, so one entry's fallback text never
      // absorbs a sibling entry's.
      const segments = splitNoteEntries(source.text);
      for (const segment of segments) {
        if (mentions.length >= max) break;
        const rawCandidates = extractCitations(segment, Math.max(1, max - mentions.length));
        const segmentCandidates = rawCandidates.filter((candidate) => candidate.kind === "reference");
        const seen = new Set<string>();
        for (const candidate of segmentCandidates) {
          const key = `${candidate.text}\u0000${candidate.query}`;
          if (seen.has(key)) continue;
          seen.add(key);
          add(source, candidate);
        }

        // A structural footnote/endnote entry is itself evidence even when it
        // lacks a four-digit year or uses a catalog style the generic
        // heuristic does not recognize. Never manufacture metadata: preserve
        // it verbatim as a low-confidence lookup candidate instead — UNLESS
        // it's recognizably a classical (Bekker/Stephanus) locus citation
        // (routed to the canonical Aristotle/Plato Library entry instead of
        // a junk fallback row), or it's locus-dominated junk with no real
        // prose content and no identifiable work (suppressed entirely; the
        // real production case this closes: "Needs bibliographic resolution
        // — Af?;7.8.1151a20-8.", a corrupted abbreviation plus a Bekker
        // number that used to clear the ">= 8 chars" bar below trivially).
        if (segmentCandidates.length === 0) {
          const classical = recognizeClassicalReference(segment);
          if (classical) {
            add(source, { text: segment.trim(), query: classical.query, kind: "reference", classical });
          } else if (!isLocusDominated(segment)) {
            const query = cleanQuery(segment);
            if (query.length >= 8) add(source, { text: segment.trim(), query, kind: "reference" });
          }
        }
      }
      continue;
    }

    const rawCandidates = extractCitations(source.text, Math.max(1, max - mentions.length));
    const candidates = source.sourceType === "inline"
      ? rawCandidates.filter((candidate) => candidate.kind === "inline")
      : rawCandidates.filter((candidate) => candidate.kind === "reference");
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const key = `${candidate.text}\u0000${candidate.query}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(source, candidate);
    }

    if (source.sourceType === "inline") {
      DIRECT_CLASSICAL_WORK.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = DIRECT_CLASSICAL_WORK.exec(source.text)) && mentions.length < max) {
        const title = match[1];
        // Include Aristotle/Plato when it appears in the immediate local
        // context, while keeping the query honest when the author is omitted.
        const before = source.text.slice(Math.max(0, match.index - 24), match.index);
        const author = /Aristotle(?:['’]s)?\s*$/i.test(before)
          ? "Aristotle, "
          : /Plato(?:['’]s)?\s*$/i.test(before)
            ? "Plato, "
            : "";
        const text = `${author}${title}`;
        if (mentions.some((mention) => mention.sourceType === "inline" && mention.anchor?.textBlockId === (source.textBlockId ?? null) && mention.query === text)) continue;
        add(source, { text, query: text, kind: "inline" });
      }
    }
  }

  return mentions;
}
