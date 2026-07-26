import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCorpusProvider, lookupCorpusItemById, normalizeCorpusItem, searchCorpusCandidates, type CorpusProvider } from "./corpusImport";
import type { AdapterResult, ProviderAttempt, RawResource, SourceAdapter } from "./types";

function attempt(provider: ProviderAttempt["provider"], resultCount: number): ProviderAttempt {
  return { provider, status: "queried", queries: ["q"], resultCount, inspectionDepth: 0, latencyMs: 1 };
}

function fakeAdapter(provider: SourceAdapter["provider"], resources: RawResource[]): SourceAdapter {
  return {
    provider,
    isEnabled: () => true,
    async search(): Promise<AdapterResult> {
      return { attempt: attempt(provider, resources.length), resources };
    },
  };
}

const heideggerFromS2: RawResource = {
  provider: "semanticscholar",
  resourceType: "article",
  title: "Being and Time",
  authors: ["Martin Heidegger"],
  year: 1927,
  url: "https://doi.org/10.1000/abc",
  doi: "10.1000/abc",
  isbn: null,
  snippet: "An abstract from Semantic Scholar.",
  venue: "Journal of Phenomenology",
  popularity: 42,
  raw: { paperId: "s2-paper-id-1" },
};

const heideggerFromOpenAlex: RawResource = {
  provider: "openalex",
  resourceType: "article",
  title: "Being and Time",
  authors: ["Martin Heidegger"],
  year: 1927,
  url: "https://doi.org/10.1000/abc",
  // Same DOI as the Semantic Scholar record above — this is the case
  // `normalizedKey` dedup is meant to collapse.
  doi: "10.1000/abc",
  isbn: null,
  snippet: null,
  venue: "Journal of Phenomenology",
  popularity: 999,
  raw: { id: "https://openalex.org/W2031754690" },
};

const arxivPaper: RawResource = {
  provider: "arxiv",
  resourceType: "article",
  title: "A Study of Electron Behavior in Confined Systems",
  authors: ["Jane Doe"],
  year: 2023,
  url: "https://arxiv.org/abs/2301.12345v2",
  doi: null,
  isbn: null,
  snippet: "We study the behavior of electrons in confined quantum systems.",
  venue: "arXiv",
  popularity: null,
  raw: { arxivId: "2301.12345v2" },
};

describe("searchCorpusCandidates", () => {
  it("fans out to all three providers and dedups an identical DOI across two of them", async () => {
    const result = await searchCorpusCandidates("being and time heidegger", {
      limit: 10,
      adapters: {
        semanticscholar: fakeAdapter("semanticscholar", [heideggerFromS2]),
        openalex: fakeAdapter("openalex", [heideggerFromOpenAlex]),
        arxiv: fakeAdapter("arxiv", [arxivPaper]),
      },
    });
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts.map((a) => a.provider).sort()).toEqual(["arxiv", "openalex", "semanticscholar"]);
    // Two DOI-identical records collapse to one candidate; the arXiv paper
    // (a distinct DOI-less work) survives as its own candidate.
    expect(result.candidates).toHaveLength(2);
    const being = result.candidates.find((c) => c.title === "Being and Time");
    expect(being).toBeDefined();
    // dedupeResources keeps the richer record verbatim (Semantic Scholar's,
    // since it alone carries a snippet) rather than merging every field —
    // `popularity` is one of the fields it deliberately does NOT backfill
    // from the dropped duplicate, so the survivor's own value (42) wins,
    // not OpenAlex's higher one (999). Never invents a blended number.
    expect(being?.popularity).toBe(42);
    expect(being?.provider).toBe("semanticscholar");
  });

  it("reports every provider's attempt honestly even when all of them return nothing", async () => {
    const result = await searchCorpusCandidates("an obscure query", {
      limit: 5,
      adapters: {
        semanticscholar: fakeAdapter("semanticscholar", []),
        openalex: fakeAdapter("openalex", []),
        arxiv: fakeAdapter("arxiv", []),
      },
    });
    expect(result.candidates).toHaveLength(0);
    expect(result.attempts).toHaveLength(3);
    expect(result.attempts.every((a) => a.status === "queried")).toBe(true);
  });

  it("caps the merged result at the requested limit", async () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      ...heideggerFromS2,
      title: `Work ${i}`,
      doi: `10.1000/work-${i}`,
      raw: { paperId: `s2-${i}` },
    }));
    const result = await searchCorpusCandidates("many works", {
      limit: 3,
      adapters: {
        semanticscholar: fakeAdapter("semanticscholar", many),
        openalex: fakeAdapter("openalex", []),
        arxiv: fakeAdapter("arxiv", []),
      },
    });
    expect(result.candidates).toHaveLength(3);
  });
});

describe("isCorpusProvider", () => {
  it("accepts exactly the three corpus providers", () => {
    expect(isCorpusProvider("semanticscholar")).toBe(true);
    expect(isCorpusProvider("openalex")).toBe(true);
    expect(isCorpusProvider("arxiv")).toBe(true);
    expect(isCorpusProvider("tavily")).toBe(false);
    expect(isCorpusProvider("not-a-provider")).toBe(false);
  });
});

describe("lookupCorpusItemById dispatch", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.ARXIV_MIN_INTERVAL_MS = "0";
  });
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
    delete process.env.ARXIV_MIN_INTERVAL_MS;
  });

  const providerHosts: Record<CorpusProvider, string> = {
    semanticscholar: "api.semanticscholar.org",
    openalex: "api.openalex.org",
    arxiv: "export.arxiv.org",
  };

  for (const provider of ["semanticscholar", "openalex", "arxiv"] as const) {
    it(`routes "${provider}" to its own provider's single-record endpoint`, async () => {
      let requestedUrl = "";
      global.fetch = vi.fn(async (url: string | URL) => {
        requestedUrl = url.toString();
        // A body shape that reads as "not found" for every provider's own
        // parser — the point of this test is routing, not full mapping
        // (already covered by the arxiv/scholarly adapter test files).
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`,
        };
      }) as unknown as typeof fetch;

      await lookupCorpusItemById(provider, "some-id");
      expect(requestedUrl).toContain(providerHosts[provider]);
    });
  }
});

describe("normalizeCorpusItem", () => {
  it("copies every field verbatim from a real Semantic Scholar payload — nothing invented", () => {
    const shape = normalizeCorpusItem("semanticscholar", heideggerFromS2);
    expect(shape).toEqual({
      source: "semanticscholar",
      externalId: "s2-paper-id-1",
      dedupKey: "doi:10.1000/abc",
      title: "Being and Time",
      authors: ["Martin Heidegger"],
      year: 1927,
      doi: "10.1000/abc",
      url: "https://doi.org/10.1000/abc",
      abstract: "An abstract from Semantic Scholar.",
      venue: "Journal of Phenomenology",
      raw: heideggerFromS2.raw,
    });
  });

  it("normalizes an OpenAlex payload, extracting the bare id from a full openalex.org URL", () => {
    const shape = normalizeCorpusItem("openalex", heideggerFromOpenAlex);
    expect(shape?.externalId).toBe("W2031754690");
    expect(shape?.source).toBe("openalex");
    // abstract stays null (the fixture supplied no snippet) — never backfilled.
    expect(shape?.abstract).toBeNull();
  });

  it("normalizes an arXiv payload, extracting arxivId from raw and defaulting doi to null", () => {
    const shape = normalizeCorpusItem("arxiv", arxivPaper);
    expect(shape).toMatchObject({ source: "arxiv", externalId: "2301.12345v2", doi: null, venue: "arXiv" });
  });

  it("returns null when the payload carries no derivable external id", () => {
    const noId: RawResource = { ...heideggerFromS2, raw: {} };
    expect(normalizeCorpusItem("semanticscholar", noId)).toBeNull();
  });

  it("returns null when the payload's provider tag doesn't match the requested provider", () => {
    expect(normalizeCorpusItem("openalex" as CorpusProvider, heideggerFromS2)).toBeNull();
  });

  it("returns null when the title is empty (no usable dedup key)", () => {
    const blank: RawResource = { ...arxivPaper, title: "  ", doi: null, url: null, isbn: null };
    expect(normalizeCorpusItem("arxiv", blank)).toBeNull();
  });
});

// Type-level smoke check: lookupCorpusItemById must accept every
// CorpusProvider value without a cast — a missing switch branch would fail
// `tsc`, not just this test.
void ((): void => {
  const _fn: (p: CorpusProvider, id: string) => ReturnType<typeof lookupCorpusItemById> = lookupCorpusItemById;
  void _fn;
})();
