import { XMLParser } from "fast-xml-parser";
import { providerEnabled } from "../config";
import type { AdapterResult, AdapterSearchOptions, ProviderAttempt, RawResource, SourceAdapter } from "../types";
import { disabledAttempt, fetchText, runAttempt, userAgent } from "./base";

/**
 * arXiv adapter (Phase 28.2). Keyless, over the free Atom-XML
 * `export.arxiv.org/api/query` endpoint (docs: https://info.arxiv.org/help/api/index.html).
 * Two entry points:
 *  - `ArxivAdapter` implements the house `SourceAdapter` contract
 *    (`search()`), matching `scholarly.ts`'s keyless-provider style, for
 *    corpus-search fan-out (`corpusImport.ts`'s `searchCorpusCandidates`).
 *  - `lookupArxivById()` is a direct-by-id metadata fetch — corpus import's
 *    "fetch full metadata by id from its provider" step, since `search()`
 *    only ever returns ranked/fuzzy matches, never a guaranteed exact record.
 *
 * Both share ONE politeness throttle: arXiv's API Terms of Use ask for at
 * least 3 seconds between requests to this endpoint. Deliberately NOT added
 * to `adapters/index.ts`'s `allAdapters()`/`enabledAdapters()` — this
 * adapter powers corpus import only, not the general per-document discovery
 * pipeline (`discover.ts`), so its existence changes no existing analysis
 * run's behavior or cost.
 */

const ARXIV_API_BASE = "https://export.arxiv.org/api/query";

/** Minimum spacing between requests to `export.arxiv.org`, shared by every
 *  caller in this module (both `search()` and `lookupArxivById()` hit the
 *  same host). Env-overridable so tests can run with zero delay — read
 *  fresh on every call rather than captured once at module load. */
function minIntervalMs(): number {
  return Number(process.env.ARXIV_MIN_INTERVAL_MS ?? 3000);
}

let lastRequestAt = 0;

/** Serializes every `politeThrottle()` call onto one promise chain so
 *  concurrent callers (e.g. `corpusImport.ts` fanning out several searches
 *  at once) can never both read `lastRequestAt` before either has written
 *  it back — a bare read-then-write here would let two callers observe the
 *  same stale timestamp and both proceed immediately, defeating the
 *  politeness floor entirely under concurrency. Chaining onto
 *  `throttleChain` (rather than a `Promise.resolve()` local) means each
 *  call's read/wait/write happens strictly after the previous call's,
 *  regardless of how many callers invoke this at once. `.catch(() => {})`
 *  keeps the chain alive even if a link somehow rejects, since a wedged
 *  chain would silently disable throttling for every future caller. */
let throttleChain: Promise<void> = Promise.resolve();
function politeThrottle(): Promise<void> {
  const turn = throttleChain.then(async () => {
    const wait = lastRequestAt + minIntervalMs() - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  throttleChain = turn.catch(() => {});
  return turn;
}

// fast-xml-parser's normal (non-preserveOrder) mode is enough for Atom's flat
// per-entry shape — no need for `grobid.ts`'s preserveOrder tree-walking.
// `removeNSPrefix` turns "arxiv:doi"/"arxiv:primary_category" into plain
// "doi"/"primary_category" since this feed only ever uses one non-default
// namespace and there is no collision risk with the base Atom fields.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  isArray: (name) => ["entry", "author", "link", "category"].includes(name),
});

interface ArxivAuthor {
  name?: string;
}
interface ArxivLink {
  "@_href"?: string;
  "@_rel"?: string;
  "@_title"?: string;
  "@_type"?: string;
}
interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: ArxivAuthor[];
  link?: ArxivLink[];
  /** Only present for the (rare) arXiv paper carrying a registered DOI. */
  doi?: string;
}
interface ArxivFeed {
  feed?: { entry?: ArxivEntry[] };
}

const collapse = (s: string | undefined | null): string => (s ?? "").replace(/\s+/g, " ").trim();

/** Extracts the bare arXiv id (with version, e.g. "2301.12345v2") from an
 *  Atom entry's `<id>` URL (e.g. "http://arxiv.org/abs/2301.12345v2"). Also
 *  handles the old slash-form ids (e.g. "hep-th/9901001v1"), since everything
 *  after "/abs/" is kept verbatim either way. */
export function parseArxivIdFromEntryUrl(entryId: string | undefined | null): string | null {
  if (!entryId) return null;
  // Deliberately allows an internal "/" — the old slash-form category ids
  // (e.g. "hep-th/9901001v1") have one, unlike the modern form
  // ("2301.12345v2"); only "?"/"#" end the id.
  const m = entryId.match(/\/abs\/([^?#]+)/);
  return m ? m[1] : null;
}

/** True for arXiv's own "invalid id" sentinel entry: for a malformed/unknown
 *  `id_list` value the API answers 200 OK with a single entry whose `<id>`
 *  is an `arxiv.org/api/errors` URL and `<title>Error</title>`, never an
 *  HTTP error status — this is the honest "not found" signal to look for. */
function isErrorEntry(entry: ArxivEntry): boolean {
  return Boolean(entry.id?.includes("arxiv.org/api/errors")) || collapse(entry.title) === "Error";
}

function entryToResource(entry: ArxivEntry): RawResource | null {
  const arxivId = parseArxivIdFromEntryUrl(entry.id);
  const title = collapse(entry.title);
  if (!arxivId || !title) return null;
  const links = entry.link ?? [];
  const htmlLink = links.find((l) => l["@_rel"] === "alternate")?.["@_href"];
  const authors = (entry.author ?? []).map((a) => collapse(a.name)).filter(Boolean);
  const year = entry.published ? Number(entry.published.slice(0, 4)) || null : null;
  return {
    provider: "arxiv",
    resourceType: "article",
    title,
    authors,
    year,
    url: htmlLink ?? `https://arxiv.org/abs/${arxivId}`,
    doi: entry.doi ? entry.doi.trim() : null,
    isbn: null,
    snippet: entry.summary ? collapse(entry.summary).slice(0, 600) : null,
    venue: "arXiv",
    // arXiv's Atom feed carries no citation/view count — an honest "no
    // popularity signal", never guessed.
    popularity: null,
    // `arxivId` is kept on the raw payload (it is not part of the shared
    // `RawResource` shape) so `corpusImport.ts` can recover the provider's
    // own id without re-deriving it from the URL a second time.
    raw: { ...entry, arxivId },
  };
}

function parseFeed(xml: string): ArxivEntry[] {
  const parsed = xmlParser.parse(xml) as ArxivFeed;
  return parsed.feed?.entry ?? [];
}

export class ArxivAdapter implements SourceAdapter {
  readonly provider = "arxiv" as const;
  isEnabled() {
    return providerEnabled(this.provider);
  }
  async search(queries: string[], opts: AdapterSearchOptions): Promise<AdapterResult> {
    if (!this.isEnabled()) return disabledAttempt(this.provider);
    return runAttempt(this.provider, queries, async () => {
      const q = queries.find((s) => s.trim().length > 3) ?? "";
      await politeThrottle();
      const params = new URLSearchParams({
        search_query: `all:${q}`,
        start: "0",
        max_results: String(opts.maxResults),
      });
      const { ok, status, data, error } = await fetchText(`${ARXIV_API_BASE}?${params}`, {
        headers: { "User-Agent": userAgent() },
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
      });
      if (!ok) return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429, error };
      let entries: ArxivEntry[];
      try {
        entries = parseFeed(data ?? "");
      } catch (err) {
        return { resources: [], failed: true, error: err instanceof Error ? err.message : String(err) };
      }
      const resources = entries
        .filter((e) => !isErrorEntry(e))
        .map(entryToResource)
        .filter((r): r is RawResource => r !== null);
      return { resources };
    });
  }
}

/**
 * Direct-by-id metadata fetch (corpus import's "fetch full metadata by id"
 * step) — arXiv's `id_list` query mode returns at most one entry. Mirrors
 * `ArxivAdapter.search()`'s honest-attempt/throttle discipline but returns a
 * single resolved resource (or null) rather than a ranked list.
 */
export async function lookupArxivById(
  arxivId: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ resource: RawResource | null; attempt: ProviderAttempt }> {
  if (!providerEnabled("arxiv")) {
    return { resource: null, attempt: disabledAttempt("arxiv").attempt };
  }
  const result = await runAttempt("arxiv", [arxivId], async () => {
    await politeThrottle();
    const params = new URLSearchParams({ id_list: arxivId });
    const { ok, status, data, error } = await fetchText(`${ARXIV_API_BASE}?${params}`, {
      headers: { "User-Agent": userAgent() },
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
    });
    if (!ok) return { resources: [], rateLimited: status === 429, failed: status === 0, unavailable: status > 0 && status !== 429, error };
    let entries: ArxivEntry[];
    try {
      entries = parseFeed(data ?? "");
    } catch (err) {
      return { resources: [], failed: true, error: err instanceof Error ? err.message : String(err) };
    }
    const entry = entries[0];
    if (!entry || isErrorEntry(entry)) return { resources: [] };
    const resource = entryToResource(entry);
    return { resources: resource ? [resource] : [] };
  });
  return { resource: result.resources[0] ?? null, attempt: result.attempt };
}
