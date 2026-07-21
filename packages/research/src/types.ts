/**
 * Evidence-first research layer (plan §33 group 2). Every external source —
 * scholarly, web, video, social — sits behind ONE `SourceAdapter` interface and
 * normalizes into a `RawResource`. Adapters never throw for expected conditions
 * (no key, rate limit, timeout, empty result); they return a self-describing
 * `ProviderAttempt` so the run can prove exactly what was and wasn't consulted.
 *
 * Hard rules baked into these types (enforced downstream):
 *  - Bibliographic facts (title/author/year/DOI/ISBN) come only from a real
 *    lookup, never an LLM (same anti-hallucination rule as @ice/bibliographic).
 *  - Only metadata + limited excerpts are stored, never full third-party
 *    copyrighted text.
 *  - Authority is independent of popularity; credibility never collapses to a
 *    single number the reader can't decompose.
 */

export type ProviderName =
  | "crossref"
  | "openalex"
  | "openlibrary"
  | "googlebooks"
  | "semanticscholar"
  | "tavily"
  | "blogger"
  | "youtube"
  | "mastodon"
  | "bluesky";

/** Scholarly providers get a 30-day cache and feed the credibility A/B tiers;
 *  web/video 7 days; social 24 hours (plan §33). */
export const SCHOLARLY_PROVIDERS: readonly ProviderName[] = [
  "crossref",
  "openalex",
  "openlibrary",
  "googlebooks",
  "semanticscholar",
];
export const WEB_PROVIDERS: readonly ProviderName[] = ["tavily", "blogger", "youtube"];
export const SOCIAL_PROVIDERS: readonly ProviderName[] = ["mastodon", "bluesky"];

/** The auditable outcome of consulting a provider (plan §33 §2.3). */
export type ProviderStatus = "queried" | "unavailable" | "rate_limited" | "failed" | "disabled";

export type ResourceType =
  | "book"
  | "article"
  | "webpage"
  | "video"
  | "social_post"
  | "dataset"
  | "unresolved-citation";

/**
 * Normalized resource. `abstract`/`snippet` hold a provider-supplied metadata
 * excerpt only (never a scraped full text). `raw` keeps the provider's own
 * metadata record for provenance/debugging, not for display.
 */
export interface RawResource {
  provider: ProviderName;
  resourceType: ResourceType;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  doi: string | null;
  isbn: string | null;
  /** Metadata excerpt (abstract / search snippet), never full copyrighted text. */
  snippet: string | null;
  venue: string | null;
  /** Provider popularity signal (citations, views, likes) — NEVER credibility. */
  popularity: number | null;
  raw: unknown;
}

/** One provider's attempt within a run — mirrors the `provider_attempt` table. */
export interface ProviderAttempt {
  provider: ProviderName;
  status: ProviderStatus;
  queries: string[];
  resultCount: number;
  inspectionDepth: number;
  latencyMs: number;
  error?: string;
}

export interface AdapterResult {
  attempt: ProviderAttempt;
  resources: RawResource[];
}

export interface AdapterSearchOptions {
  /** Cap on resources this adapter returns for this call (per-provider limit). */
  maxResults: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface SourceAdapter {
  readonly provider: ProviderName;
  /** False when unusable in this environment (missing free key, explicitly
   *  disabled). A disabled adapter still records a `disabled` attempt so the
   *  run honestly reports it was not consulted. */
  isEnabled(): boolean;
  /** Never throws for expected failures — records status and returns [] instead. */
  search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult>;
}

// ---- Credibility & agreement (independent components — plan §33) ----

export type SourceAuthority = "A" | "B" | "C" | "D" | "E";
export type AgreementState = "strong" | "contested" | "mixed" | "insufficient";

export interface CredibilityComponents {
  authority: SourceAuthority;
  relevance: number; // 0..1
  inspectionDepth: number; // 0 = metadata only, higher = inspected content
  evidenceStrength: number; // 0..1
  /** Roll-up for convenience only; the reader shows the components, not this. */
  score: number; // 0..1
  rationale: string;
}
