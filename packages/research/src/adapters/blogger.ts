import { configuredBloggerBlogIds, providerEnabled } from "../config";
import type { AdapterResult, AdapterSearchOptions, RawResource, SourceAdapter } from "../types";
import { disabledAttempt, fetchJson, runAttempt } from "./base";

const first = (queries: string[]) => queries.find((query) => query.trim().length > 3) ?? "";

function plainText(value: string | undefined): string {
  return (value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface BloggerPost {
  title?: string;
  url?: string;
  published?: string;
  content?: string;
  author?: { displayName?: string };
}

interface BloggerPostList {
  items?: BloggerPost[];
}

/**
 * Blogger's public API searches posts within a known blog ID; it cannot search
 * every Blogger publication. Configuration therefore supplies a small curated
 * allowlist and the adapter stays disabled until both that list and its API key
 * are present.
 */
export class BloggerAdapter implements SourceAdapter {
  readonly provider = "blogger" as const;

  isEnabled() {
    return providerEnabled(this.provider);
  }

  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);

    return runAttempt(this.provider, queries, async () => {
      const resources: RawResource[] = [];
      let rateLimited = false;
      let unavailable = false;
      let failed = false;
      const errors: string[] = [];

      for (const blogId of configuredBloggerBlogIds()) {
        const remaining = opts.maxResults - resources.length;
        if (remaining <= 0) break;

        const params = new URLSearchParams({
          key: process.env.BLOGGER_API_KEY ?? "",
          maxResults: String(Math.min(remaining, 50)),
          q: first(queries),
        });
        const { ok, status, data, error } = await fetchJson<BloggerPostList>(
          `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(blogId)}/posts/search?${params}`,
          { timeoutMs: opts.timeoutMs, signal: opts.signal },
        );

        if (!ok) {
          rateLimited ||= status === 429 || status === 403;
          failed ||= status === 0;
          unavailable ||= status > 0 && status !== 429 && status !== 403;
          if (error) errors.push(error);
          continue;
        }

        resources.push(...(data?.items ?? [])
          .filter((post) => post.url && post.title)
          .map((post) => ({
            provider: this.provider,
            resourceType: "webpage" as const,
            title: post.title!,
            authors: post.author?.displayName ? [post.author.displayName] : [],
            year: post.published ? Number(post.published.slice(0, 4)) || null : null,
            url: post.url!,
            doi: null,
            isbn: null,
            snippet: plainText(post.content).slice(0, 600) || null,
            venue: "Blogger",
            popularity: null,
            raw: post,
          })));
      }

      if (resources.length) return { resources: resources.slice(0, opts.maxResults) };
      return {
        resources,
        rateLimited,
        unavailable,
        failed,
        error: errors.length ? errors.join("; ") : undefined,
      };
    });
  }
}
