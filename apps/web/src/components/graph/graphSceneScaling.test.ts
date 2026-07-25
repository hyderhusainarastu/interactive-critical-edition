import assert from "node:assert/strict";
import {
  READER_LEVEL_BEAD_VISIBLE_DISTANCE,
  REFERENCE_CAMERA_DISTANCE,
  SECONDARY_LABEL_HIDE_DISTANCE,
  authorityEmissiveIntensity,
  collapseCurvature,
  credibilitySegmentCount,
  edgeCurvature,
  edgeDirectionCue,
  edgeIsDashed,
  edgeLabelVisible,
  edgeRelationLabel,
  fitCameraToBbox,
  graphEffectsForNodeCount,
  nodePrimaryLabelVisible,
  nodeScaleForDistance,
  nodeSecondaryLabelVisible,
  nodeSizeFactorForLayout,
  particleCountForConfidence,
  readerLevelBeadsVisible,
  screenSpaceLabelScale,
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

// --- fitCameraToBbox (D-23-52) -------------------------------------------

// A box centered on the origin: the fit target IS the origin, and the
// resulting distance actually places the box within the frustum (verified
// geometrically, not just "some positive number") — the half-extent, when
// projected through the SAME half-fov used to derive the distance, must be
// <= the visible half-size at that distance.
{
  const fit = fitCameraToBbox({ x: [-100, 100], y: [-50, 50], z: [-5, 5] }, 1.5);
  assert.deepEqual(fit.target, { x: 0, y: 0, z: 0 });
  assert.ok(fit.distance > 0);
  const vFov = ((50 * Math.PI) / 180) / 2;
  const hFov = Math.atan(Math.tan(vFov) * 1.5);
  const visibleHalfHeight = fit.distance * Math.tan(vFov);
  const visibleHalfWidth = fit.distance * Math.tan(hFov);
  assert.ok(visibleHalfHeight >= 50 - 1e-6, "the box's half-height must fit within the frame at the computed distance");
  assert.ok(visibleHalfWidth >= 100 - 1e-6, "the box's half-width must fit within the frame at the computed distance");
}

// An off-center box (the D-23-52 roadmap-layout shape: nodes clustered away
// from world origin): the fit TARGETS the box's own centroid, not (0,0,0) —
// this is the actual defect the library's own `zoomToFit` has (it always
// aims at world origin regardless of where the data actually sits).
{
  const fit = fitCameraToBbox({ x: [-408, 672], y: [-131, 140], z: [-9, 9] }, 1.22);
  assert.equal(fit.target.x, (-408 + 672) / 2);
  assert.equal(fit.target.y, (-131 + 140) / 2);
  assert.ok(fit.distance > 0);
}

// Degenerate box (a single point, or all coordinates equal) never produces
// a zero/negative/NaN distance — floors at MIN_FIT_DISTANCE.
{
  const fit = fitCameraToBbox({ x: [0, 0], y: [0, 0], z: [0, 0] }, 1);
  assert.ok(Number.isFinite(fit.distance) && fit.distance > 0, "a zero-extent box still yields a finite, positive distance");
}

// A non-finite/zero aspect degrades to 1 (square) rather than propagating
// NaN/Infinity into the resulting distance.
{
  for (const badAspect of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const fit = fitCameraToBbox({ x: [-50, 50], y: [-50, 50], z: [0, 0] }, badAspect);
    assert.ok(Number.isFinite(fit.distance) && fit.distance > 0, `aspect ${badAspect} must still yield a finite, positive distance`);
  }
}

// A wider box needs a larger distance than a narrower one at the same
// aspect (monotonic in extent, not a constant).
{
  const narrow = fitCameraToBbox({ x: [-50, 50], y: [-50, 50], z: [0, 0] }, 1);
  const wide = fitCameraToBbox({ x: [-500, 500], y: [-50, 50], z: [0, 0] }, 1);
  assert.ok(wide.distance > narrow.distance, "a wider bounding box requires a larger fit distance");
}

// --- nodePrimaryLabelVisible / nodeSecondaryLabelVisible (label density) ---

const noHighlight: import("./graphSceneScaling").NodeLabelVisibilityContext = {
  selectedNodeId: null,
  hoverNodeId: null,
  nextUpNodeId: null,
  highlightNodeIds: null,
};

assert.equal(nodePrimaryLabelVisible({ id: "n1", type: "reference" }, noHighlight), false, "an ordinary node with no signal at all has no primary label");
assert.equal(nodePrimaryLabelVisible({ id: "n1", type: "work" }, noHighlight), true, "a work-type node always shows its primary label, regardless of any other signal");
assert.equal(nodePrimaryLabelVisible({ id: "n1", type: "reference" }, { ...noHighlight, selectedNodeId: "n1" }), true, "the selected node shows its primary label");
assert.equal(nodePrimaryLabelVisible({ id: "n1", type: "reference" }, { ...noHighlight, nextUpNodeId: "n1" }), true, "the next-up node shows its primary label");
assert.equal(nodePrimaryLabelVisible({ id: "n1", type: "reference" }, { ...noHighlight, highlightNodeIds: new Set(["n1"]) }), true, "a hover/selection-focus-highlighted node shows its primary label");
assert.equal(nodePrimaryLabelVisible({ id: "n2", type: "reference" }, { ...noHighlight, highlightNodeIds: new Set(["n1"]) }), false, "a node absent from the highlight set stays hidden despite one existing elsewhere");

assert.equal(nodeSecondaryLabelVisible({ id: "n1" }, { selectedNodeId: null, hoverNodeId: null }), false, "no secondary label with nothing selected or hovered");
assert.equal(nodeSecondaryLabelVisible({ id: "n1" }, { selectedNodeId: "n1", hoverNodeId: null }), true, "the selected node shows its secondary label");
assert.equal(nodeSecondaryLabelVisible({ id: "n1" }, { selectedNodeId: null, hoverNodeId: "n1" }), true, "the hovered node shows its secondary label");
// A work-type node or a merely-highlighted neighbor must NOT get a
// secondary label just because its primary label is visible — the two
// policies are deliberately different widths.
assert.equal(nodePrimaryLabelVisible({ id: "work1", type: "work" }, noHighlight), true);
assert.equal(nodeSecondaryLabelVisible({ id: "work1" }, { selectedNodeId: null, hoverNodeId: null }), false, "a work-type node's primary-only visibility must not leak into secondary visibility");

// --- nodeSizeFactorForLayout ---

assert.equal(nodeSizeFactorForLayout("explore"), 1, "explore mode applies no additional roadmap size bump");
assert.equal(nodeSizeFactorForLayout("roadmap"), 2, "roadmap mode's fixed stage-column grid gets an additional 2x node size bump");

// --- screenSpaceLabelScale ---

// Larger viewport -> smaller scale needed for the same pixel height (the
// same NDC-space fraction covers more actual pixels on a taller viewport).
{
  const small = screenSpaceLabelScale(13, 50, 600);
  const large = screenSpaceLabelScale(13, 50, 1200);
  assert.ok(small > large, "a taller viewport needs a smaller scale for the same target pixel height");
}
// Doubling the target pixel height doubles the resulting scale (linear).
{
  const base = screenSpaceLabelScale(11, 50, 800);
  const doubled = screenSpaceLabelScale(22, 50, 800);
  assert.ok(Math.abs(doubled - base * 2) < 1e-9, "scale is linear in the target pixel height");
}
// Degenerate inputs (non-finite/zero viewport or fov) degrade to a finite,
// positive result rather than NaN/Infinity.
for (const badViewport of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
  const result = screenSpaceLabelScale(13, 50, badViewport);
  assert.ok(Number.isFinite(result) && result > 0, `viewport ${badViewport} must still yield a finite, positive scale`);
}
for (const badFov of [0, -5, Number.NaN]) {
  const result = screenSpaceLabelScale(13, badFov, 800);
  assert.ok(Number.isFinite(result) && result > 0, `fov ${badFov} must still yield a finite, positive scale`);
}

// --- Graph P3: authorityEmissiveIntensity / credibilitySegmentCount ------

// Never-assessed (neither authority nor score) -> no halo at all, not a
// fabricated baseline glow.
assert.equal(authorityEmissiveIntensity(null, null), 0);
assert.equal(authorityEmissiveIntensity(undefined, undefined), 0);
// Authority band takes precedence and is monotonically decreasing A->E.
assert.equal(authorityEmissiveIntensity("A", null), 1);
assert.equal(authorityEmissiveIntensity("E", null), 0.15);
assert.ok(authorityEmissiveIntensity("A", null) > authorityEmissiveIntensity("B", null));
assert.ok(authorityEmissiveIntensity("B", null) > authorityEmissiveIntensity("C", null));
assert.ok(authorityEmissiveIntensity("C", null) > authorityEmissiveIntensity("D", null));
assert.ok(authorityEmissiveIntensity("D", null) > authorityEmissiveIntensity("E", null));
// No authority band, but a raw score present -> scaled fallback, monotonic
// in the score and always > 0 (a recorded score, however low, IS data).
assert.ok(authorityEmissiveIntensity(null, 0) > 0);
assert.ok(authorityEmissiveIntensity(null, 1) > authorityEmissiveIntensity(null, 0.2));
// An unrecognized authority string degrades to the score fallback rather
// than crashing on an unknown key.
assert.equal(authorityEmissiveIntensity("Z", 0.5), authorityEmissiveIntensity(null, 0.5));

assert.equal(credibilitySegmentCount(null), 0, "no score -> no lit segments, not a fabricated band");
assert.equal(credibilitySegmentCount(undefined), 0);
assert.equal(credibilitySegmentCount(0), 1, "even a low score is real data -> at least 1 segment lit");
assert.equal(credibilitySegmentCount(1), 4, "a perfect score lights every segment");
assert.equal(credibilitySegmentCount(0.5), 2);
for (const bad of [-1, 2, Number.NaN]) {
  const n = credibilitySegmentCount(bad);
  assert.ok(n >= 0 && n <= 4 && Number.isFinite(n), `out-of-range score ${bad} must still clamp into 0..4`);
}

// --- Graph P3: edgeCurvature / edgeIsDashed -------------------------------

assert.equal(edgeCurvature("outline_section"), 0, "structural edges stay straight");
assert.equal(edgeCurvature("cites"), 0.12, "reference family");
assert.equal(edgeCurvature("influences"), 0.2, "influence family");
assert.equal(edgeCurvature("is_prerequisite_for"), -0.2, "prerequisite curves the opposite direction");
assert.equal(edgeCurvature("disagrees_with"), 0.3, "opposition bows the most");
assert.equal(edgeIsDashed("disagrees_with"), true, "opposition is the only dashed family");
assert.equal(edgeIsDashed("cites"), false);
assert.equal(edgeIsDashed("influences"), false);
assert.equal(edgeIsDashed("outline_section"), false);

// --- Graph P3: particleCountForConfidence ---------------------------------

assert.equal(particleCountForConfidence(0), 1, "floors at 1 even for zero confidence -- a directed edge that IS shown as particles always has at least one");
assert.equal(particleCountForConfidence(1), 3, "ceilings at 3 for full confidence");
assert.ok(particleCountForConfidence(0.5) >= 1 && particleCountForConfidence(0.5) <= 3);
for (const bad of [-1, 2, Number.NaN]) {
  const n = particleCountForConfidence(bad);
  assert.ok(n >= 1 && n <= 3, `out-of-range confidence ${bad} must still clamp into 1..3`);
}
// Monotonic: higher confidence never yields fewer particles.
{
  const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map(particleCountForConfidence);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i] >= samples[i - 1], "particle count must be monotonic non-decreasing in confidence");
}

// --- Graph P3: readerLevelBeadsVisible ------------------------------------

assert.equal(readerLevelBeadsVisible(1), true, "close camera -> beads visible");
assert.equal(readerLevelBeadsVisible(READER_LEVEL_BEAD_VISIBLE_DISTANCE - 1), true);
assert.equal(readerLevelBeadsVisible(READER_LEVEL_BEAD_VISIBLE_DISTANCE), false, "beads hide at/beyond the threshold");
assert.equal(readerLevelBeadsVisible(10000), false, "far camera -> beads hidden (visual-noise avoidance)");
assert.ok(READER_LEVEL_BEAD_VISIBLE_DISTANCE < SECONDARY_LABEL_HIDE_DISTANCE, "beads must hide before the secondary label line does -- tighter detail hides first");
assert.equal(readerLevelBeadsVisible(Number.NaN), false, "an invalid distance degrades to the reference distance, which is past the bead threshold");

// --- Graph P4: graphEffectsForNodeCount / collapseCurvature ---------------

assert.equal(graphEffectsForNodeCount(0).tier, "full");
assert.equal(graphEffectsForNodeCount(140).tier, "full", "the boundary node count itself stays in the cheaper tier");
assert.equal(graphEffectsForNodeCount(141).tier, "reduced");
assert.equal(graphEffectsForNodeCount(400).tier, "reduced");
assert.equal(graphEffectsForNodeCount(401).tier, "minimal");
assert.equal(graphEffectsForNodeCount(800).tier, "minimal");
assert.equal(graphEffectsForNodeCount(801).tier, "bare");
assert.equal(graphEffectsForNodeCount(50000).tier, "bare");
// Invalid input degrades to the cheapest tier, never assumed cheap-to-render.
assert.equal(graphEffectsForNodeCount(Number.NaN).tier, "bare");
assert.equal(graphEffectsForNodeCount(-5).tier, "bare");

{
  const full = graphEffectsForNodeCount(50);
  assert.equal(full.particles, true);
  assert.equal(full.beads, true);
  assert.equal(full.edgeLabelSprites, true);
  assert.equal(full.curvatureTiers, 4);
  assert.equal(full.bloom, "full");
  assert.equal(full.geometryVariety, true);

  const reduced = graphEffectsForNodeCount(200);
  assert.equal(reduced.particles, false, "arrows replace particles once past the full tier");
  assert.equal(reduced.beads, false);
  assert.ok(reduced.sphereSegments[0] < full.sphereSegments[0], "reduced tier uses fewer sphere segments than full");

  const minimal = graphEffectsForNodeCount(600);
  assert.equal(minimal.edgeLabelSprites, false);
  assert.equal(minimal.curvatureTiers, 2);
  assert.equal(minimal.bloom, "half");
  assert.equal(minimal.geometryVariety, true, "geometry variety survives through minimal -- only the bare tier drops it");

  const bare = graphEffectsForNodeCount(2000);
  assert.equal(bare.bloom, "off");
  assert.equal(bare.geometryVariety, false, "the largest scale collapses every node to the plain sphere");
}

// Every tier config field is defined (no accidental gaps in the ladder table).
for (const nodeCount of [10, 200, 600, 2000]) {
  const config = graphEffectsForNodeCount(nodeCount);
  for (const key of ["particles", "sphereSegments", "beads", "edgeLabelSprites", "curvatureTiers", "bloom", "geometryVariety"] as const) {
    assert.notEqual(config[key], undefined, `tier for ${nodeCount} nodes must define ${key}`);
  }
}

assert.equal(collapseCurvature(0, 2), 0, "straight edges stay exactly straight at the coarser tier");
assert.equal(collapseCurvature(0.12, 4), 0.12, "4-tier is a no-op (the full per-family table)");
assert.equal(collapseCurvature(0.12, 2), 0.15, "a positive curvature collapses to the fixed positive magnitude");
assert.equal(collapseCurvature(-0.2, 2), -0.15, "sign is preserved so prerequisite still visibly bows the other way");
assert.equal(collapseCurvature(0.3, 2), 0.15, "opposition's larger bow still collapses to the same coarse magnitude");

console.log("graphSceneScaling.test.ts: all assertions passed");
