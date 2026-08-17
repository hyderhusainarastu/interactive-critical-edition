import { describe, expect, it } from "vitest";
import { edgeFamilyFor, edgeTypeForRelationshipCategory } from "./edgeTypeForRelationshipCategory";

/**
 * D-21-7 regression: every one of the 10 `relationship_category` values that
 * `resource_role`/`passage_annotation` rows can carry must resolve to a real
 * `edge_type` string AND land in a sensible edge family — proving the new
 * relation sources need no additional `EDGE_TYPE_FAMILY` cases, because they
 * reuse the exact vocabulary the citation/classification edges already use.
 */
const EXPECTED_FAMILY: Record<string, string> = {
  explicit_reference: "reference",
  secondary_scholarly_recommendation: "reference",
  historical_context: "influence",
  prerequisite: "prerequisite",
  conceptual_influence: "influence",
  disagreement_polemical_target: "opposition",
  interpretive_aid: "influence",
  parallel_comparison: "influence",
  optional_extension: "reference",
  ai_inferred: "influence",
};

describe("edgeTypeForRelationshipCategory", () => {
  /**
   * D-21-7 regression: every one of the 10 `relationship_category` values that
   * `resource_role`/`passage_annotation` rows can carry must resolve to a real
   * `edge_type` string AND land in a sensible edge family — proving the new
   * relation sources need no additional `EDGE_TYPE_FAMILY` cases, because they
   * reuse the exact vocabulary the citation/classification edges already use.
   */
  for (const [category, expectedFamily] of Object.entries(EXPECTED_FAMILY)) {
    it(`${category} maps to a non-empty edge_type in the "${expectedFamily}" family`, () => {
      const edgeType = edgeTypeForRelationshipCategory(category);
      // `${category} should map to a non-empty edge_type`
      expect(edgeType.length > 0).toBeTruthy();
      const family = edgeFamilyFor(edgeType, category);
      // `${category} -> "${edgeType}" should be family "${expectedFamily}", got "${family}"`
      expect(family).toBe(expectedFamily);
    });
  }

  // A distinct edge_type must exist for at least the two categories D-21-7's
  // e2e fixture exercises, so a passing e2e assertion cannot be explained by
  // collapsing into the pre-existing "cites"/"influences" edges.
  it("gives the two D-21-7 e2e-fixture categories their own distinct edge types", () => {
    expect(edgeTypeForRelationshipCategory("prerequisite")).toBe("is_prerequisite_for");
    expect(edgeTypeForRelationshipCategory("disagreement_polemical_target")).toBe("disagrees_with");
  });

  // Unknown/future category values degrade to a plausible family rather than
  // throwing or silently vanishing from the graph payload.
  it("degrades an unknown/future category to a plausible edge type and family rather than throwing", () => {
    expect(edgeTypeForRelationshipCategory("something_new")).toBe("provides_context_for");
    expect(edgeFamilyFor(edgeTypeForRelationshipCategory("something_new"), "something_new")).toBe("influence");
  });
});
