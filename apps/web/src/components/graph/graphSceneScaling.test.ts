import assert from "node:assert/strict";
import {
  REFERENCE_CAMERA_DISTANCE,
  SECONDARY_LABEL_HIDE_DISTANCE,
  edgeDirectionCue,
  edgeLabelVisible,
  edgeRelationLabel,
  nodeScaleForDistance,
} from "./graphSceneScaling";

/**
 * Phase 21.4/21.5 regression (D-21-3, D-21-4, D-21-9's UI half, direction-cue
 * gap). WebGL internals aren't E2E-assertable, so every deterministic
 * decision the 3D scene makes lives in `graphSceneScaling.ts` as a pure
 * function and is proven here instead. Run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `edgeTypeForRelationshipCategory.test.ts` — no DB import, no DATABASE_URL
 * needed).
 */

// --- nodeScaleForDistance -----------------------------------------------

// At the reference distance, every factor is exactly neutral (1).
{
  const scale = nodeScaleForDistance(REFERENCE_CAMERA_DISTANCE);
  assert.equal(scale.labelScaleFactor, 1);
  assert.equal(scale.nodeScaleFactor, 1);
  assert.equal(scale.secondaryLabelVisible, true);
}

// Zoomed in very close: both factors clamp at their floor, never go
// negative or unbounded — "grows on zoom-in to a comfortable max then
// stops" is really "the compensation factor bottoms out," which nets to a
// bounded on-screen size given the scene's own perspective growth.
{
  const scale = nodeScaleForDistance(1);
  assert.ok(scale.labelScaleFactor > 0);
  assert.ok(scale.nodeScaleFactor > 0);
  assert.equal(scale.secondaryLabelVisible, true);
}

// Zoomed in at exactly 0 or a negative/NaN distance (camera not ready, or a
// non-browser test harness) degrades to the reference/neutral scale rather
// than NaN or a crash.
for (const bad of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
  const scale = nodeScaleForDistance(bad);
  assert.equal(scale.labelScaleFactor, 1, `distance ${bad} should degrade to neutral label scale`);
  assert.equal(scale.nodeScaleFactor, 1, `distance ${bad} should degrade to neutral node scale`);
}

// Zoomed far out: both factors clamp at their ceiling (never grow
// unbounded), and the secondary label line hides BEFORE the label-scale
// compensation itself saturates — the "hide secondary before shrinking
// primary" ordering, proven numerically rather than asserted by comment.
{
  const farBeforeHide = nodeScaleForDistance(SECONDARY_LABEL_HIDE_DISTANCE - 1);
  assert.equal(farBeforeHide.secondaryLabelVisible, true);
  const farAtHide = nodeScaleForDistance(SECONDARY_LABEL_HIDE_DISTANCE);
  assert.equal(farAtHide.secondaryLabelVisible, false);
  const veryFar = nodeScaleForDistance(100000);
  assert.equal(veryFar.secondaryLabelVisible, false);
  const atSaturationDistance = nodeScaleForDistance(REFERENCE_CAMERA_DISTANCE * 1.8);
  assert.equal(veryFar.labelScaleFactor, atSaturationDistance.labelScaleFactor, "label scale factor must stay clamped at its ceiling, never keep growing past very far distances");
  // The distance at which labelScaleFactor saturates at its ceiling must be
  // AFTER the secondary-hide distance, so secondary hides while primary
  // compensation is still doing useful work, not only once it's already
  // given up.
  const saturationDistance = REFERENCE_CAMERA_DISTANCE * 1.8; // LABEL_SCALE_MAX
  assert.ok(SECONDARY_LABEL_HIDE_DISTANCE < saturationDistance, "secondary must hide before label-scale compensation saturates");
}

// Monotonic non-decreasing in distance across the whole clamped range —
// nothing "bounces."
{
  const samples = [1, 50, 100, 150, 260, 300, 400, 420, 500, 1000].map(nodeScaleForDistance);
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].labelScaleFactor >= samples[i - 1].labelScaleFactor - 1e-9, "labelScaleFactor must be monotonic non-decreasing in distance");
    assert.ok(samples[i].nodeScaleFactor >= samples[i - 1].nodeScaleFactor - 1e-9, "nodeScaleFactor must be monotonic non-decreasing in distance");
  }
}

// --- edgeLabelVisible ----------------------------------------------------

assert.equal(edgeLabelVisible(REFERENCE_CAMERA_DISTANCE, false), false, "never visible when not highlighted, regardless of distance");
assert.equal(edgeLabelVisible(REFERENCE_CAMERA_DISTANCE, true), true, "visible when highlighted and within the legible distance");
assert.equal(edgeLabelVisible(SECONDARY_LABEL_HIDE_DISTANCE, true), false, "hides past the same density/zoom threshold as the secondary node label");
assert.equal(edgeLabelVisible(Number.NaN, true), true, "an invalid distance degrades to the reference (visible) case, not a crash");

// --- edgeDirectionCue ----------------------------------------------------

assert.equal(edgeDirectionCue("cites", true), "particles", "directed edge, effects enabled -> particles");
assert.equal(edgeDirectionCue("cites", false), "arrow", "directed edge, effects disabled (reduced motion / >140 nodes) -> static arrowhead fallback");
assert.equal(edgeDirectionCue("is_comparable_to", true), "none", "genuinely symmetric relation gets no direction cue even with effects enabled");
assert.equal(edgeDirectionCue("is_comparable_to", false), "none", "genuinely symmetric relation gets no direction cue with effects disabled either");
assert.equal(edgeDirectionCue("parallel_comparison", true), "none", "the other undirected relation type is covered too");
assert.equal(edgeDirectionCue("presupposes", true), "particles", "an ordinary directed relation not in the undirected set still gets particles");

// --- edgeRelationLabel -----------------------------------------------------

assert.equal(edgeRelationLabel("cites", "explicit_reference"), "→ Explicit reference", "a known category renders the shared glyph+label");
assert.equal(edgeRelationLabel("disagrees_with", "disagreement_polemical_target"), "✕ Disagreement");
// No fabricated category label for edges that carry none — honest
// human-readable edge_type fallback instead.
assert.equal(edgeRelationLabel("review_of", null), "review of");
assert.equal(edgeRelationLabel("discovered_source", undefined), "discovered source");
// A category string that isn't one of the 10 relationship categories
// (e.g. "source_provenance"/"cross_library", both real values graph.ts
// writes for non-classification edges) also falls back honestly rather
// than throwing on an unrecognized key.
assert.equal(edgeRelationLabel("review_of", "source_provenance"), "review of");
assert.equal(edgeRelationLabel("responds_to", "cross_library"), "responds to");

console.log("graphSceneScaling.test.ts: all assertions passed");
