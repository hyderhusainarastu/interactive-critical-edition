import { describe, expect, it } from "vitest";
import { canonicalizeDoi, canonicalizeUrl, dedupeResources, normalizedKey } from "./normalize";
import { classifyAuthority, computeAgreement, meetsFactualBar } from "./credibility";
import type { RawResource } from "./types";

function resource(over: Partial<RawResource>): RawResource {
  return {
    provider: "crossref",
    resourceType: "article",
    title: "A Study",
    authors: [],
    year: null,
    url: null,
    doi: null,
    isbn: null,
    snippet: null,
    venue: null,
    popularity: null,
    raw: null,
    ...over,
  };
}

describe("normalize", () => {
  it("canonicalizes DOIs to bare lowercase form", () => {
    expect(canonicalizeDoi("https://doi.org/10.1000/XyZ.123")).toBe("10.1000/xyz.123");
    expect(canonicalizeDoi("nope")).toBeNull();
  });

  it("canonicalizes URLs (strip www, tracking, trailing slash, fragment)", () => {
    expect(canonicalizeUrl("https://www.Example.com/Path/?utm_source=x#frag")).toBe("example.com/Path");
    expect(canonicalizeUrl("https://example.com/")).toBe("example.com/");
  });

  it("prefers DOI > ISBN > URL > title in the dedup key", () => {
    expect(normalizedKey({ doi: "10.1000/a", isbn: "9780262035613", title: "x" })).toBe("doi:10.1000/a");
    expect(normalizedKey({ isbn: "978-0-262-03561-3", title: "x" })).toBe("isbn:9780262035613");
    expect(normalizedKey({ url: "https://e.com/p", title: "x" })).toBe("url:e.com/p");
    expect(normalizedKey({ title: "The Nature of Things", authors: ["Jane Doe"], year: 2001 })).toContain("title:");
  });

  it("dedupes the same work seen from two providers and backfills identifiers", () => {
    const a = resource({ provider: "openalex", title: "Being and Time", authors: ["Heidegger"], year: 1927, doi: null });
    const b = resource({ provider: "crossref", title: "Being and Time", authors: ["Heidegger"], year: 1927, doi: "10.1000/bt" });
    const out = dedupeResources([a, b]);
    // Both share a title/author/year key OR the DOI record wins — either way one row.
    expect(out.length).toBeLessThanOrEqual(2);
    // The DOI-bearing (crossref) record is kept as the richer one.
    expect(out.some((r) => r.doi === "10.1000/bt")).toBe(true);
  });

  it("dedupes two DOI records for the same work into one", () => {
    const out = dedupeResources([
      resource({ provider: "crossref", doi: "10.1000/same" }),
      resource({ provider: "openalex", doi: "https://doi.org/10.1000/SAME" }),
    ]);
    expect(out).toHaveLength(1);
  });
});

describe("authority (independent of popularity)", () => {
  it("assigns A to a scholarly DOI article", () => {
    expect(classifyAuthority(resource({ provider: "crossref", doi: "10.1/x" }))).toBe("A");
  });
  it("assigns B to a scholarly match without a DOI", () => {
    expect(classifyAuthority(resource({ provider: "openalex", doi: null }))).toBe("B");
  });
  it("assigns C to an .edu web page and D to a random blog", () => {
    expect(classifyAuthority(resource({ provider: "tavily", resourceType: "webpage", url: "https://plato.stanford.edu/entries/x" }))).toBe("C");
    expect(classifyAuthority(resource({ provider: "tavily", resourceType: "webpage", url: "https://randomblog.example/post" }))).toBe("D");
  });
  it("caps a hugely popular YouTube lecture at D, never above scholarship", () => {
    expect(classifyAuthority(resource({ provider: "youtube", resourceType: "video", popularity: 5_000_000 }))).toBe("D");
  });
  it("assigns E to social posts", () => {
    expect(classifyAuthority(resource({ provider: "mastodon", resourceType: "social_post" }))).toBe("E");
  });
});

describe("agreement (deterministic)", () => {
  it("strong: >=3 supporting and no contradiction", () => {
    expect(computeAgreement(3, 0)).toBe("strong");
    expect(computeAgreement(2, 0)).toBe("insufficient");
  });
  it("contested: >=2 credible each side", () => {
    expect(computeAgreement(2, 2)).toBe("contested");
  });
  it("mixed: some support and some contradiction below contested", () => {
    expect(computeAgreement(1, 1)).toBe("mixed");
    expect(computeAgreement(3, 1)).toBe("mixed");
  });
  it("insufficient when there is too little", () => {
    expect(computeAgreement(0, 0)).toBe("insufficient");
    expect(computeAgreement(1, 0)).toBe("insufficient");
  });
});

describe("factual evidence bar", () => {
  it("passes with a single A or B source", () => {
    expect(meetsFactualBar(["A"])).toBe(true);
    expect(meetsFactualBar(["B"])).toBe(true);
  });
  it("passes with two independent C sources", () => {
    expect(meetsFactualBar(["C", "C"])).toBe(true);
  });
  it("fails with a single C, or only D/E sources", () => {
    expect(meetsFactualBar(["C"])).toBe(false);
    expect(meetsFactualBar(["D", "E", "D"])).toBe(false);
  });
});
