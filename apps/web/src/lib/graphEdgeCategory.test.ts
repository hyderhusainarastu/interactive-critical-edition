import assert from "node:assert/strict";
import { deriveEdgeCategory } from "./graphEdgeCategory";

/**
 * D-21-9 regression (fixable half). Run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `matchNoteToBlock.test.ts`/`edgeTypeForRelationshipCategory.test.ts` — this
 * module has no DB import, so it needs no DATABASE_URL).
 */

// The two real, unambiguous write paths that never set `category` today.
assert.equal(deriveEdgeCategory("cites", null), "explicit_reference");
assert.equal(deriveEdgeCategory("presupposes", null), "prerequisite");

// An already-categorized edge (any classification-derived write) is
// returned unchanged, never overwritten by the derived guess.
assert.equal(deriveEdgeCategory("cites", "secondary_scholarly_recommendation"), "secondary_scholarly_recommendation");
assert.equal(deriveEdgeCategory("influences", "conceptual_influence"), "conceptual_influence");

// Every other edge_type this function is never asked to guess for stays
// null — never fabricated — including the empty string edge case.
for (const edgeType of ["discovered_source", "review_of", "translation_of", "edition_of", "excerpt_of", "outline_section", "responds_to", "is_comparable_to", ""]) {
  assert.equal(deriveEdgeCategory(edgeType, null), null, `${edgeType} should not receive a fabricated category`);
}

console.log("graphEdgeCategory.test.ts: all assertions passed");
