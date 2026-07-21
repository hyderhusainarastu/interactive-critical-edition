import { POLITE_EMAIL, providerEnabled } from "../config";
import type { AdapterResult, AdapterSearchOptions, RawResource, SourceAdapter } from "../types";
import { disabledAttempt, fetchJson, reconstructInvertedAbstract, runAttempt, userAgent } from "./base";

/**
 * Keyless scholarly adapters (plan §33). Each returns real metadata only — a
 * bibliographic fact never comes from an LLM. They query ONE representative
 * query (the first, usually the strongest) to stay polite with free APIs; the
 * orchestrator controls how many queries/resources overall.
 */

const first = (queries: string[]) => queries.find((q) => q.trim().length > 3) ?? "";

// ---- Crossref ----
interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string }[];
  issued?: { "date-parts"?: number[][] };
  URL?: string;
  ISBN?: string[];
  type?: string;
  abstract?: string;
  "is-referenced-by-count"?: number;
}

export class CrossrefAdapter implements SourceAdapter {
  readonly provider = "crossref" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      const q = first(queries);
      const params = new URLSearchParams({ "query.bibliographic": q, rows: String(opts.maxResults) });
      if (POLITE_EMAIL) params.set("mailto", POLITE_EMAIL);
      const { ok, status, data, error } = await fetchJson<{ message?: { items?: CrossrefItem[] } }>(
        `https://api.crossref.org/works?${params}`,
        { headers: { "User-Agent": userAgent(POLITE_EMAIL) }, timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      if (!ok) return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429, error };
      const resources: RawResource[] = (data?.message?.items ?? [])
        .filter((it) => it.title?.[0])
        .map((it) => ({
          provider: this.provider,
          resourceType: it.type === "book" || it.type === "monograph" ? ("book" as const) : ("article" as const),
          title: it.title![0],
          authors: (it.author ?? []).map((a) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
          year: it.issued?.["date-parts"]?.[0]?.[0] ?? null,
          url: it.URL ?? (it.DOI ? `https://doi.org/${it.DOI}` : null),
          doi: it.DOI ?? null,
          isbn: it.ISBN?.[0] ?? null,
          snippet: it.abstract ? it.abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600) : null,
          venue: null,
          popularity: it["is-referenced-by-count"] ?? null,
          raw: it,
        }));
      return { resources };
    });
  }
}

// ---- OpenAlex ----
interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { landing_page_url?: string; source?: { display_name?: string } };
  open_access?: { is_oa?: boolean; oa_url?: string };
  best_oa_location?: { landing_page_url?: string; pdf_url?: string; license?: string };
  abstract_inverted_index?: Record<string, number[]>;
  cited_by_count?: number;
  type?: string;
}

export class OpenAlexAdapter implements SourceAdapter {
  readonly provider = "openalex" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      const params = new URLSearchParams({ search: first(queries), per_page: String(opts.maxResults) });
      if (POLITE_EMAIL) params.set("mailto", POLITE_EMAIL);
      const { ok, status, data, error } = await fetchJson<{ results?: OpenAlexWork[] }>(
        `https://api.openalex.org/works?${params}`,
        { headers: { "User-Agent": userAgent(POLITE_EMAIL) }, timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      if (!ok) return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429, error };
      const resources: RawResource[] = (data?.results ?? [])
        .map((w) => ({
          provider: this.provider,
          resourceType: (w.type === "book" || w.type === "monograph" ? "book" : "article") as "book" | "article",
          title: w.title ?? w.display_name ?? "",
          authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
          year: w.publication_year ?? null,
          url: w.best_oa_location?.landing_page_url ?? w.primary_location?.landing_page_url ?? (w.doi ?? null),
          doi: w.doi ?? null,
          isbn: null,
          snippet: reconstructInvertedAbstract(w.abstract_inverted_index),
          venue: w.primary_location?.source?.display_name ?? null,
          popularity: w.cited_by_count ?? null,
          raw: w,
        }))
        .filter((r) => r.title);
      return { resources };
    });
  }
}

// ---- Open Library (books) ----
interface OpenLibraryDoc {
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  isbn?: string[];
  key?: string;
}

export class OpenLibraryAdapter implements SourceAdapter {
  readonly provider = "openlibrary" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      const params = new URLSearchParams({ q: first(queries), limit: String(opts.maxResults) });
      const { ok, status, data, error } = await fetchJson<{ docs?: OpenLibraryDoc[] }>(
        `https://openlibrary.org/search.json?${params}`,
        { headers: { "User-Agent": userAgent(POLITE_EMAIL) }, timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      if (!ok) return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429, error };
      const resources: RawResource[] = (data?.docs ?? [])
        .filter((d) => d.title)
        .map((d) => ({
          provider: this.provider,
          resourceType: "book" as const,
          title: d.title!,
          authors: d.author_name ?? [],
          year: d.first_publish_year ?? null,
          url: d.key ? `https://openlibrary.org${d.key}` : null,
          doi: null,
          isbn: d.isbn?.[0] ?? null,
          snippet: null,
          venue: null,
          popularity: null,
          raw: d,
        }));
      return { resources };
    });
  }
}

// ---- Google Books (keyless with a rate quota) ----
interface GoogleBooksItem {
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    infoLink?: string;
    description?: string;
    ratingsCount?: number;
  };
}

export class GoogleBooksAdapter implements SourceAdapter {
  readonly provider = "googlebooks" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      const params = new URLSearchParams({ q: first(queries), maxResults: String(Math.min(opts.maxResults, 40)) });
      if (process.env.GOOGLE_BOOKS_API_KEY) params.set("key", process.env.GOOGLE_BOOKS_API_KEY);
      const { ok, status, data, error } = await fetchJson<{ items?: GoogleBooksItem[] }>(
        `https://www.googleapis.com/books/v1/volumes?${params}`,
        { timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      if (!ok) return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429, error };
      const resources: RawResource[] = (data?.items ?? [])
        .filter((it) => it.volumeInfo?.title)
        .map((it) => {
          const v = it.volumeInfo!;
          const isbn13 = v.industryIdentifiers?.find((i) => i.type === "ISBN_13")?.identifier;
          const isbn10 = v.industryIdentifiers?.find((i) => i.type === "ISBN_10")?.identifier;
          return {
            provider: this.provider,
            resourceType: "book" as const,
            title: v.title!,
            authors: v.authors ?? [],
            year: v.publishedDate ? Number(v.publishedDate.slice(0, 4)) || null : null,
            url: v.infoLink ?? null,
            doi: null,
            isbn: isbn13 ?? isbn10 ?? null,
            snippet: v.description ? v.description.replace(/\s+/g, " ").trim().slice(0, 600) : null,
            venue: null,
            popularity: v.ratingsCount ?? null,
            raw: it,
          };
        });
      return { resources };
    });
  }
}

// ---- Semantic Scholar (keyless; strict rate limits) ----
interface SemanticScholarPaper {
  paperId?: string;
  title?: string;
  authors?: { name?: string }[];
  year?: number;
  externalIds?: { DOI?: string };
  abstract?: string;
  citationCount?: number;
  url?: string;
  venue?: string;
}

export class SemanticScholarAdapter implements SourceAdapter {
  readonly provider = "semanticscholar" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      const params = new URLSearchParams({
        query: first(queries),
        limit: String(Math.min(opts.maxResults, 20)),
        fields: "title,authors,year,externalIds,abstract,citationCount,url,venue",
      });
      const headers: Record<string, string> = { "User-Agent": userAgent(POLITE_EMAIL) };
      if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
      const { ok, status, data, error } = await fetchJson<{ data?: SemanticScholarPaper[] }>(
        `https://api.semanticscholar.org/graph/v1/paper/search?${params}`,
        { headers, timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      if (!ok) return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429, error };
      const resources: RawResource[] = (data?.data ?? [])
        .filter((p) => p.title)
        .map((p) => ({
          provider: this.provider,
          resourceType: "article" as const,
          title: p.title!,
          authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
          year: p.year ?? null,
          url: p.url ?? (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null),
          doi: p.externalIds?.DOI ?? null,
          isbn: null,
          snippet: p.abstract ? p.abstract.replace(/\s+/g, " ").trim().slice(0, 600) : null,
          venue: p.venue ?? null,
          popularity: p.citationCount ?? null,
          raw: p,
        }));
      return { resources };
    });
  }
}
