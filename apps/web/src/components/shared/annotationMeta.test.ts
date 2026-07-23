import assert from "node:assert/strict";
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

// A known category resolves to its shared meta, matching what the
// annotation sidebars (`CATEGORY_META[relationshipCategory]`) already show
// for the same category — the parity this fix exists to establish.
assert.equal(categoryMetaFor("explicit_reference"), CATEGORY_META.explicit_reference, "a known category returns the exact shared meta object");
assert.equal(categoryMetaFor("explicit_reference")?.label, "Explicit reference");
assert.equal(categoryMetaFor("disagreement_polemical_target")?.label, "Disagreement");

// null/undefined — the honest "no category recorded" case (most edges
// today, per D-21-9) — must not throw and must not fabricate a label.
assert.equal(categoryMetaFor(null), undefined, "null category has no meta");
assert.equal(categoryMetaFor(undefined), undefined, "undefined category has no meta");

// A real, non-relationship-category string `graph.ts` legitimately writes
// for other edge kinds (source-relation judgments, cross-library review
// links) must fall back honestly rather than guessing or throwing on an
// unrecognized key.
assert.equal(categoryMetaFor("source_provenance"), undefined, "a non-category evidence string has no meta");
assert.equal(categoryMetaFor("cross_library"), undefined, "another non-category evidence string has no meta");
assert.equal(categoryMetaFor(""), undefined, "an empty string has no meta");

// confidenceLabel is the other half of the same shared vocabulary the
// inspector reuses (glyph + label + confidence band, never a bare percent
// alone, matching AnnotationCard/PassageAnnotationCard's existing pattern).
assert.equal(confidenceLabel(0.85), "High");
assert.equal(confidenceLabel(0.5), "Moderate");
assert.equal(confidenceLabel(0.3), "Low");
assert.equal(confidenceLabel(0.1), "Very low");

console.log("annotationMeta.test.ts: all assertions passed");
