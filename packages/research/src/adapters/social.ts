import { providerEnabled } from "../config";
import type { AdapterResult, AdapterSearchOptions, RawResource, SourceAdapter } from "../types";
import { disabledAttempt, fetchJson, runAttempt, userAgent } from "./base";

/**
 * Social adapters (plan §33). Disabled by default — Mastodon needs an instance
 * base URL, Bluesky needs identifier + app password. Reddit and all paid social
 * access stay off until separately approved. Social posts are authority E and
 * can never solely support a factual claim; they surface as supplementary
 * interpretation only.
 */

const first = (queries: string[]) => queries.find((q) => q.trim().length > 3) ?? "";

// ---- Mastodon (public status search on a configured instance) ----
interface MastodonStatus {
  id?: string;
  url?: string;
  content?: string;
  created_at?: string;
  account?: { display_name?: string; acct?: string };
}

export class MastodonAdapter implements SourceAdapter {
  readonly provider = "mastodon" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      const base = (process.env.MASTODON_INSTANCE_URL ?? "").replace(/\/$/, "");
      const params = new URLSearchParams({ q: first(queries), type: "statuses", limit: String(opts.maxResults) });
      const headers: Record<string, string> = { "User-Agent": userAgent() };
      if (process.env.MASTODON_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`;
      const { ok, status, data, error } = await fetchJson<{ statuses?: MastodonStatus[] }>(
        `${base}/api/v2/search?${params}`,
        { headers, timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      // Many instances require auth for full-text status search → honest unavailable.
      if (!ok) return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429, error };
      const resources: RawResource[] = (data?.statuses ?? [])
        .filter((s) => s.url)
        .map((s) => ({
          provider: this.provider,
          resourceType: "social_post" as const,
          title: (s.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Mastodon post",
          authors: s.account?.display_name || s.account?.acct ? [s.account.display_name || s.account!.acct!] : [],
          year: s.created_at ? Number(s.created_at.slice(0, 4)) || null : null,
          url: s.url!,
          doi: null,
          isbn: null,
          snippet: (s.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) || null,
          venue: "Mastodon",
          popularity: null,
          raw: s,
        }));
      return { resources };
    });
  }
}

// ---- Bluesky (authenticated searchPosts via app password) ----
interface BlueskyPost {
  uri?: string;
  author?: { handle?: string; displayName?: string };
  record?: { text?: string; createdAt?: string };
}

export class BlueskyAdapter implements SourceAdapter {
  readonly provider = "bluesky" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      // Create a session with the app password (never the account password).
      // createSession is a POST, so it's an explicit fetch (fetchJson is GET-only).
      const authRes = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: process.env.BLUESKY_IDENTIFIER,
          password: process.env.BLUESKY_APP_PASSWORD,
        }),
        signal: opts.signal,
      }).catch(() => null);
      if (!authRes || !authRes.ok) return { resources: [], unavailable: true };
      const { accessJwt } = (await authRes.json()) as { accessJwt?: string };
      if (!accessJwt) return { resources: [], unavailable: true };
      const params = new URLSearchParams({ q: first(queries), limit: String(opts.maxResults) });
      const { ok, status, data, error } = await fetchJson<{ posts?: BlueskyPost[] }>(
        `https://bsky.social/xrpc/app.bsky.feed.searchPosts?${params}`,
        { headers: { Authorization: `Bearer ${accessJwt}` }, timeoutMs: opts.timeoutMs, signal: opts.signal },
      );
      if (!ok) return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429, error };
      const resources: RawResource[] = (data?.posts ?? [])
        .filter((p) => p.uri && p.record?.text)
        .map((p) => ({
          provider: this.provider,
          resourceType: "social_post" as const,
          title: p.record!.text!.slice(0, 120),
          authors: p.author?.displayName || p.author?.handle ? [p.author.displayName || p.author!.handle!] : [],
          year: p.record?.createdAt ? Number(p.record.createdAt.slice(0, 4)) || null : null,
          url: p.author?.handle ? `https://bsky.app/profile/${p.author.handle}` : null,
          doi: null,
          isbn: null,
          snippet: p.record!.text!.slice(0, 400),
          venue: "Bluesky",
          popularity: null,
          raw: p,
        }));
      return { resources };
    });
  }
}
