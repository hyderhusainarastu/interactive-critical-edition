import { describe, expect, it, vi } from "vitest";
import { cacheKey, cacheTtlFor, withCache, type CacheStore } from "./cache";
import { CACHE_TTL_MS } from "./config";
import type { AdapterResult, AdapterSearchOptions, ProviderName, RawResource, SourceAdapter } from "./types";

function memStore(): CacheStore & { sets: number } {
  const map = new Map<string, RawResource[]>();
  return {
    sets: 0,
    async get(p, k) {
      return map.get(`${p}:${k}`) ?? null;
    },
    async set(p, k, r) {
      this.sets++;
      map.set(`${p}:${k}`, r);
    },
  };
}

function res(i: number): RawResource {
  return { provider: "crossref", resourceType: "article", title: `W${i}`, authors: [], year: null, url: null, doi: `10.1000/w${i}`, isbn: null, snippet: null, venue: null, popularity: null, raw: null };
}

class CountingAdapter implements SourceAdapter {
  calls = 0;
  constructor(readonly provider: ProviderName = "crossref", private readonly enabled = true) {}
  isEnabled() {
    return this.enabled;
  }
  async search(queries: string[], _opts: AdapterSearchOptions): Promise<AdapterResult> {
    this.calls++;
    return {
      attempt: { provider: this.provider, status: "queried", queries, resultCount: 1, inspectionDepth: 1, latencyMs: 3 },
      resources: [res(this.calls)],
    };
  }
}

describe("cacheTtlFor", () => {
  it("uses the plan's TTLs by source class", () => {
    expect(cacheTtlFor("crossref")).toBe(CACHE_TTL_MS.scholarly);
    expect(cacheTtlFor("tavily")).toBe(CACHE_TTL_MS.web);
    expect(cacheTtlFor("youtube")).toBe(CACHE_TTL_MS.web);
    expect(cacheTtlFor("mastodon")).toBe(CACHE_TTL_MS.social);
  });
});

describe("cacheKey", () => {
  it("is stable regardless of query order/whitespace/case", () => {
    expect(cacheKey("crossref", ["Kant Ethics", "virtue "])).toBe(cacheKey("crossref", ["virtue", "kant  ethics"]));
  });
  it("differs by provider", () => {
    expect(cacheKey("crossref", ["x"])).not.toBe(cacheKey("openalex", ["x"]));
  });
});

describe("withCache", () => {
  it("stores on a live miss and serves the second call from cache", async () => {
    const store = memStore();
    const inner = new CountingAdapter();
    const cached = withCache(inner, store);
    const a = await cached.search(["kant ethics"], { maxResults: 5 });
    const b = await cached.search(["kant ethics"], { maxResults: 5 });
    expect(inner.calls).toBe(1); // second served from cache
    expect(store.sets).toBe(1);
    expect(b.resources).toEqual(a.resources);
    expect(b.attempt.latencyMs).toBe(0); // cache hit is instant
  });

  it("passes a disabled adapter through without caching", async () => {
    const store = memStore();
    const inner = new CountingAdapter("tavily", false);
    const spyGet = vi.spyOn(store, "get");
    const cached = withCache(inner, store);
    const out = await cached.search(["x"], { maxResults: 5 });
    expect(out.attempt.status).toBe("queried"); // CountingAdapter returns queried even when disabled-flag set here
    expect(spyGet).not.toHaveBeenCalled();
  });

  it("does not cache an empty or failed result", async () => {
    const store = memStore();
    const empty: SourceAdapter = {
      provider: "crossref",
      isEnabled: () => true,
      async search(queries) {
        return { attempt: { provider: "crossref", status: "queried", queries, resultCount: 0, inspectionDepth: 0, latencyMs: 1 }, resources: [] };
      },
    };
    await withCache(empty, store).search(["x"], { maxResults: 5 });
    expect(store.sets).toBe(0);
  });
});
