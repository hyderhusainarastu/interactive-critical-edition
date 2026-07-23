import { bestTitleMatch, type BibliographicSource, type ResolvedRecord } from "./types";

interface GoogleBooksItem {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    infoLink?: string;
  };
}

// Same D-20-81 rationale as the other sources' CANDIDATE_ROWS.
const CANDIDATE_ROWS = 5;

/**
 * Google Books (D-20-81): keyless with a modest quota (an API key raises
 * that quota when `GOOGLE_BOOKS_API_KEY` is set — the same env var
 * `packages/research`'s discovery-side `GoogleBooksAdapter` already reads,
 * not duplicated here to avoid a `@ice/bibliographic` → `@ice/research`
 * dependency, which would invert the existing direction — `@ice/research`
 * already depends on `@ice/bibliographic`, so the reverse would be a cycle).
 * Book-catalog coverage complementary to Open Library: publisher-supplied
 * metadata (ISBN, imprint) for editions/reprints Open Library sometimes
 * lacks — exactly the shape of the Bostock/Bywater/Liddell & Scott misses
 * (register D-20-81). Never queried at all before this fix.
 */
export class GoogleBooksSource implements BibliographicSource {
  readonly name = "googlebooks" as const;

  async search(query: string, signal?: AbortSignal): Promise<ResolvedRecord | null> {
    const params = new URLSearchParams({ q: query, maxResults: String(CANDIDATE_ROWS) });
    if (process.env.GOOGLE_BOOKS_API_KEY) params.set("key", process.env.GOOGLE_BOOKS_API_KEY);

    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?${params}`, { signal });
    if (!res.ok) return null;

    const data = (await res.json()) as { items?: GoogleBooksItem[] };
    const items = data.items ?? [];
    const item = bestTitleMatch(query, items, (it) => it.volumeInfo?.title);
    if (!item) return null;

    const v = item.volumeInfo!;
    const isbn13 = v.industryIdentifiers?.find((i) => i.type === "ISBN_13")?.identifier;
    const isbn10 = v.industryIdentifiers?.find((i) => i.type === "ISBN_10")?.identifier;

    return {
      source: this.name,
      externalId: isbn13 ?? isbn10 ?? null,
      title: v.title!,
      authors: v.authors?.join(", ") || null,
      year: v.publishedDate ? Number(v.publishedDate.slice(0, 4)) || null : null,
      doi: null,
      url: v.infoLink ?? null,
      accessStatus: "metadata_only",
      raw: item,
    };
  }
}
