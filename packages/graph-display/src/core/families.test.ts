import { describe, expect, it } from "vitest";
import {
  AI_INFERRED_OPACITY_MULTIPLIER,
  KNOWN_EDGE_VALUES,
  UNDIRECTED_EDGE_VALUES,
  classifyEdgeFamily,
  isUndirectedEdgeValue,
  validateLinkDirection,
} from "./families";
import { DISPLAY_EDGE_FAMILIES } from "./types";
import { ALL_EMITTED_EDGE_VALUES } from "./testFixtures";

describe("classifyEdgeFamily — exhaustiveness over the audited emitted set", () => {
  it("classifies every currently-emitted edgeType value into a real family, never unclassified", () => {
    for (const value of ALL_EMITTED_EDGE_VALUES) {
      const result = classifyEdgeFamily(value, null);
      expect(result.family, `edgeType="${value}" unexpectedly unclassified`).not.toBe("unclassified");
      expect(DISPLAY_EDGE_FAMILIES).toContain(result.family);
    }
  });

  it("KNOWN_EDGE_VALUES is a superset of every currently-emitted value", () => {
    for (const value of ALL_EMITTED_EDGE_VALUES) {
      expect(KNOWN_EDGE_VALUES).toContain(value);
    }
  });

  it("maps the charter's exact relationship-category table", () => {
    expect(classifyEdgeFamily("explicit_reference").family).toBe("reference");
    expect(classifyEdgeFamily("secondary_scholarly_recommendation").family).toBe("reference");
    expect(classifyEdgeFamily("historical_context").family).toBe("influence");
    expect(classifyEdgeFamily("prerequisite").family).toBe("prerequisite");
    expect(classifyEdgeFamily("conceptual_influence").family).toBe("influence");
    expect(classifyEdgeFamily("disagreement_polemical_target").family).toBe("opposition");
    expect(classifyEdgeFamily("interpretive_aid").family).toBe("influence");
    expect(classifyEdgeFamily("parallel_comparison").family).toBe("influence");
    expect(classifyEdgeFamily("optional_extension").family).toBe("reference");
  });

  it("maps the charter's exact edge-type-family bullets", () => {
    for (const v of ["cites", "quotes", "is_recommended_by", "review_of", "responds_to", "discovered_source", "supplementary_context"]) {
      expect(classifyEdgeFamily(v).family, v).toBe("reference");
    }
    for (const v of ["presupposes", "is_prerequisite_for"]) {
      expect(classifyEdgeFamily(v).family, v).toBe("prerequisite");
    }
    for (const v of ["influences", "provides_context_for", "interprets", "is_comparable_to", "claim_supports"]) {
      expect(classifyEdgeFamily(v).family, v).toBe("influence");
    }
    for (const v of ["criticizes", "disagrees_with", "claim_contradicts"]) {
      expect(classifyEdgeFamily(v).family, v).toBe("opposition");
    }
    for (const v of ["outline_section", "translates", "is_edition_of", "edition_of", "translation_of", "excerpt_of", "asserts_claim", "in_debate"]) {
      expect(classifyEdgeFamily(v).family, v).toBe("structural");
    }
  });

  it("claim_nuances gets the display-only qualification treatment, not influence", () => {
    expect(classifyEdgeFamily("claim_nuances").family).toBe("qualification");
  });
});

describe("classifyEdgeFamily — ai_inferred provenance overlay", () => {
  it("preserves the underlying semantic family and sets aiInferred, when ai_inferred is the category alongside a real edgeType", () => {
    const result = classifyEdgeFamily("provides_context_for", "ai_inferred");
    expect(result.family).toBe("influence"); // underlying family from edgeType, unchanged
    expect(result.aiInferred).toBe(true);
    if (result.family !== "unclassified") expect(result.matchedOn).toBe("edgeType");
  });

  it("does not create a distinct family for ai_inferred — it is always one of the real five/six families", () => {
    const asEdgeType = classifyEdgeFamily("ai_inferred");
    const asCategory = classifyEdgeFamily("disagrees_with", "ai_inferred");
    expect(DISPLAY_EDGE_FAMILIES).toContain(asEdgeType.family);
    expect(DISPLAY_EDGE_FAMILIES).toContain(asCategory.family);
    expect(asEdgeType.family).not.toBe("ai_inferred" as unknown as string);
  });

  it("handles the audit-finding case: ai_inferred as the literal edgeType itself, with no separate underlying value", () => {
    const result = classifyEdgeFamily("ai_inferred", "ai_inferred");
    expect(result.family).toBe("influence"); // the documented, cited fallback rule
    expect(result.aiInferred).toBe(true);
  });

  it("handles the audit-finding case: optional_extension as the literal edgeType itself", () => {
    const result = classifyEdgeFamily("optional_extension", "optional_extension");
    expect(result.family).toBe("reference");
    expect(result.aiInferred).toBe(false);
  });

  it("aiInferred is false for an edge with no ai_inferred anywhere", () => {
    expect(classifyEdgeFamily("cites", "explicit_reference").aiInferred).toBe(false);
  });

  it("exposes the documented opacity multiplier as a plain data constant", () => {
    expect(AI_INFERRED_OPACITY_MULTIPLIER).toBe(0.7);
  });
});

describe("classifyEdgeFamily — unclassified, never a silent default", () => {
  it("returns 'unclassified' with a diagnostic for a genuinely unknown edgeType and no category", () => {
    const result = classifyEdgeFamily("totally_made_up_edge_type", null);
    expect(result.family).toBe("unclassified");
    if (result.family === "unclassified") {
      expect(result.diagnostic.edgeType).toBe("totally_made_up_edge_type");
      expect(result.diagnostic.category).toBeNull();
      expect(result.diagnostic.reason.length).toBeGreaterThan(0);
    }
  });

  it("falls back from an unknown edgeType to a known category before giving up", () => {
    const result = classifyEdgeFamily("some_unmapped_edge_type", "prerequisite");
    expect(result.family).toBe("prerequisite");
    if (result.family !== "unclassified") expect(result.matchedOn).toBe("category");
  });

  it("returns 'unclassified' when both edgeType and category are unknown", () => {
    const result = classifyEdgeFamily("nope", "also_nope");
    expect(result.family).toBe("unclassified");
  });

  it("handles a null/undefined category without throwing", () => {
    expect(() => classifyEdgeFamily("cites", null)).not.toThrow();
    expect(() => classifyEdgeFamily("cites", undefined)).not.toThrow();
    expect(() => classifyEdgeFamily("cites")).not.toThrow();
  });

  it("handles an empty-string edgeType without throwing (malformed data)", () => {
    expect(() => classifyEdgeFamily("", null)).not.toThrow();
    expect(classifyEdgeFamily("", null).family).toBe("unclassified");
  });
});

describe("UNDIRECTED_EDGE_VALUES / validateLinkDirection", () => {
  it("mirrors the canonical UNDIRECTED_EDGE_TYPES set exactly", () => {
    expect([...UNDIRECTED_EDGE_VALUES].sort()).toEqual(
      ["is_comparable_to", "parallel_comparison", "claim_contradicts", "claim_supports", "claim_nuances"].sort(),
    );
  });

  it("isUndirectedEdgeValue agrees with the set", () => {
    for (const v of UNDIRECTED_EDGE_VALUES) expect(isUndirectedEdgeValue(v)).toBe(true);
    expect(isUndirectedEdgeValue("cites")).toBe(false);
  });

  it("flags a symmetric edge value incorrectly claiming directed:true", () => {
    expect(validateLinkDirection("is_comparable_to", true)).toMatch(/symmetric/);
  });

  it("flags an asymmetric edge value incorrectly claiming directed:false", () => {
    expect(validateLinkDirection("cites", false)).toMatch(/not in UNDIRECTED_EDGE_VALUES/);
  });

  it("returns null (no diagnostic) for consistent direction claims", () => {
    expect(validateLinkDirection("is_comparable_to", false)).toBeNull();
    expect(validateLinkDirection("cites", true)).toBeNull();
  });
});
