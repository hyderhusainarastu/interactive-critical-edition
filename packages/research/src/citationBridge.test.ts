import { describe, expect, it } from "vitest";
import { buildCitationBridgeResource, parseCitationAuthors, shouldBridgeCitationToResearchResource } from "./citationBridge";

describe("shouldBridgeCitationToResearchResource", () => {
  it("bridges genuine document-cited references", () => {
    expect(shouldBridgeCitationToResearchResource("bibliography")).toBe(true);
    expect(shouldBridgeCitationToResearchResource("footnote")).toBe(true);
    expect(shouldBridgeCitationToResearchResource("endnote")).toBe(true);
  });
  it("does not bridge a bare inline mention", () => {
    expect(shouldBridgeCitationToResearchResource("inline")).toBe(false);
  });
});

describe("parseCitationAuthors", () => {
  it("splits a semicolon-separated author string", () => {
    expect(parseCitationAuthors("Julia Annas; Terence Irwin")).toEqual(["Julia Annas", "Terence Irwin"]);
  });
  it("returns an empty array for null", () => {
    expect(parseCitationAuthors(null)).toEqual([]);
  });
});

describe("buildCitationBridgeResource (floors-capability-proposal §2.3)", () => {
  const base = {
    runId: "11111111-1111-1111-1111-111111111111",
    citationId: "22222222-2222-2222-2222-222222222222",
    bibId: "33333333-3333-3333-3333-333333333333",
    match: {
      source: "crossref",
      title: "Plato and Aristotle on Friendship and Altruism",
      authors: "Julia Annas",
      year: 1977,
      doi: "10.1093/MIND/LXXXVI.344.532",
      url: "https://academic.oup.com/mind/article/86/344/532",
    },
  };

  it("reuses the already-resolved fields — no new data invented", () => {
    const row = buildCitationBridgeResource(base);
    expect(row.title).toBe(base.match.title);
    expect(row.year).toBe(1977);
    expect(row.authors).toEqual(["Julia Annas"]);
    expect(row.bibRecordId).toBe(base.bibId);
    expect(row.runId).toBe(base.runId);
    expect(row.doi).toBe("10.1093/mind/lxxxvi.344.532"); // canonicalized, not re-derived
  });

  it("marks the row visibly citation-grounded, never a bare provider name (Library/graph honesty)", () => {
    const row = buildCitationBridgeResource(base);
    expect(row.provider).toBe("citation-resolution:crossref");
    expect(row.provider.startsWith("citation-resolution:")).toBe(true);
    // Preserves the underlying source for audit rather than discarding it.
    expect(row.provider).toContain("crossref");
  });

  it("carries no fabricated credibility/authority signal — the shape has none to fabricate", () => {
    const row = buildCitationBridgeResource(base);
    expect(row).not.toHaveProperty("authority");
    expect(row).not.toHaveProperty("credibility");
    expect(row).not.toHaveProperty("score");
  });

  it("records honest provenance in raw — traceable to the exact citation and original source", () => {
    const row = buildCitationBridgeResource(base);
    expect(row.raw).toEqual({
      bridgedFrom: "citation-resolution",
      citationId: base.citationId,
      originalSource: "crossref",
    });
  });

  it("computes a normalizedKey identical to the discovery pipeline's own scheme (DOI takes precedence)", () => {
    const row = buildCitationBridgeResource(base);
    expect(row.normalizedKey).toBe("doi:10.1093/mind/lxxxvi.344.532");
  });

  it("falls back to a title/author/year key when there is no DOI", () => {
    const row = buildCitationBridgeResource({
      ...base,
      match: { ...base.match, doi: null, url: null },
    });
    expect(row.normalizedKey).toMatch(/^title:/);
  });

  it("marks accessStatus honestly as metadata-only — no content was retrieved", () => {
    const row = buildCitationBridgeResource(base);
    expect(row.accessStatus).toBe("metadata_only");
    expect(row.resourceType).toBe("bibliographic");
  });

  it("preserves distinct original-source provenance for a catalogue-reuse match", () => {
    const row = buildCitationBridgeResource({ ...base, match: { ...base.match, source: "catalog:openalex" } });
    expect(row.provider).toBe("citation-resolution:catalog:openalex");
  });
});
