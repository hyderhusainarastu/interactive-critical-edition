import { bestTitleMatch, type BibliographicSource, type ResolvedRecord } from "./types";

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
}

// Same D-20-81 rationale as Crossref's CANDIDATE_ROWS.
const CANDIDATE_ROWS = 5;

// D-20-81 follow-up, live-verified against the real Open Library API
// (2026-07-23, no key needed — it's keyless): its own `/search.json` `q`
// full-text search reliably returns ZERO docs when a bare trailing year is
// combined with an author name — e.g. "Bostock, David, Aristotle's Ethics
// 2000" → 0 results, but the identical query with the year dropped →
// resolves the correct record as a top hit. Reproduced live for all three
// of D-20-81's book-form misses this source is meant to fix (Bostock,
// Bywater, Liddell & Scott). Every citation query already ends with a bare
// collapsed year (`@ice/ingestion`'s `cleanQuery`), so left unfixed this
// source would still return nothing for exactly the queries the D-20-81
// reordering routes to it first. Stripped ONLY from the outbound search
// param below — `bestTitleMatch` still scores candidates against the
// citation's own full, unmodified `query`, so the guard is unaffected.
const TRAILING_YEAR = /\s+(1[5-9]\d{2}|20[0-2]\d)\.?\s*$/;

function stripTrailingYearForSearch(query: string): string {
  const stripped = query.replace(TRAILING_YEAR, "").trim();
  return stripped.length >= 6 ? stripped : query;
}

/**
 * Open Library (plan §6): book metadata + public-domain full-text links,
 * keyless. Best for monographs/older books that Crossref (article/DOI
 * centric) misses. Queried first for book-form citations, after
 * Crossref/OpenAlex otherwise — see `classifyCitationForm` in `resolveCitation`.
 */
export class OpenLibrarySource implements BibliographicSource {
  readonly name = "openlibrary" as const;

  async search(query: string, signal?: AbortSignal): Promise<ResolvedRecord | null> {
    const params = new URLSearchParams({ q: stripTrailingYearForSearch(query), limit: String(CANDIDATE_ROWS) });
    const res = await fetch(`https://openlibrary.org/search.json?${params}`, { signal });
    if (!res.ok) return null;

    const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
    const items = data.docs ?? [];
    const doc = bestTitleMatch(query, items, (d) => d.title);
    if (!doc) return null;

    return {
      source: this.name,
      externalId: doc.key ?? null,
      title: doc.title!,
      authors: doc.author_name?.join(", ") || null,
      year: doc.first_publish_year ?? null,
      doi: null,
      url: doc.key ? `https://openlibrary.org${doc.key}` : null,
      accessStatus: "metadata_only",
      raw: doc,
    };
  }
}
