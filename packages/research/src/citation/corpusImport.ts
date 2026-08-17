import { ArxivAdapter, lookupArxivById } from "./adapters/arxiv";
import { OpenAlexAdapter, SemanticScholarAdapter, lookupOpenAlexById, lookupSemanticScholarById } from "./adapters/scholarly";
import { dedupeResources, normalizedKey } from "./normalize";
import type { AdapterSearchOptions, ProviderAttempt, RawResource, SourceAdapter } from "./types";

/**
 * Corpus import (Phase 28.2, plan §Schema `research_corpus_item` /
 * §Improvements 6 "Canonical-identity dedup for corpus import"). Two
 * operations, both zero-AI-cost (network-only, real-provider metadata):
 *
 *  - `searchCorpusCandidates` — fan out a query across the three corpus-import
 *    providers (Semantic Scholar, OpenAlex, arXiv) and return a deduped,
 *    honestly-attempted candidate list for a "search to import" UI.
 *  - `normalizeCorpusItem` — turn ONE already-fetched provider payload into
 *    the exact `research_corpus_item` insert shape. This is the anti-
 *    hallucination boundary: see its own doc comment below.
 *
 * The three providers here are a strict subset of `ProviderName` — the same
 * three values `corpus_source` (packages/db/src/schema.ts) accepts. Kept as
 * its own narrower type rather than reusing `ProviderName` directly so a
 * caller can never pass e.g. "tavily" where the DB column would reject it.
 */
export type CorpusProvider = "semanticscholar" | "openalex" | "arxiv";

export const CORPUS_PROVIDERS: readonly CorpusProvider[] = ["semanticscholar", "openalex", "arxiv"];

export function isCorpusProvider(value: string): value is CorpusProvider {
  return (CORPUS_PROVIDERS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Search (candidate discovery — fan out, dedup, honest attempts).
// ---------------------------------------------------------------------------

export interface CorpusSearchOptions {
  /** Max candidates returned overall (post-dedup, post-merge across all
   *  three providers) — NOT a per-provider cap; each adapter itself is
   *  asked for up to this many, same as every other adapter call site. */
  limit: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** DI seam for tests — defaults to real adapter instances. Keyed (not a
   *  plain array) so a test can override exactly one provider's adapter and
   *  leave the others real, without needing to know call order. */
  adapters?: { semanticscholar: SourceAdapter; openalex: SourceAdapter; arxiv: SourceAdapter };
}

export interface CorpusSearchResult {
  /** Deduped across all three providers by `normalizedKey` (DOI > ISBN > URL
   *  > normalized title+author+year) — the same identity function the rest
   *  of `@ice/research` uses, so a paper indexed by more than one provider
   *  collapses to one candidate instead of three. */
  candidates: RawResource[];
  /** One attempt per provider, always present — including a provider that
   *  found nothing or is disabled (the house honesty contract). */
  attempts: ProviderAttempt[];
}

/**
 * Fan out one query to Semantic Scholar + OpenAlex + arXiv concurrently,
 * merge results by `normalizedKey`, and report every provider's attempt
 * honestly — mirroring `discover.ts`'s per-round fan-out shape, simplified
 * to a single round since corpus search is a one-shot "search to import"
 * action, not a multi-round saturating discovery run.
 */
export async function searchCorpusCandidates(query: string, opts: CorpusSearchOptions): Promise<CorpusSearchResult> {
  const adapters = opts.adapters ?? {
    semanticscholar: new SemanticScholarAdapter(),
    openalex: new OpenAlexAdapter(),
    arxiv: new ArxivAdapter(),
  };
  const list: SourceAdapter[] = [adapters.semanticscholar, adapters.openalex, adapters.arxiv];
  const searchOpts: AdapterSearchOptions = { maxResults: opts.limit, timeoutMs: opts.timeoutMs, signal: opts.signal };
  const results = await Promise.all(list.map((a) => a.search([query], searchOpts)));
  const attempts = results.map((r) => r.attempt);
  const candidates = dedupeResources(results.flatMap((r) => r.resources)).slice(0, opts.limit);
  return { candidates, attempts };
}

// ---------------------------------------------------------------------------
// Direct-by-id lookup dispatch (the "fetch full metadata by id" step).
// ---------------------------------------------------------------------------

export interface CorpusLookupResult {
  resource: RawResource | null;
  attempt: ProviderAttempt;
}

/** Routes to the right provider's own single-record lookup — the exact
 *  metadata fetch `apps/worker/src/research/importCorpus.ts` needs for each
 *  `{provider, externalId}` scope item, distinct from `search()`'s
 *  ranked/fuzzy results. */
export async function lookupCorpusItemById(
  provider: CorpusProvider,
  externalId: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<CorpusLookupResult> {
  switch (provider) {
    case "semanticscholar":
      return lookupSemanticScholarById(externalId, opts);
    case "openalex":
      return lookupOpenAlexById(externalId, opts);
    case "arxiv":
      return lookupArxivById(externalId, opts);
  }
}

// ---------------------------------------------------------------------------
// Normalization (RawResource -> research_corpus_item insert shape).
// ---------------------------------------------------------------------------

export interface CorpusItemInsertShape {
  source: CorpusProvider;
  externalId: string;
  dedupKey: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  venue: string | null;
  raw: unknown;
}

/** Pulls the provider's own id for a resource out of its `raw` payload — the
 *  same `raw` shape each adapter/lookup function in this package populates
 *  (see `arxiv.ts`'s and `scholarly.ts`'s own doc comments on `raw`). */
function extractExternalId(provider: CorpusProvider, resource: RawResource): string | null {
  const raw = resource.raw as Record<string, unknown> | null | undefined;
  switch (provider) {
    case "semanticscholar": {
      const id = raw?.paperId;
      return typeof id === "string" && id.length > 0 ? id : null;
    }
    case "openalex": {
      const id = raw?.id;
      if (typeof id !== "string" || !id) return null;
      return id.replace(/^https?:\/\/openalex\.org\//i, "").trim() || null;
    }
    case "arxiv": {
      const id = raw?.arxivId;
      return typeof id === "string" && id.length > 0 ? id : null;
    }
  }
}

/**
 * Turns one already-fetched provider payload into the exact
 * `research_corpus_item` insert shape (packages/db/src/schema.ts).
 *
 * ANTI-HALLUCINATION RULE (the `bibliographic_record` precedent — plan
 * §Improvements 6, §Schema `research_corpus_item`'s own doc comment): every
 * field returned here is copied verbatim from `resource`, which is itself
 * only ever produced by a REAL Semantic Scholar / OpenAlex / arXiv API
 * response (`searchCorpusCandidates` or `lookupCorpusItemById` — never an
 * LLM). Nothing is inferred, summarized, or backfilled by a model; a field
 * the provider didn't supply stays `null` rather than being guessed. This
 * function itself makes no network call and has no model in its call path —
 * it is a pure, honest re-shaping of data that already came from a lookup.
 *
 * Returns `null` (never a partially-populated row) when the payload lacks
 * enough to identify the record — no externalId, no title, or no usable
 * dedup key — matching `RawResource`'s own `.filter((r) => r.title)`
 * discipline elsewhere in this package.
 */
export function normalizeCorpusItem(provider: CorpusProvider, resource: RawResource): CorpusItemInsertShape | null {
  if (resource.provider !== provider) return null; // guards against a mismatched caller
  const externalId = extractExternalId(provider, resource);
  const title = resource.title.trim();
  if (!externalId || !title) return null;
  const dedupKey = normalizedKey({
    doi: resource.doi,
    isbn: resource.isbn,
    url: resource.url,
    title,
    authors: resource.authors,
    year: resource.year,
  });
  if (!dedupKey) return null;
  return {
    source: provider,
    externalId,
    dedupKey,
    title,
    authors: resource.authors,
    year: resource.year,
    doi: resource.doi,
    url: resource.url,
    abstract: resource.snippet,
    venue: resource.venue,
    raw: resource.raw,
  };
}
