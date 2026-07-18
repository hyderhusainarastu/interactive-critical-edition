import { titleOverlap, type BibliographicSource, type ResolvedRecord } from "./types";

interface OpenLibraryDoc {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
}

/**
 * Open Library (plan §6): book metadata + public-domain full-text links,
 * keyless. Best for monographs/older books that Crossref (article/DOI
 * centric) misses. Consulted after Crossref/OpenAlex in resolveCitation.
 */
export class OpenLibrarySource implements BibliographicSource {
  readonly name = "openlibrary" as const;

  async search(query: string, signal?: AbortSignal): Promise<ResolvedRecord | null> {
    const params = new URLSearchParams({ q: query, limit: "1" });
    const res = await fetch(`https://openlibrary.org/search.json?${params}`, { signal });
    if (!res.ok) return null;

    const data = (await res.json()) as { docs?: OpenLibraryDoc[] };
    const doc = data.docs?.[0];
    if (!doc?.title) return null;

    if (titleOverlap(query, doc.title) < 0.34) return null;

    return {
      source: this.name,
      externalId: doc.key ?? null,
      title: doc.title,
      authors: doc.author_name?.join(", ") || null,
      year: doc.first_publish_year ?? null,
      doi: null,
      url: doc.key ? `https://openlibrary.org${doc.key}` : null,
      accessStatus: "metadata_only",
      raw: doc,
    };
  }
}
