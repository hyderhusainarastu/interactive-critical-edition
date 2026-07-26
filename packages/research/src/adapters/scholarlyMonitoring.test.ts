import { afterEach, describe, expect, it, vi } from "vitest";
import { formatSemanticScholarPaperId, lookupAuthorRecentPapers, lookupCitations } from "./scholarly";

/** Build a mock `fetch` returning a given status + json body for every call. */
function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

/** Build a mock `fetch` answering a fixed sequence of (status, body) pairs,
 *  one per call — for `lookupAuthorRecentPapers`'s two sequential requests. */
function mockFetchSequence(responses: Array<{ status: number; body: unknown }>) {
  let call = 0;
  return vi.fn(async () => {
    const { status, body } = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as unknown as typeof fetch;
}

const opts = { maxResults: 5, timeoutMs: 1000 };

describe("Phase 29.1 monitoring: Semantic Scholar helpers", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  describe("formatSemanticScholarPaperId", () => {
    it("prefixes a bare DOI", () => {
      expect(formatSemanticScholarPaperId("10.1000/abc.def")).toBe("DOI:10.1000/abc.def");
    });
    it("prefixes a bare post-2007 arXiv id", () => {
      expect(formatSemanticScholarPaperId("2101.12345")).toBe("ARXIV:2101.12345");
    });
    it("prefixes a bare legacy arXiv id", () => {
      expect(formatSemanticScholarPaperId("hep-th/9901001")).toBe("ARXIV:hep-th/9901001");
    });
    it("passes through an already-prefixed seed untouched", () => {
      expect(formatSemanticScholarPaperId("DOI:10.1000/abc")).toBe("DOI:10.1000/abc");
      expect(formatSemanticScholarPaperId("ARXIV:2101.12345")).toBe("ARXIV:2101.12345");
    });
    it("passes through a bare S2 paperId untouched (matches neither DOI nor arXiv shape)", () => {
      const s2Id = "649def34f8be52c8b66281af98ae884c09aef38b";
      expect(formatSemanticScholarPaperId(s2Id)).toBe(s2Id);
    });
  });

  describe("lookupCitations", () => {
    it("maps citing papers and reports 'queried'", async () => {
      global.fetch = mockFetch(200, {
        data: [
          {
            citingPaper: {
              paperId: "abc123",
              title: "A Paper That Cites Heidegger",
              authors: [{ name: "Jane Scholar" }],
              year: 2025,
              externalIds: { DOI: "10.1000/citer" },
              citationCount: 3,
              venue: "Journal of Phenomenology",
            },
          },
        ],
      });
      const res = await lookupCitations("DOI:10.1000/abc", opts);
      expect(res.attempt.provider).toBe("semanticscholar");
      expect(res.attempt.status).toBe("queried");
      expect(res.resources).toHaveLength(1);
      expect(res.resources[0]).toMatchObject({
        provider: "semanticscholar",
        title: "A Paper That Cites Heidegger",
        year: 2025,
        doi: "10.1000/citer",
      });
    });

    it("reports an honest empty result (not a failure) on a 404 unknown seed", async () => {
      global.fetch = mockFetch(404, {});
      const res = await lookupCitations("DOI:10.9999/unknown", opts);
      expect(res.attempt.status).toBe("queried");
      expect(res.resources).toHaveLength(0);
    });

    it("reports 'rate_limited' on HTTP 429", async () => {
      global.fetch = mockFetch(429, {});
      const res = await lookupCitations("DOI:10.1000/abc", opts);
      expect(res.attempt.status).toBe("rate_limited");
    });

    it("filters out citing-paper entries with no title", async () => {
      global.fetch = mockFetch(200, {
        data: [{ citingPaper: { title: "", authors: [] } }, { citingPaper: { title: "Has A Title", authors: [] } }],
      });
      const res = await lookupCitations("DOI:10.1000/abc", opts);
      expect(res.resources).toHaveLength(1);
      expect(res.resources[0].title).toBe("Has A Title");
    });
  });

  describe("lookupAuthorRecentPapers", () => {
    it("resolves an author name to an id, then returns their papers sorted newest-first", async () => {
      global.fetch = mockFetchSequence([
        { status: 200, body: { data: [{ authorId: "au1" }] } },
        {
          status: 200,
          body: {
            data: [
              { title: "Older Paper", year: 2019, authors: [{ name: "Jane Scholar" }] },
              { title: "Newest Paper", year: 2025, authors: [{ name: "Jane Scholar" }] },
              { title: "Middle Paper", year: 2022, authors: [{ name: "Jane Scholar" }] },
            ],
          },
        },
      ]);
      const res = await lookupAuthorRecentPapers("Jane Scholar", opts);
      expect(res.attempt.status).toBe("queried");
      expect(res.resources.map((r) => r.title)).toEqual(["Newest Paper", "Middle Paper", "Older Paper"]);
    });

    it("reports an honest empty result when no author matches", async () => {
      global.fetch = mockFetchSequence([{ status: 200, body: { data: [] } }]);
      const res = await lookupAuthorRecentPapers("Nobody Findable", opts);
      expect(res.attempt.status).toBe("queried");
      expect(res.resources).toHaveLength(0);
    });

    it("reports 'unavailable' when the author-search leg 5xx's", async () => {
      global.fetch = mockFetchSequence([{ status: 503, body: {} }]);
      const res = await lookupAuthorRecentPapers("Jane Scholar", opts);
      expect(res.attempt.status).toBe("unavailable");
    });

    it("reports 'unavailable' when the papers leg 5xx's after a successful author match", async () => {
      global.fetch = mockFetchSequence([{ status: 200, body: { data: [{ authorId: "au1" }] } }, { status: 503, body: {} }]);
      const res = await lookupAuthorRecentPapers("Jane Scholar", opts);
      expect(res.attempt.status).toBe("unavailable");
    });
  });
});
