import { createHash } from "node:crypto";
import { CACHE_TTL_MS } from "./config";
import { SCHOLARLY_PROVIDERS, SOCIAL_PROVIDERS } from "./types";
import type { AdapterResult, AdapterSearchOptions, ProviderName, RawResource, SourceAdapter } from "./types";

/**
 * Result caching (plan §33): normalized provider results are cached — scholarly
 * 30 days, web/video 7 days, social 24 hours — so re-runs and repeated queries
 * don't re-hit the APIs. The store is DB-free here (an interface the worker
 * implements over a `research_cache` table), keeping @ice/research portable.
 */
export interface CacheStore {
  get(provider: ProviderName, key: string): Promise<RawResource[] | null>;
  set(provider: ProviderName, key: string, resources: RawResource[], ttlMs: number): Promise<void>;
}

export function cacheTtlFor(provider: ProviderName): number {
  if (SCHOLARLY_PROVIDERS.includes(provider)) return CACHE_TTL_MS.scholarly;
  if (SOCIAL_PROVIDERS.includes(provider)) return CACHE_TTL_MS.social;
  return CACHE_TTL_MS.web;
}

export function cacheKey(provider: ProviderName, queries: string[]): string {
  const norm = queries
    .map((q) => q.toLowerCase().replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .sort()
    .join("|");
  return createHash("sha256").update(`${provider}:${norm}`).digest("hex").slice(0, 48);
}

/**
 * Wrap an adapter so its `search` is served from cache on a hit and stored on a
 * live miss. A cache read/write failure never breaks discovery — it degrades to
 * a live call. Disabled adapters pass through unchanged (still record disabled).
 */
export function withCache(adapter: SourceAdapter, store: CacheStore): SourceAdapter {
  return {
    provider: adapter.provider,
    isEnabled: () => adapter.isEnabled(),
    async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
      if (!adapter.isEnabled()) return adapter.search(queries, opts);
      const key = cacheKey(adapter.provider, queries);
      const cached = await store.get(adapter.provider, key).catch(() => null);
      if (cached) {
        return {
          attempt: {
            provider: adapter.provider,
            status: "queried",
            queries,
            resultCount: cached.length,
            inspectionDepth: 0,
            latencyMs: 0,
          },
          resources: cached,
        };
      }
      const result = await adapter.search(queries, opts);
      if (result.attempt.status === "queried" && result.resources.length > 0) {
        await store.set(adapter.provider, key, result.resources, cacheTtlFor(adapter.provider)).catch(() => undefined);
      }
      return result;
    },
  };
}
