import type { ProviderName } from "./types";

/**
 * Approved research limits (plan §33). These bound cost, latency, and blast
 * radius. They are the single source of truth for the orchestrator — every
 * cap the plan lists lives here, env-overridable where a deployment might
 * reasonably tune it, but never silently exceeded.
 */
export const RESEARCH_LIMITS = {
  /** Soft AI-cost ceiling per work: past this, only already-started work
   *  finishes; no new discovery batches begin. */
  costSoftCapUsd: Number(process.env.RESEARCH_COST_SOFT_CAP ?? 1),
  /** Hard AI-cost ceiling: never START a call projected to exceed this. */
  costHardCapUsd: Number(process.env.RESEARCH_COST_HARD_CAP ?? 5),
  /** Max explicit-citation candidates parsed from the document. */
  maxCitationCandidates: 300,
  /** Max resources collected before dedup across all providers. */
  maxResourcesPreDedup: 750,
  /** Reference-graph traversal depth from the primary work. */
  traversalDepth: 2,
  /** Per-provider query/result budgets. */
  maxWebResults: 12,
  maxYoutubeResults: 8,
  maxSocialResultsPerProvider: 6,
  /** Max resources promoted to a full (content-level) inspection. Env-
   *  overridable so ops/tests can bound per-run LLM spend. */
  maxFullInspections: Number(process.env.RESEARCH_MAX_INSPECTIONS ?? 120),
  /** Saturation: stop after this many consecutive discovery batches each add
   *  fewer than `saturationMinNewFraction` new relevant non-duplicates. */
  saturationBatches: 2,
  saturationMinNewFraction: 0.05,
} as const;

/** Cache TTLs by source class (plan §33): scholarly 30d, web/video 7d, social 24h. */
export const CACHE_TTL_MS = {
  scholarly: 30 * 24 * 60 * 60 * 1000,
  web: 7 * 24 * 60 * 60 * 1000,
  social: 24 * 60 * 60 * 1000,
} as const;

/**
 * Provider enablement. Keyless scholarly sources are always on. Keyed web and
 * social sources record an honest `disabled` attempt when their required
 * configuration is absent. Reddit stays out of the direct-adapter surface. A
 * provider can also be force-disabled via `RESEARCH_DISABLED_PROVIDERS`
 * (comma-separated).
 */
const forceDisabled = new Set(
  (process.env.RESEARCH_DISABLED_PROVIDERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);

export function providerEnabled(provider: ProviderName): boolean {
  if (forceDisabled.has(provider)) return false;
  switch (provider) {
    // Keyless scholarly sources — always available.
    case "crossref":
    case "openalex":
    case "openlibrary":
    case "googlebooks":
    case "semanticscholar":
      return true;
    // Free-tier keys required; disabled (honestly reported) when absent.
    case "tavily":
      return Boolean(process.env.TAVILY_API_KEY);
    case "youtube":
      return Boolean(process.env.YOUTUBE_API_KEY);
    // Status search requires both the target instance and an authorized token.
    case "mastodon":
      return Boolean(process.env.MASTODON_INSTANCE_URL && process.env.MASTODON_ACCESS_TOKEN);
    case "bluesky":
      return Boolean(process.env.BLUESKY_IDENTIFIER && process.env.BLUESKY_APP_PASSWORD);
    default:
      return false;
  }
}

/** Polite-pool / attribution contact sent to keyless scholarly APIs. */
export const POLITE_EMAIL =
  process.env.CROSSREF_POLITE_POOL_EMAIL ?? process.env.OPENALEX_POLITE_POOL_EMAIL ?? undefined;
