import assert from "node:assert/strict";
import { edgeFamilyFor, edgeTypeForRelationshipCategory } from "./types";

/**
 * D-21-7 regression: every one of the 10 `relationship_category` values that
 * `resource_role`/`passage_annotation` rows can carry must resolve to a real
 * `edge_type` string AND land in a sensible edge family — proving the new
 * relation sources need no additional `EDGE_TYPE_FAMILY` cases, because they
 * reuse the exact vocabulary the citation/classification edges already use.
 * Run via `pnpm --filter worker exec tsx <path>` (same convention as
 * `matchNoteToBlock.test.ts` — this module has no DB import, so it needs no
 * DATABASE_URL).
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

for (const [category, expectedFamily] of Object.entries(EXPECTED_FAMILY)) {
  const edgeType = edgeTypeForRelationshipCategory(category);
  assert.ok(edgeType.length > 0, `${category} should map to a non-empty edge_type`);
  const family = edgeFamilyFor(edgeType, category);
  assert.equal(family, expectedFamily, `${category} -> "${edgeType}" should be family "${expectedFamily}", got "${family}"`);
}

// A distinct edge_type must exist for at least the two categories D-21-7's
// e2e fixture exercises, so a passing e2e assertion cannot be explained by
// collapsing into the pre-existing "cites"/"influences" edges.
assert.equal(edgeTypeForRelationshipCategory("prerequisite"), "is_prerequisite_for");
assert.equal(edgeTypeForRelationshipCategory("disagreement_polemical_target"), "disagrees_with");

// Unknown/future category values degrade to a plausible family rather than
// throwing or silently vanishing from the graph payload.
assert.equal(edgeTypeForRelationshipCategory("something_new"), "provides_context_for");
assert.equal(edgeFamilyFor(edgeTypeForRelationshipCategory("something_new"), "something_new"), "influence");

console.log("edgeTypeForRelationshipCategory.test.ts: all assertions passed");
