import { POLITE_EMAIL, providerEnabled } from "../config";
import type { AdapterResult, AdapterSearchOptions, ProviderAttempt, RawResource, SourceAdapter } from "../types";
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

/**
 * Direct-by-id metadata fetch (Phase 28.2's "fetch full metadata by id from
 * its provider" corpus-import step) — a single-work OpenAlex lookup, as
 * opposed to `OpenAlexAdapter.search()`'s ranked/fuzzy results. `openAlexId`
 * accepts either the bare id (`"W2031754690"`) or a full `openalex.org/`
 * URL — the same id shape `RawResource.raw.id` carries.
 */
export async function lookupOpenAlexById(
  openAlexId: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ resource: RawResource | null; attempt: ProviderAttempt }> {
  if (!providerEnabled("openalex")) return { resource: null, attempt: disabledAttempt("openalex").attempt };
  const result = await runAttempt("openalex", [openAlexId], async () => {
    const bareId = openAlexId.replace(/^https?:\/\/openalex\.org\//i, "").trim();
    const params = new URLSearchParams();
    if (POLITE_EMAIL) params.set("mailto", POLITE_EMAIL);
    const qs = params.toString();
    const { ok, status, data, error } = await fetchJson<OpenAlexWork>(
      `https://api.openalex.org/works/${encodeURIComponent(bareId)}${qs ? `?${qs}` : ""}`,
      { headers: { "User-Agent": userAgent(POLITE_EMAIL) }, timeoutMs: opts.timeoutMs, signal: opts.signal },
    );
    if (!ok) {
      // OpenAlex answers 404 for an unknown work id — an honest "not found",
      // distinct from a real outage/rate-limit.
      if (status === 404) return { resources: [] };
      return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429 && status !== 404, error };
    }
    if (!data || (!data.title && !data.display_name)) return { resources: [] };
    const w = data;
    const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, "") : null;
    const resource: RawResource = {
      provider: "openalex",
      resourceType: (w.type === "book" || w.type === "monograph" ? "book" : "article") as "book" | "article",
      title: w.title ?? w.display_name ?? "",
      authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean),
      year: w.publication_year ?? null,
      url: w.best_oa_location?.landing_page_url ?? w.primary_location?.landing_page_url ?? (doi ? `https://doi.org/${doi}` : null),
      doi,
      isbn: null,
      snippet: reconstructInvertedAbstract(w.abstract_inverted_index),
      venue: w.primary_location?.source?.display_name ?? null,
      popularity: w.cited_by_count ?? null,
      // `id` is preserved (falling back to the requested bare id) so
      // `corpusImport.ts` can recover the provider's own external id from
      // `raw.id`, the same field `OpenAlexAdapter.search()`'s results carry.
      raw: { ...w, id: w.id ?? `https://openalex.org/${bareId}` },
    };
    return { resources: [resource] };
  });
  return { resource: result.resources[0] ?? null, attempt: result.attempt };
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

/**
 * Direct-by-id metadata fetch (Phase 28.2's "fetch full metadata by id from
 * its provider" corpus-import step) — a single-paper Semantic Scholar
 * lookup, as opposed to `SemanticScholarAdapter.search()`'s ranked results.
 * `paperId` is the S2 paperId `RawResource.raw.paperId` carries (the id
 * `SemanticScholarAdapter.search()`'s own results are keyed by).
 */
export async function lookupSemanticScholarById(
  paperId: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ resource: RawResource | null; attempt: ProviderAttempt }> {
  if (!providerEnabled("semanticscholar")) return { resource: null, attempt: disabledAttempt("semanticscholar").attempt };
  const result = await runAttempt("semanticscholar", [paperId], async () => {
    const params = new URLSearchParams({ fields: "title,authors,year,externalIds,abstract,citationCount,url,venue" });
    const headers: Record<string, string> = { "User-Agent": userAgent(POLITE_EMAIL) };
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    const { ok, status, data, error } = await fetchJson<SemanticScholarPaper>(
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(paperId)}?${params}`,
      { headers, timeoutMs: opts.timeoutMs, signal: opts.signal },
    );
    if (!ok) {
      // Semantic Scholar answers 404 for an unknown paperId — an honest
      // "not found", distinct from a real outage/rate-limit.
      if (status === 404) return { resources: [] };
      return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429 && status !== 404, error };
    }
    if (!data?.title) return { resources: [] };
    const p = data;
    const resource: RawResource = {
      provider: "semanticscholar",
      resourceType: "article",
      title: p.title!,
      authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
      year: p.year ?? null,
      url: p.url ?? (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null),
      doi: p.externalIds?.DOI ?? null,
      isbn: null,
      snippet: p.abstract ? p.abstract.replace(/\s+/g, " ").trim().slice(0, 600) : null,
      venue: p.venue ?? null,
      popularity: p.citationCount ?? null,
      // The single-paper endpoint's own response carries no top-level
      // `paperId` field unless explicitly requested — inject the id we
      // looked it up by, the same field `search()`'s results carry.
      raw: { ...p, paperId },
    };
    return { resources: [resource] };
  });
  return { resource: result.resources[0] ?? null, attempt: result.attempt };
}

function mapSemanticScholarPaper(p: SemanticScholarPaper): RawResource {
  return {
    provider: "semanticscholar",
    resourceType: "article",
    title: p.title ?? "",
    authors: (p.authors ?? []).map((a) => a.name ?? "").filter(Boolean),
    year: p.year ?? null,
    url: p.url ?? (p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null),
    doi: p.externalIds?.DOI ?? null,
    isbn: null,
    snippet: p.abstract ? p.abstract.replace(/\s+/g, " ").trim().slice(0, 600) : null,
    venue: p.venue ?? null,
    popularity: p.citationCount ?? null,
    raw: p,
  };
}

/**
 * Phase 29.1 monitoring: new papers CITING a seed paper (Semantic Scholar's
 * citations graph) — the "citation alert" monitor type
 * (`docs/architecture/scholarlens-integration-plan.md` §Pipeline
 * monitoring, transplanting `monitoring_agent.py`'s `scan_citations` onto
 * this codebase's honest-attempt adapter shape). `seedPaperId` is whatever
 * `formatSemanticScholarPaperId` (below) already normalized — S2 accepts a
 * bare paperId, `DOI:...`, or `ARXIV:...`. A seed with zero citers is an
 * honest empty result, not a failure.
 */
export async function lookupCitations(
  seedPaperId: string,
  opts: { maxResults?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ resources: RawResource[]; attempt: ProviderAttempt }> {
  if (!providerEnabled("semanticscholar")) return { resources: [], attempt: disabledAttempt("semanticscholar").attempt };
  const maxResults = opts.maxResults ?? 10;
  const result = await runAttempt("semanticscholar", [seedPaperId], async () => {
    const params = new URLSearchParams({
      fields: "title,authors,year,externalIds,abstract,citationCount,url,venue",
      limit: String(Math.min(maxResults, 100)),
    });
    const headers: Record<string, string> = { "User-Agent": userAgent(POLITE_EMAIL) };
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;
    const { ok, status, data, error } = await fetchJson<{ data?: { citingPaper?: SemanticScholarPaper }[] }>(
      `https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(seedPaperId)}/citations?${params}`,
      { headers, timeoutMs: opts.timeoutMs, signal: opts.signal },
    );
    if (!ok) {
      // S2 answers 404 for a seed id it doesn't recognize — an honest "not
      // found" (e.g. a DOI it hasn't indexed), distinct from a real
      // outage/rate-limit.
      if (status === 404) return { resources: [] };
      return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429 && status !== 404, error };
    }
    const resources = (data?.data ?? [])
      .map((row) => row.citingPaper)
      .filter((p): p is SemanticScholarPaper => Boolean(p?.title))
      .map(mapSemanticScholarPaper);
    return { resources };
  });
  return { resources: result.resources, attempt: result.attempt };
}

/**
 * Phase 29.1 monitoring: an author's newest S2-indexed papers — the
 * "author follow" monitor type (transplanting `monitoring_agent.py`'s
 * `scan_authors`). Two real requests under one `ProviderAttempt` (author
 * name -> authorId, then that author's papers) since S2 has no single
 * "papers by author name" endpoint; both are honestly reported as one
 * logical operation, matching how `runAttempt` already wraps a whole
 * adapter body elsewhere in this file. An author name with no S2 match is
 * an honest empty result (no author found), not a failure.
 */
export async function lookupAuthorRecentPapers(
  authorName: string,
  opts: { maxResults?: number; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ resources: RawResource[]; attempt: ProviderAttempt }> {
  if (!providerEnabled("semanticscholar")) return { resources: [], attempt: disabledAttempt("semanticscholar").attempt };
  const maxResults = opts.maxResults ?? 10;
  const result = await runAttempt("semanticscholar", [authorName], async () => {
    const headers: Record<string, string> = { "User-Agent": userAgent(POLITE_EMAIL) };
    if (process.env.SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = process.env.SEMANTIC_SCHOLAR_API_KEY;

    const searchParams = new URLSearchParams({ query: authorName });
    const authorSearch = await fetchJson<{ data?: { authorId?: string }[] }>(
      `https://api.semanticscholar.org/graph/v1/author/search?${searchParams}`,
      { headers, timeoutMs: opts.timeoutMs, signal: opts.signal },
    );
    if (!authorSearch.ok) {
      if (authorSearch.status === 404) return { resources: [] };
      return {
        resources: [],
        rateLimited: authorSearch.status === 429,
        failed: authorSearch.status === 0,
        unavailable: authorSearch.status > 0 && authorSearch.status !== 429 && authorSearch.status !== 404,
        error: authorSearch.error,
      };
    }
    const authorId = authorSearch.data?.data?.[0]?.authorId;
    if (!authorId) return { resources: [] }; // honest "no matching author"

    const papersParams = new URLSearchParams({
      fields: "title,authors,year,externalIds,abstract,citationCount,url,venue",
      // Over-fetch then sort/trim client-side — S2's author-papers endpoint
      // has no "most recent" sort of its own.
      limit: String(Math.min(maxResults * 3, 1000)),
    });
    const papers = await fetchJson<{ data?: SemanticScholarPaper[] }>(
      `https://api.semanticscholar.org/graph/v1/author/${encodeURIComponent(authorId)}/papers?${papersParams}`,
      { headers, timeoutMs: opts.timeoutMs, signal: opts.signal },
    );
    if (!papers.ok) {
      return {
        resources: [],
        rateLimited: papers.status === 429,
        failed: papers.status === 0,
        unavailable: papers.status > 0 && papers.status !== 429,
        error: papers.error,
      };
    }
    const sorted = (papers.data?.data ?? [])
      .filter((p): p is SemanticScholarPaper => Boolean(p.title))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
      .slice(0, maxResults);
    return { resources: sorted.map(mapSemanticScholarPaper) };
  });
  return { resources: result.resources, attempt: result.attempt };
}

/**
 * Normalizes a `citation_alert` monitor's `query` (a bare DOI, a bare arXiv
 * id, or an already-prefixed `DOI:`/`ARXIV:` seed — the same three shapes
 * `monitoring_agent.py`'s `scan_citations` accepts) into the exact id
 * format Semantic Scholar's paper-lookup endpoints expect. A DOI is
 * recognized by its `10.` prefix; an arXiv id by its `NNNN.NNNNN`
 * (post-2007) or legacy `category/NNNNNNN` shape. Anything already carrying
 * a recognized S2 prefix (`DOI:`, `ARXIV:`, `PMID:`, `MAG:`, `ACL:`,
 * `CorpusID:`) is passed through untouched.
 */
export function formatSemanticScholarPaperId(seed: string): string {
  const trimmed = seed.trim();
  if (/^(DOI|ARXIV|PMID|MAG|ACL|CorpusID):/i.test(trimmed)) return trimmed;
  if (/^10\.\d{4,9}\//.test(trimmed)) return `DOI:${trimmed}`;
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed) || /^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/i.test(trimmed)) return `ARXIV:${trimmed}`;
  return trimmed;
}
