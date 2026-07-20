import { describe, expect, it } from "vitest";
import type { RawResource } from "@ice/research";
import {
  conservativeInfluenceClassification,
  V3_STAGE_SEQUENCE,
  verifyCreatorFromProviderMetadata,
} from "./v3";

const scholarly: RawResource = {
  provider: "openalex",
  resourceType: "article",
  title: "A study",
  authors: ["Ada Scholar"],
  year: 2020,
  url: "https://example.edu/article",
  doi: "10.1/example",
  isbn: null,
  snippet: "", venue: null, popularity: 99_999_999, raw: {},
};

describe("v3 research sequence", () => {
  it("keeps the approved evidence-producing stage order", () => {
    expect(V3_STAGE_SEQUENCE).toEqual([
      "canonical-identity", "structural-outline", "section-passage-anchors",
      "explicit-citations", "concepts-people-debates", "lane-discovery",
      "relevance-gate", "creator-verification", "citation-graph-expansion",
      "credibility", "claims", "conservative-influence-classification",
    ]);
  });

  it("corroborates a creator only from provider metadata", () => {
    expect(verifyCreatorFromProviderMetadata(scholarly).verification).toBe("scholarly_record");
    // An unbylined university page is honestly institutional; an unbylined
    // open-web record remains anonymous. Neither case receives an invented name.
    expect(verifyCreatorFromProviderMetadata({ ...scholarly, authors: [] }).verification).toBe("institutional");
    expect(verifyCreatorFromProviderMetadata({ ...scholarly, authors: [], url: "https://example.com/post" }).verification).toBe("anonymous");
  });

  it("does not promote an unsupported influence inference", () => {
    expect(conservativeInfluenceClassification("conceptual_influence", "A useful comparison")).toBe("ai_inferred");
    expect(conservativeInfluenceClassification("conceptual_influence", "Its influence on later ethics is explicit.")).toBe("conceptual_influence");
    expect(conservativeInfluenceClassification("historical_context", null)).toBe("historical_context");
  });
});
