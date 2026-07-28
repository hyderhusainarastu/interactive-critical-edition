import assert from "node:assert/strict";
import { EPSILON, MIN_ELEVATION_DEG, validatePose, vecLength, vecSub } from "@ice/graph-display";
import { resolveFitPose, resolveFocusPose, resolveHomePose, resolveOrientationPresetPose } from "./useKnowledgeMapCamera";

/**
 * Coverage for `useKnowledgeMapCamera.ts`'s pure "resolve*Pose" layer only
 * (see that file's own doc comment for why the React-hook binding layer
 * itself is not unit-tested here — it needs a real ForceGraph3D mount,
 * which is Playwright §7.3 territory). Run via
 * `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/useKnowledgeMapCamera.test.ts`.
 */

const viewport = { width: 1440, height: 900, verticalFovDeg: 50 };

// --- resolveHomePose: always valid, reproducible from data alone ---
{
  const points: [number, number, number][] = [
    [-10, -5, 0],
    [10, 5, 0],
  ];
  const pose = resolveHomePose(points, viewport);
  const validation = validatePose(pose.position, pose.target);
  assert.equal(validation.valid, true);
  assert.equal(validation.elevationDeg.toFixed(1), "35.0", "Home is always the canonical 35° elevation");

  // Reproducible: same points/viewport -> same pose, no dependency on any
  // "current" camera state (unlike fit/focus).
  const again = resolveHomePose(points, viewport);
  assert.deepEqual(pose, again);
}
console.log("resolveHomePose: OK");

// --- resolveHomePose: a node at the origin is safe ---
{
  const pose = resolveHomePose([[0, 0, 0]], viewport);
  const validation = validatePose(pose.position, pose.target);
  assert.equal(validation.valid, true);
  assert.ok(validation.separation > EPSILON);
}
console.log("resolveHomePose — origin safety: OK");

// --- resolveFitPose: re-centers via the CURRENT camera-relative direction ---
{
  const points: [number, number, number][] = [
    [0, 0, 0],
    [20, 0, 0],
  ];
  const currentPose = { position: [50, 0, 50] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
  const pose = resolveFitPose(points, viewport, currentPose);
  const validation = validatePose(pose.position, pose.target);
  assert.equal(validation.valid, true);
  // The live direction (from currentPose) had azimuth 0/elevation 45 —
  // >=20 deg, so it should NOT fall back to the canonical direction; the
  // resulting elevation should still be close to the live vector's own.
  assert.ok(validation.elevationDeg >= MIN_ELEVATION_DEG);
}
console.log("resolveFitPose: OK");

// --- resolveFitPose: degenerate current pose falls back to canonical, stays valid ---
{
  const points: [number, number, number][] = [[0, 0, 0]];
  const currentPose = { position: [5, 5, 5] as [number, number, number], target: [5, 5, 5] as [number, number, number] };
  const pose = resolveFitPose(points, viewport, currentPose);
  assert.equal(validatePose(pose.position, pose.target).valid, true);
}
console.log("resolveFitPose — degenerate fallback: OK");

// --- resolveFocusPose: distance derived from node + neighborhood bounds, never a fixed scalar ---
{
  const currentPose = { position: [0, 0, 100] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
  const tightPose = resolveFocusPose([0, 0, 0], [], viewport, currentPose);
  const widePose = resolveFocusPose([0, 0, 0], [[80, 0, 0], [-80, 0, 0]], viewport, currentPose);
  const tightDistance = vecLength(vecSub(tightPose.position, tightPose.target));
  const wideDistance = vecLength(vecSub(widePose.position, widePose.target));
  assert.ok(wideDistance > tightDistance, "a wider emphasized neighborhood must require a larger focus distance");
  assert.equal(validatePose(tightPose.position, tightPose.target).valid, true);
  assert.equal(validatePose(widePose.position, widePose.target).valid, true);
}
console.log("resolveFocusPose — neighborhood-derived distance: OK");

// --- resolveFocusPose: a node at the exact world origin is safe ---
{
  const currentPose = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
  const pose = resolveFocusPose([0, 0, 0], [], viewport, currentPose);
  assert.equal(validatePose(pose.position, pose.target).valid, true);
}
console.log("resolveFocusPose — origin safety: OK");

// --- resolveOrientationPresetPose: Front/Side retain >=20°, Top is the documented 90° exception ---
{
  const points: [number, number, number][] = [
    [-10, -10, 0],
    [10, 10, 0],
  ];
  const front = resolveOrientationPresetPose("front", points, viewport);
  const side = resolveOrientationPresetPose("side", points, viewport);
  const top = resolveOrientationPresetPose("top", points, viewport);

  const frontValidation = validatePose(front.position, front.target);
  const sideValidation = validatePose(side.position, side.target);
  assert.equal(frontValidation.valid, true);
  assert.equal(frontValidation.elevationDeg.toFixed(1), "20.0");
  assert.equal(sideValidation.valid, true);
  assert.equal(sideValidation.elevationDeg.toFixed(1), "20.0");

  // Top is a DELIBERATE exception (charter §11) — its 90° elevation would
  // fail validatePose's normal floor check, but that's expected and
  // correct: this function never gates Top on that validator, it simply
  // produces the 90° pose. Confirmed directly rather than asserting
  // "valid" (which would be the wrong assertion for this preset).
  const topOffset = vecSub(top.position, top.target);
  assert.ok(Math.abs(topOffset[0]) < 1e-6 && Math.abs(topOffset[1]) < 1e-6, "Top looks straight down the Z axis");
  assert.ok(topOffset[2] > 0, "Top is positioned above the graph, not below it");
}
console.log("resolveOrientationPresetPose: OK");

console.log("useKnowledgeMapCamera.test.ts: all assertions passed");
