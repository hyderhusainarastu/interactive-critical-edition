import type { CitationForm } from "../types";

/**
 * Gold-set schema for `classifyCitationForm` (see `../types.ts`), retrofitting
 * the ScholarLens eval discipline (`docs/architecture/scholarlens-integration-plan.md`,
 * "What ScholarLens improves in *existing* Palimnote (reverse direction)")
 * onto this project's existing bibliographic citation-form classifier.
 *
 * `goldForm` is deliberately restricted to `CitationForm`'s real 4-value
 * vocabulary ("book" | "journal" | "classical" | "unknown") — the exact set
 * `classifyCitationForm` can actually return, and the set that drives real
 * behavior (`packages/bibliographic/src/index.ts`'s provider-ordering
 * branch). The classifier has no fifth "chapter" output value, so a
 * chapter-in-edited-volume citation's `goldForm` records the *provider
 * routing* judgment call this eval makes for that shape (see
 * `citationShape`/`provisional`/`notes` below and `gold/PROVENANCE.md`), not
 * a value the function could ever produce on its own.
 */
export interface GoldCitationFormExample {
  id: string;
  /** The exact string as it would reach `classifyCitationForm` in
   *  production — either a cleaned resolver query or verbatim raw citation
   *  text (see `notes` for which, when it matters). */
  citation: string;
  /** The correct answer this eval scores predictions against. Always one of
   *  `CitationForm`'s four real values — see the module doc comment above
   *  for how a non-4-way real-world shape (e.g. a book chapter) still maps
   *  onto one of these. */
  goldForm: CitationForm;
  /**
   * The citation's real-world bibliographic shape, which is a *finer*
   * vocabulary than `goldForm` and is never scored — purely descriptive, so
   * a reader can see e.g. "this is actually a chapter-in-edited-volume,
   * scored as book-form for provider-routing purposes" without that nuance
   * being lost. Free text by design (new shapes show up in real citations
   * faster than a closed enum could track).
   */
  citationShape: string;
  /** Where this citation string came from — a real fixture already in this
   *  codebase (file:line or a docs/PROJECT-LOG.md/changelog entry) or a
   *  hand-authored construction. Every entry must carry one; never omitted. */
  source: string;
  /** True when the citation string itself was constructed for this eval
   *  rather than transcribed from a real fixture/production case. A
   *  synthetic entry is never presented as an attested real citation —
   *  `source` still explains what real pattern it was built to probe. */
  synthetic?: boolean;
  /**
   * True when `goldForm` reflects a genuine judgment call this eval is
   * making (not a value directly attested by a test/production case) — see
   * the module doc comment. Provisional entries are counted in every metric
   * exactly like any other row (no special-casing), but are flagged here so
   * a future reviewer knows which labels are most worth relitigating.
   */
  provisional?: boolean;
  /** Free-text rationale — required whenever `provisional` is true, and
   *  useful anywhere the "why this label" reasoning isn't obvious from the
   *  citation string alone. */
  notes?: string;
}

const CITATION_FORMS: readonly CitationForm[] = ["book", "journal", "classical", "unknown"];

export function isGoldCitationFormExample(value: unknown): value is GoldCitationFormExample {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.citation !== "string" || v.citation.length === 0) return false;
  if (!CITATION_FORMS.includes(v.goldForm as CitationForm)) return false;
  if (typeof v.citationShape !== "string" || v.citationShape.length === 0) return false;
  if (typeof v.source !== "string" || v.source.length === 0) return false;
  if (v.synthetic !== undefined && typeof v.synthetic !== "boolean") return false;
  if (v.provisional !== undefined && typeof v.provisional !== "boolean") return false;
  if (v.notes !== undefined && typeof v.notes !== "string") return false;
  if (v.provisional === true && (typeof v.notes !== "string" || v.notes.length === 0)) return false;
  return true;
}

/** Parses a gold file's raw JSON text and validates every entry — throws
 *  (rather than silently dropping a malformed row), matching
 *  `@ice/claims`'s `parseGoldJudgeFile` precedent: a gold file that
 *  partially fails to conform is a data-quality bug worth surfacing loudly,
 *  not a quietly-shrunk eval sample. */
export function parseGoldCitationFormFile(raw: string): GoldCitationFormExample[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Gold citation-form file must be a JSON array of GoldCitationFormExample objects.");
  }
  parsed.forEach((item, i) => {
    if (!isGoldCitationFormExample(item)) {
      throw new Error(`Gold citation-form example at index ${i} does not conform to GoldCitationFormExample.`);
    }
  });
  const ids = new Set<string>();
  parsed.forEach((item: GoldCitationFormExample, i: number) => {
    if (ids.has(item.id)) throw new Error(`Duplicate gold citation-form id "${item.id}" at index ${i}.`);
    ids.add(item.id);
  });
  return parsed as GoldCitationFormExample[];
}
