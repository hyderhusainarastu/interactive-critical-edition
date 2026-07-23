/**
 * Bibliographic resolution adapters (plan §11). Every external source
 * sits behind the same `BibliographicSource` interface and normalizes
 * into one `ResolvedRecord` shape, so the pipeline never depends on a
 * specific vendor's JSON. All sources here are free and keyless
 * (OpenAlex/Crossref/Open Library), so this stage works in local dev and
 * CI with no secrets — unlike the AI stage, it isn't stubbed.
 *
 * The anti-hallucination rule (plan §11/§12): a bibliographic fact
 * (title/author/year/DOI) may ONLY come from a real lookup here, never
 * from an LLM. An unmatched citation stays unresolved rather than being
 * guessed.
 */

export type BibSourceName = "crossref" | "openalex" | "openlibrary" | "googlebooks";

export type AccessStatus =
  | "open"
  | "subscription"
  | "metadata_only"
  | "user_uploaded"
  | "unavailable";

export interface ResolvedRecord {
  source: BibSourceName;
  externalId: string | null;
  title: string;
  authors: string | null;
  year: number | null;
  doi: string | null;
  url: string | null;
  accessStatus: AccessStatus;
  raw: unknown;
}

export interface BibliographicSource {
  readonly name: BibSourceName;
  search(query: string, signal?: AbortSignal): Promise<ResolvedRecord | null>;
}

/**
 * Cheap confidence guard against a wrong match: require that a meaningful
 * fraction of the query's significant words appear in the candidate
 * title. Crossref/OpenAlex will always return *something* for a query;
 * this stops us attaching an unrelated record to a citation (which would
 * be a provenance lie). Returns a 0..1 overlap score.
 */
export function titleOverlap(query: string, title: string): number {
  const sig = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );
  const q = sig(query);
  const t = sig(title);
  if (q.size === 0 || t.size === 0) return 0;
  let hits = 0;
  for (const w of q) if (t.has(w)) hits++;
  return hits / q.size;
}

/**
 * D-20-81: a provider's single top-ranked result is fragile for a noisy,
 * full-citation-text query — Crossref's own relevance ranking can put an
 * OCR-garbled or venue-word-dominated query's TRUE match a few rows down
 * rather than first (the "single-hit fragility" the D-20-68 investigation
 * flagged for Crossref's `rows:1`). Scanning a small top-N window and
 * picking the *highest*-overlap candidate that still clears `threshold`
 * finds that runner-up without loosening the guard itself — every
 * candidate, first or fifth, is held to the exact same titleOverlap bar.
 */
export function bestTitleMatch<T>(
  query: string,
  items: readonly T[],
  titleOf: (item: T) => string | undefined | null,
  threshold = 0.34,
): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const item of items) {
    const title = titleOf(item);
    if (!title) continue;
    const score = titleOverlap(query, title);
    // Strictly greater than the running best (not >=) so the first
    // qualifying candidate wins a tie, matching a provider's own ranking
    // rather than silently preferring a later row for no reason.
    if (score >= threshold && score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

export type CitationForm = "book" | "journal" | "unknown";

// A quoted title ("Does Aristotle Have a Consistent Account of Vice?") is
// the humanities convention for an article/chapter-in-a-venue citation —
// exactly the shape `extractCitations`'s NOTE_QUOTED pattern produces
// upstream in `@ice/ingestion`; a bare, unquoted title is the NOTE_BOOK
// convention. Reusing that same distinction here needs no new extraction
// work, just reading the signal that's already in the query text.
const QUOTED_TITLE = /["“][^"”]{4,}["”]/;

// Venue-name words that show up in the surviving query text for a journal
// article (unlike a book's publisher, which `cleanQuery` collapses away —
// see packages/ingestion/src/parsers/citations.ts's parenthetical-collapse
// comment). Deliberately narrow: real venue names, not generic words.
const JOURNAL_MARKERS = /\b(Journal|Review|Quarterly|Mind|Phronesis|Proceedings|Bulletin|Studies)\b/i;

// Publisher/imprint/edition/reference-work words that survive in a book-form
// query even after that same parenthetical-collapse — either because the
// citation was never inside parens to begin with (a structural bibliography
// entry) or because the word itself sits outside the collapsed parenthetical.
const BOOK_MARKERS =
  /\b(Press|Publishers?|Clarendon|Blackwell|Routledge|Reprint|Lexicon|Editio|Greek-English|trans(?:lated|\.)?|\d+(?:st|nd|rd|th)\s+ed\.?)\b/i;

// "Bywater, Ingram, ed., Aristotelis..." — a bare ", ed.," abbreviation
// marking an edited volume/critical edition. Kept as its own check (not
// folded into BOOK_MARKERS's word-boundary alternation) because the
// trailing "." makes a `\b` boundary unreliable right before the comma
// that usually follows it.
const EDITOR_MARKER = /,\s*ed\.,/i;

/**
 * Classifies a citation's normalized query as book-form or journal-form
 * from its own surviving text — no separate structured metadata is
 * available at the `resolveCitation` call site (plan §12; see
 * D-20-81). "unknown" preserves today's default provider order exactly.
 */
export function classifyCitationForm(query: string): CitationForm {
  if (QUOTED_TITLE.test(query) || JOURNAL_MARKERS.test(query)) return "journal";
  if (BOOK_MARKERS.test(query) || EDITOR_MARKER.test(query)) return "book";
  return "unknown";
}
