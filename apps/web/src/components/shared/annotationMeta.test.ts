import { describe, expect, it } from "vitest";
import { CATEGORY_META, categoryMetaFor, confidenceLabel } from "./annotationMeta";

/**
 * Phase 22.3 residual (D-21-8/D-21-9): `categoryMetaFor` is the safe,
 * generic-string lookup the Visualization inspector uses to decide whether
 * an edge carries one of the 10 relationship categories (and therefore gets
 * the SAME `CATEGORY_META` glyph/label the annotation sidebars render for
 * that category) or must fall back to an honest, undecorated edge-type
 * label. WebGL internals aren't E2E-assertable (same rationale as
 * `graphSceneScaling.test.ts`), so this pure lookup — the part of the fix
 * that actually decides what text appears — is proven here instead. Run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as the
 * other `apps/web/src/components/graph/*.test.ts` files).
 */

describe("categoryMetaFor", () => {
  // A known category resolves to its shared meta, matching what the
  // annotation sidebars (`CATEGORY_META[relationshipCategory]`) already show
  // for the same category — the parity this fix exists to establish.
  it("a known category returns the exact shared meta object", () => {
    expect(categoryMetaFor("explicit_reference")).toBe(CATEGORY_META.explicit_reference);
    expect(categoryMetaFor("explicit_reference")?.label).toBe("Explicit reference");
    expect(categoryMetaFor("disagreement_polemical_target")?.label).toBe("Disagreement");
  });

  // null/undefined — the honest "no category recorded" case (most edges
  // today, per D-21-9) — must not throw and must not fabricate a label.
  it("null/undefined — the honest \"no category recorded\" case — must not throw and must not fabricate a label", () => {
    expect(categoryMetaFor(null)).toBe(undefined);
    expect(categoryMetaFor(undefined)).toBe(undefined);
  });

  // A real, non-relationship-category string `graph.ts` legitimately writes
  // for other edge kinds (source-relation judgments, cross-library review
  // links) must fall back honestly rather than guessing or throwing on an
  // unrecognized key.
  it("a non-relationship-category evidence string falls back honestly rather than guessing or throwing", () => {
    expect(categoryMetaFor("source_provenance")).toBe(undefined);
    expect(categoryMetaFor("cross_library")).toBe(undefined);
    expect(categoryMetaFor("")).toBe(undefined);
  });
});

// confidenceLabel is the other half of the same shared vocabulary the
// inspector reuses (glyph + label + confidence band, never a bare percent
// alone, matching AnnotationCard/PassageAnnotationCard's existing pattern).
describe("confidenceLabel", () => {
  it("bands a confidence into the shared vocabulary the inspector reuses", () => {
    expect(confidenceLabel(0.85)).toBe("High");
    expect(confidenceLabel(0.5)).toBe("Moderate");
    expect(confidenceLabel(0.3)).toBe("Low");
    expect(confidenceLabel(0.1)).toBe("Very low");
  });
});
