import { CrossrefSource } from "./crossref";
import { OpenAlexSource } from "./openalex";
import { OpenLibrarySource } from "./openlibrary";
import type { BibliographicSource, ResolvedRecord } from "./types";

export * from "./types";
export { CrossrefSource } from "./crossref";
export { OpenAlexSource } from "./openalex";
export { OpenLibrarySource } from "./openlibrary";

/**
 * Resolution order (plan §6): Crossref first (authoritative DOI metadata
 * for articles), then OpenAlex (broad, includes books/older work), then
 * Open Library (book-specific). First confident match wins; a source
 * error is swallowed so one flaky API doesn't sink resolution — we just
 * move to the next source. Returns null if nothing matches, and the
 * caller keeps the citation unresolved rather than guessing (plan §10/§12).
 */
const DEFAULT_SOURCES: BibliographicSource[] = [
  new CrossrefSource(),
  new OpenAlexSource(),
  new OpenLibrarySource(),
];

export async function resolveCitation(
  query: string,
  opts: { sources?: BibliographicSource[]; timeoutMs?: number } = {},
): Promise<ResolvedRecord | null> {
  const sources = opts.sources ?? DEFAULT_SOURCES;
  const cleaned = query.trim();
  if (cleaned.length < 6) return null;

  for (const source of sources) {
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
