import { describe, expect, it } from "vitest";
import { deriveEdgeCategory } from "@/lib/graph/graphEdgeCategory";

/**
 * D-21-9 regression (fixable half). Run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `matchNoteToBlock.test.ts`/`edgeTypeForRelationshipCategory.test.ts` — this
 * module has no DB import, so it needs no DATABASE_URL).
 */

describe("deriveEdgeCategory", () => {
  // The two real, unambiguous write paths that never set `category` today.
  it("derives a category for the two real write paths that never set one today", () => {
    expect(deriveEdgeCategory("cites", null)).toBe("explicit_reference");
    expect(deriveEdgeCategory("presupposes", null)).toBe("prerequisite");
  });

  // An already-categorized edge (any classification-derived write) is
  // returned unchanged, never overwritten by the derived guess.
  it("returns an already-categorized edge unchanged, never overwritten by the derived guess", () => {
    expect(deriveEdgeCategory("cites", "secondary_scholarly_recommendation")).toBe("secondary_scholarly_recommendation");
    expect(deriveEdgeCategory("influences", "conceptual_influence")).toBe("conceptual_influence");
  });

  // Every other edge_type this function is never asked to guess for stays
  // null — never fabricated — including the empty string edge case.
  it("leaves every other edge_type null rather than fabricating a category", () => {
    for (const edgeType of ["discovered_source", "review_of", "translation_of", "edition_of", "excerpt_of", "outline_section", "responds_to", "is_comparable_to", ""]) {
      // `${edgeType} should not receive a fabricated category`
      expect(deriveEdgeCategory(edgeType, null)).toBe(null);
    }
  });
});
