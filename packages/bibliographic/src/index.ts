import { CrossrefSource } from "./crossref";
import { GoogleBooksSource } from "./googlebooks";
import { OpenAlexSource } from "./openalex";
import { OpenLibrarySource } from "./openlibrary";
import { classifyCitationForm, type BibliographicSource, type BibSourceName, type ResolvedRecord } from "./types";

export * from "./types";
export { CrossrefSource } from "./crossref";
export { GoogleBooksSource } from "./googlebooks";
export { OpenAlexSource } from "./openalex";
export { OpenLibrarySource } from "./openlibrary";

/**
 * Default resolution order (plan §6) for a citation whose form can't be
 * determined (`classifyCitationForm` → "unknown"): Crossref first
 * (authoritative DOI metadata for articles), then OpenAlex (broad,
 * includes books/older work), then Open Library, then Google Books.
 */
const DEFAULT_ORDER: BibSourceName[] = ["crossref", "openalex", "openlibrary", "googlebooks"];

/**
 * D-20-81: book-form citations (a monograph, a critical text edition, a
 * lexicon) resolve far better against book catalogues than against
 * Crossref/OpenAlex, which are article/DOI-centric and thin for exactly
 * this kind of work (pre-DOI-era Oxford monographs, 19th-century reference
 * works). Book catalogues go first — never dropped, just reordered.
 */
const BOOK_ORDER: BibSourceName[] = ["openlibrary", "googlebooks", "openalex", "crossref"];

/** Journal-form citations keep today's Crossref-first order unchanged. */
const JOURNAL_ORDER: BibSourceName[] = ["crossref", "openalex", "openlibrary", "googlebooks"];

const DEFAULT_SOURCES: BibliographicSource[] = [
  new CrossrefSource(),
  new OpenAlexSource(),
  new OpenLibrarySource(),
  new GoogleBooksSource(),
];

function orderSources(query: string, sources: BibliographicSource[]): BibliographicSource[] {
  const form = classifyCitationForm(query);
  const priority = form === "book" ? BOOK_ORDER : form === "journal" ? JOURNAL_ORDER : DEFAULT_ORDER;
  return [...sources].sort((a, b) => priority.indexOf(a.name) - priority.indexOf(b.name));
}

export async function resolveCitation(
  query: string,
  opts: { sources?: BibliographicSource[]; timeoutMs?: number; rawText?: string } = {},
): Promise<ResolvedRecord | null> {
  const sources = opts.sources ?? DEFAULT_SOURCES;
  const cleaned = query.trim();
  if (cleaned.length < 6) return null;

  // D-20-81: reorder (never drop) providers per citation, book catalogues
  // first for book-form citations, Crossref first otherwise. First
  // confident match still wins; a source error is swallowed so one flaky
  // API doesn't sink resolution — we just move to the next source. Returns
  // null if nothing matches, and the caller keeps the citation unresolved
  // rather than guessing (plan §10/§12).
  //
  // Classification reads `rawText` when the caller supplies it, falling
  // back to `cleaned` otherwise. This matters: `cleanQuery` upstream in
  // `@ice/ingestion` deliberately collapses a footnote-style citation's
  // publisher parenthetical down to just its year (its own comment:
  // "publisher tokens swamp the title" for matching), so the book-form
  // signal (Press/Clarendon/Lexicon/…) often only survives in the
  // citation's verbatim raw text, not in the cleaned lookup query itself.
  // The actual provider calls below still always use `cleaned` — only
  // classification looks at `rawText`.
  const classificationText = opts.rawText ?? cleaned;
  for (const source of orderSources(classificationText, sources)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
    try {
      const record = await source.search(cleaned, controller.signal);
      if (record) return record;
    } catch (err) {
      console.error(`[bibliographic] ${source.name} lookup failed:`, err instanceof Error ? err.message : err);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
