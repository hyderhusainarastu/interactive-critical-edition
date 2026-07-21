import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CrossrefAdapter, OpenAlexAdapter, SemanticScholarAdapter } from "./scholarly";
import { TavilyAdapter, YouTubeAdapter } from "./web";
import { MastodonAdapter } from "./social";

/** Build a mock `fetch` returning a given status + json body. */
function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

const opts = { maxResults: 5, timeoutMs: 1000 };

describe("scholarly adapter contract", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("maps a successful Crossref response and reports 'queried'", async () => {
    global.fetch = mockFetch(200, {
      message: {
        items: [
          {
            DOI: "10.1000/abc",
            title: ["Being and Time"],
            author: [{ given: "Martin", family: "Heidegger" }],
            issued: { "date-parts": [[1927]] },
            type: "book",
            "is-referenced-by-count": 999,
          },
        ],
      },
    });
    const res = await new CrossrefAdapter().search(["Heidegger Being and Time"], opts);
    expect(res.attempt.status).toBe("queried");
    expect(res.attempt.resultCount).toBe(1);
    expect(res.resources[0]).toMatchObject({
      provider: "crossref",
      resourceType: "book",
      title: "Being and Time",
      doi: "10.1000/abc",
      popularity: 999,
    });
    expect(res.resources[0].authors).toContain("Martin Heidegger");
  });

  it("reports 'queried' with zero results on an empty response", async () => {
    global.fetch = mockFetch(200, { message: { items: [] } });
    const res = await new CrossrefAdapter().search(["nothing matches xyzzy"], opts);
    expect(res.attempt.status).toBe("queried");
    expect(res.resources).toHaveLength(0);
  });

  it("reports 'rate_limited' on HTTP 429", async () => {
    global.fetch = mockFetch(429, {});
    const res = await new SemanticScholarAdapter().search(["kant critique"], opts);
    expect(res.attempt.status).toBe("rate_limited");
    expect(res.resources).toHaveLength(0);
  });

  it("reports 'unavailable' on a 5xx error", async () => {
    global.fetch = mockFetch(503, {});
    const res = await new OpenAlexAdapter().search(["husserl"], opts);
    expect(res.attempt.status).toBe("unavailable");
  });

  it("reports 'failed' with an error message when fetch throws", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const res = await new CrossrefAdapter().search(["descartes"], opts);
    expect(res.attempt.status).toBe("failed");
    expect(res.attempt.error).toContain("network down");
  });

  it("records latency and echoes the queries on every attempt", async () => {
    global.fetch = mockFetch(200, { message: { items: [] } });
    const res = await new CrossrefAdapter().search(["a query"], opts);
    expect(res.attempt.queries).toEqual(["a query"]);
    expect(res.attempt.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("keyed adapters are honestly 'disabled' without a key", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    delete process.env.TAVILY_API_KEY;
    delete process.env.YOUTUBE_API_KEY;
    delete process.env.MASTODON_INSTANCE_URL;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("Tavily is disabled and never calls fetch without a key", async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    const t = new TavilyAdapter();
    expect(t.isEnabled()).toBe(false);
    const res = await t.search(["x"], opts);
    expect(res.attempt.status).toBe("disabled");
    expect(spy).not.toHaveBeenCalled();
  });

  it("YouTube and Mastodon are disabled without their config", async () => {
    expect(new YouTubeAdapter().isEnabled()).toBe(false);
    expect(new MastodonAdapter().isEnabled()).toBe(false);
    expect((await new YouTubeAdapter().search(["x"], opts)).attempt.status).toBe("disabled");
  });
});

describe("keyed adapters activate when configured", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    delete process.env.TAVILY_API_KEY;
    global.fetch = realFetch;
  });

  it("Tavily becomes enabled and maps results when a key is present", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    global.fetch = mockFetch(200, {
      results: [{ title: "SEP: Phenomenology", url: "https://plato.stanford.edu/entries/phenomenology", content: "..." }],
    });
    const t = new TavilyAdapter();
    expect(t.isEnabled()).toBe(true);
    const res = await t.search(["phenomenology"], opts);
    expect(res.attempt.status).toBe("queried");
    expect(res.resources[0]).toMatchObject({ provider: "tavily", resourceType: "webpage" });
  });

  it("retains public Reddit result metadata through Tavily without a Reddit adapter", async () => {
    process.env.TAVILY_API_KEY = "test-key";
    global.fetch = mockFetch(200, {
      results: [{ title: "A useful discussion", url: "https://www.reddit.com/r/askphilosophy/comments/example", content: "Search snippet only" }],
    });
    const res = await new TavilyAdapter().search(["aristotle virtue reddit"], opts);
    expect(res.resources[0]).toMatchObject({
      provider: "tavily",
      resourceType: "social_post",
      venue: "Reddit (web search result)",
      snippet: "Search snippet only",
    });
  });
});
