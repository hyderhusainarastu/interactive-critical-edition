import { providerEnabled } from "../config";
import type { AdapterResult, AdapterSearchOptions, RawResource, SourceAdapter } from "../types";
import { disabledAttempt, fetchJson, runAttempt, userAgent } from "./base";

const first = (queries: string[]) => queries.find((q) => q.trim().length > 3) ?? "";

function isPublicRedditUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return hostname === "reddit.com" || hostname.endsWith(".reddit.com");
  } catch {
    return false;
  }
}

// ---- Tavily (web search; free key required) ----
interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

export class TavilyAdapter implements SourceAdapter {
  readonly provider = "tavily" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
      if (opts.signal) opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": userAgent() },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: first(queries),
            max_results: opts.maxResults,
            search_depth: "basic",
          }),
          signal: controller.signal,
        });
        if (!res.ok) return { resources: [], rateLimited: res.status === 429, unavailable: res.status !== 429 };
        const data = (await res.json()) as { results?: TavilyResult[] };
        const resources: RawResource[] = (data.results ?? [])
          .filter((r) => r.url && r.title)
          .map((r) => {
            const isReddit = isPublicRedditUrl(r.url!);
            // Reddit stays a Tavily/web-search result: only the returned
            // citation metadata, snippet, and outbound URL are retained. No
            // Reddit HTML/API adapter or post scraping is introduced here.
            return {
              provider: this.provider,
              resourceType: isReddit ? "social_post" as const : "webpage" as const,
              title: r.title!,
              authors: [],
              year: null,
              url: r.url!,
              doi: null,
              isbn: null,
              snippet: r.content ? r.content.replace(/\s+/g, " ").trim().slice(0, 600) : null,
              venue: isReddit ? "Reddit (web search result)" : null,
              popularity: null,
              raw: r,
            };
          });
        return { resources };
      } finally {
        clearTimeout(timer);
      }
    });
  }
}

// ---- YouTube Data API v3 (free key required) ----
interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string; description?: string };
}

export class YouTubeAdapter implements SourceAdapter {
  readonly provider = "youtube" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      const params = new URLSearchParams({
        part: "snippet",
        q: first(queries),
        type: "video",
        maxResults: String(Math.min(opts.maxResults, 25)),
        key: process.env.YOUTUBE_API_KEY ?? "",
      });
      const { ok, status, data, error } = await fetchJson<{ items?: YouTubeSearchItem[] }>(
        `https://www.googleapis.com/youtube/v3/search?${params}`,
        { timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      if (!ok) return { resources: [], rateLimited: status === 429 || status === 403, failed: status === 0, unavailable: status > 0 && status !== 429 && status !== 403, error };
      const resources: RawResource[] = (data?.items ?? [])
        .filter((it) => it.id?.videoId && it.snippet?.title)
        .map((it) => ({
          provider: this.provider,
          resourceType: "video" as const,
          title: it.snippet!.title!,
          // YouTube metadata identifies a lecture/talk but cannot support a
          // factual note on its own without a lawful transcript (plan §33) —
          // so the channel is recorded as the "author", authority stays low.
          authors: it.snippet!.channelTitle ? [it.snippet!.channelTitle] : [],
          year: it.snippet!.publishedAt ? Number(it.snippet!.publishedAt.slice(0, 4)) || null : null,
          url: `https://www.youtube.com/watch?v=${it.id!.videoId}`,
          doi: null,
          isbn: null,
          snippet: it.snippet!.description ? it.snippet!.description.replace(/\s+/g, " ").trim().slice(0, 400) : null,
          venue: it.snippet!.channelTitle ?? null,
          popularity: null,
          raw: it,
        }));
      return { resources };
    });
  }
}
