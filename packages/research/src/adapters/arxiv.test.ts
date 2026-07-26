import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArxivAdapter, lookupArxivById, parseArxivIdFromEntryUrl } from "./arxiv";

/** Build a mock `fetch` returning a given status + raw text body (arXiv
 *  answers Atom XML, not JSON — `fetchText`, not `fetchJson`). */
function mockFetchText(status: number, body: string) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
  })) as unknown as typeof fetch;
}

const SEARCH_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <link href="http://export.arxiv.org/api/query?search_query=all:electron&amp;start=0&amp;max_results=1" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: search_query=all:electron</title>
  <id>http://arxiv.org/api/abcdef</id>
  <updated>2024-01-01T00:00:00-05:00</updated>
  <opensearch:totalResults>1</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>1</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2301.12345v2</id>
    <updated>2023-02-01T00:00:00Z</updated>
    <published>2023-01-30T00:00:00Z</published>
    <title>A Study of Electron Behavior in
    Confined Systems</title>
    <summary>  We study the behavior of electrons in confined
    quantum systems and derive new bounds.  </summary>
    <author><name>Jane Doe</name></author>
    <author><name>John Q. Smith</name></author>
    <arxiv:doi>10.1103/PhysRevD.99.012345</arxiv:doi>
    <link href="http://arxiv.org/abs/2301.12345v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2301.12345v2" rel="related" type="application/pdf"/>
    <arxiv:primary_category term="quant-ph" scheme="http://arxiv.org/schemas/atom"/>
    <category term="quant-ph" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

const EMPTY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <link href="http://export.arxiv.org/api/query?search_query=all:zzzznothing" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: search_query=all:zzzznothing</title>
  <id>http://arxiv.org/api/ghijkl</id>
  <updated>2024-01-01T00:00:00-05:00</updated>
  <opensearch:totalResults>0</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>0</opensearch:itemsPerPage>
</feed>`;

const ERROR_ENTRY_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <link href="http://export.arxiv.org/api/query?search_query=&amp;id_list=bogus9999" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: id_list=bogus9999</title>
  <id>http://arxiv.org/api/mnopqr</id>
  <updated>2024-01-01T00:00:00-05:00</updated>
  <opensearch:totalResults>1</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>1</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format_for_bogus9999</id>
    <title>Error</title>
    <summary>incorrect id format for bogus9999</summary>
    <updated>2024-01-01T00:00:00-05:00</updated>
  </entry>
</feed>`;

const opts = { maxResults: 5, timeoutMs: 1000 };

describe("ArxivAdapter", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    // No live calls in tests — and no real 3s politeness delay either.
    process.env.ARXIV_MIN_INTERVAL_MS = "0";
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    delete process.env.ARXIV_MIN_INTERVAL_MS;
  });

  it("is enabled with no key (keyless provider)", () => {
    expect(new ArxivAdapter().isEnabled()).toBe(true);
  });

  it("maps a successful search response and reports 'queried'", async () => {
    global.fetch = mockFetchText(200, SEARCH_FEED);
    const res = await new ArxivAdapter().search(["electron confinement"], opts);
    expect(res.attempt.status).toBe("queried");
    expect(res.attempt.resultCount).toBe(1);
    expect(res.resources).toHaveLength(1);
    expect(res.resources[0]).toMatchObject({
      provider: "arxiv",
      resourceType: "article",
      title: "A Study of Electron Behavior in Confined Systems",
      url: "http://arxiv.org/abs/2301.12345v2",
      doi: "10.1103/PhysRevD.99.012345",
      venue: "arXiv",
      year: 2023,
      popularity: null,
    });
    expect(res.resources[0].authors).toEqual(["Jane Doe", "John Q. Smith"]);
    expect(res.resources[0].snippet).toBe("We study the behavior of electrons in confined quantum systems and derive new bounds.");
    expect((res.resources[0].raw as { arxivId: string }).arxivId).toBe("2301.12345v2");
  });

  it("reports 'queried' with zero results on an empty feed", async () => {
    global.fetch = mockFetchText(200, EMPTY_FEED);
    const res = await new ArxivAdapter().search(["zzzznothing matches"], opts);
    expect(res.attempt.status).toBe("queried");
    expect(res.resources).toHaveLength(0);
  });

  it("filters out arXiv's own 'Error' sentinel entry rather than surfacing it as a result", async () => {
    global.fetch = mockFetchText(200, ERROR_ENTRY_FEED);
    const res = await new ArxivAdapter().search(["bogus9999"], opts);
    expect(res.attempt.status).toBe("queried");
    expect(res.resources).toHaveLength(0);
  });

  it("reports 'rate_limited' on HTTP 429", async () => {
    global.fetch = mockFetchText(429, "");
    const res = await new ArxivAdapter().search(["kant critique"], opts);
    expect(res.attempt.status).toBe("rate_limited");
    expect(res.resources).toHaveLength(0);
  });

  it("reports 'unavailable' on a 5xx error", async () => {
    global.fetch = mockFetchText(503, "");
    const res = await new ArxivAdapter().search(["husserl"], opts);
    expect(res.attempt.status).toBe("unavailable");
  });

  it("reports 'failed' with an error message when fetch throws", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const res = await new ArxivAdapter().search(["descartes"], opts);
    expect(res.attempt.status).toBe("failed");
    expect(res.attempt.error).toContain("network down");
  });

  it("respects the politeness throttle between consecutive requests", async () => {
    global.fetch = mockFetchText(200, EMPTY_FEED);
    process.env.ARXIV_MIN_INTERVAL_MS = "50";
    const adapter = new ArxivAdapter();
    const start = Date.now();
    await adapter.search(["first query"], opts);
    await adapter.search(["second query"], opts);
    // Two calls with a 50ms floor between them must take at least ~50ms
    // total — a regression that drops the throttle would run near-instantly.
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it("still spaces out requests when callers overlap concurrently, not just sequentially", async () => {
    // A bare read-then-write throttle lets two calls started in the same
    // tick both observe the same stale `lastRequestAt` and proceed
    // immediately — this is exactly the shape `corpusImport.ts` uses when
    // it fans out several searches at once. Firing three calls with
    // `Promise.all` (not awaited one at a time) must still take at least
    // 2 * the floor, proving they were serialized rather than racing.
    global.fetch = mockFetchText(200, EMPTY_FEED);
    process.env.ARXIV_MIN_INTERVAL_MS = "50";
    const adapter = new ArxivAdapter();
    const start = Date.now();
    await Promise.all([
      adapter.search(["first query"], opts),
      adapter.search(["second query"], opts),
      adapter.search(["third query"], opts),
    ]);
    expect(Date.now() - start).toBeGreaterThanOrEqual(95);
  });
});

describe("lookupArxivById", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.ARXIV_MIN_INTERVAL_MS = "0";
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    delete process.env.ARXIV_MIN_INTERVAL_MS;
  });

  it("resolves a real id to its full metadata", async () => {
    global.fetch = mockFetchText(200, SEARCH_FEED);
    const { resource, attempt } = await lookupArxivById("2301.12345v2");
    expect(attempt.status).toBe("queried");
    expect(resource).not.toBeNull();
    expect(resource?.title).toBe("A Study of Electron Behavior in Confined Systems");
    expect(resource?.doi).toBe("10.1103/PhysRevD.99.012345");
  });

  it("treats arXiv's 'Error' sentinel entry as an honest not-found, not a result", async () => {
    global.fetch = mockFetchText(200, ERROR_ENTRY_FEED);
    const { resource, attempt } = await lookupArxivById("bogus9999");
    expect(attempt.status).toBe("queried");
    expect(resource).toBeNull();
  });

  it("propagates a network failure as an honest 'failed' attempt", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    const { resource, attempt } = await lookupArxivById("2301.12345");
    expect(resource).toBeNull();
    expect(attempt.status).toBe("failed");
  });
});

describe("parseArxivIdFromEntryUrl", () => {
  it("extracts the versioned id from a standard abs URL", () => {
    expect(parseArxivIdFromEntryUrl("http://arxiv.org/abs/2301.12345v2")).toBe("2301.12345v2");
  });
  it("extracts an old-style slash id", () => {
    expect(parseArxivIdFromEntryUrl("http://arxiv.org/abs/hep-th/9901001v1")).toBe("hep-th/9901001v1");
  });
  it("returns null for a non-abs URL or missing input", () => {
    expect(parseArxivIdFromEntryUrl("http://arxiv.org/api/errors#bad")).toBeNull();
    expect(parseArxivIdFromEntryUrl(undefined)).toBeNull();
    expect(parseArxivIdFromEntryUrl(null)).toBeNull();
  });
});
