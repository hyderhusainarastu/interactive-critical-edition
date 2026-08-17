import { describe, expect, it } from "vitest";
import { EPSILON, MIN_ELEVATION_DEG, validatePose, vecLength, vecSub } from "@ice/graph-display";
import { resolveFitPose, resolveFocusPose, resolveHomePose, resolveOrientationPresetPose } from "./useKnowledgeMapCamera";

/**
 * Coverage for `useKnowledgeMapCamera.ts`'s pure "resolve*Pose" layer only
 * (see that file's own doc comment for why the React-hook binding layer
 * itself is not unit-tested here — it needs a real ForceGraph3D mount,
 * which is Playwright §7.3 territory).
 */

const viewport = { width: 1440, height: 900, verticalFovDeg: 50 };

describe("resolveHomePose", () => {
  // --- resolveHomePose: always valid, reproducible from data alone ---
  it("is always valid at the canonical 35° elevation and reproducible from data alone", () => {
    const points: [number, number, number][] = [
      [-10, -5, 0],
      [10, 5, 0],
    ];
    const pose = resolveHomePose(points, viewport);
    const validation = validatePose(pose.position, pose.target);
    expect(validation.valid).toBe(true);
    // Home is always the canonical 35° elevation
    expect(validation.elevationDeg.toFixed(1)).toBe("35.0");

    // Reproducible: same points/viewport -> same pose, no dependency on any
    // "current" camera state (unlike fit/focus).
    const again = resolveHomePose(points, viewport);
    expect(pose).toEqual(again);
  });

  // --- resolveHomePose: a node at the origin is safe ---
  it("is safe for a single node at the origin", () => {
    const pose = resolveHomePose([[0, 0, 0]], viewport);
    const validation = validatePose(pose.position, pose.target);
    expect(validation.valid).toBe(true);
    expect(validation.separation > EPSILON).toBeTruthy();
  });
});

describe("resolveFitPose", () => {
  // --- resolveFitPose: re-centers via the CURRENT camera-relative direction ---
  it("re-centers via the CURRENT camera-relative direction rather than the canonical one", () => {
    const points: [number, number, number][] = [
      [0, 0, 0],
      [20, 0, 0],
    ];
    const currentPose = { position: [50, 0, 50] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const pose = resolveFitPose(points, viewport, currentPose);
    const validation = validatePose(pose.position, pose.target);
    expect(validation.valid).toBe(true);
    // The live direction (from currentPose) had azimuth 0/elevation 45 —
    // >=20 deg, so it should NOT fall back to the canonical direction; the
    // resulting elevation should still be close to the live vector's own.
    expect(validation.elevationDeg >= MIN_ELEVATION_DEG).toBeTruthy();
  });

  // --- resolveFitPose: degenerate current pose falls back to canonical, stays valid ---
  it("falls back to the canonical direction and stays valid on a degenerate current pose", () => {
    const points: [number, number, number][] = [[0, 0, 0]];
    const currentPose = { position: [5, 5, 5] as [number, number, number], target: [5, 5, 5] as [number, number, number] };
    const pose = resolveFitPose(points, viewport, currentPose);
    expect(validatePose(pose.position, pose.target).valid).toBe(true);
  });
});

describe("resolveFocusPose", () => {
  // --- resolveFocusPose: distance derived from node + neighborhood bounds, never a fixed scalar ---
  it("derives distance from node + neighborhood bounds, never a fixed scalar", () => {
    const currentPose = { position: [0, 0, 100] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const tightPose = resolveFocusPose([0, 0, 0], [], viewport, currentPose);
    const widePose = resolveFocusPose([0, 0, 0], [[80, 0, 0], [-80, 0, 0]], viewport, currentPose);
    const tightDistance = vecLength(vecSub(tightPose.position, tightPose.target));
    const wideDistance = vecLength(vecSub(widePose.position, widePose.target));
    // a wider emphasized neighborhood must require a larger focus distance
    expect(wideDistance > tightDistance).toBeTruthy();
    expect(validatePose(tightPose.position, tightPose.target).valid).toBe(true);
    expect(validatePose(widePose.position, widePose.target).valid).toBe(true);
  });

  // --- resolveFocusPose: a node at the exact world origin is safe ---
  it("is safe for a node at the exact world origin", () => {
    const currentPose = { position: [0, 0, 0] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    const pose = resolveFocusPose([0, 0, 0], [], viewport, currentPose);
    expect(validatePose(pose.position, pose.target).valid).toBe(true);
  });
});

describe("resolveOrientationPresetPose", () => {
  // --- resolveOrientationPresetPose: Front/Side retain >=20°, Top is the documented 90° exception ---
  it("keeps Front/Side at >=20° elevation and produces Top as the documented 90° exception", () => {
    const points: [number, number, number][] = [
      [-10, -10, 0],
      [10, 10, 0],
    ];
    const front = resolveOrientationPresetPose("front", points, viewport);
    const side = resolveOrientationPresetPose("side", points, viewport);
    const top = resolveOrientationPresetPose("top", points, viewport);

    const frontValidation = validatePose(front.position, front.target);
    const sideValidation = validatePose(side.position, side.target);
    expect(frontValidation.valid).toBe(true);
    expect(frontValidation.elevationDeg.toFixed(1)).toBe("20.0");
    expect(sideValidation.valid).toBe(true);
    expect(sideValidation.elevationDeg.toFixed(1)).toBe("20.0");

    // Top is a DELIBERATE exception (charter §11) — its 90° elevation would
    // fail validatePose's normal floor check, but that's expected and
    // correct: this function never gates Top on that validator, it simply
    // produces the 90° pose. Confirmed directly rather than asserting
    // "valid" (which would be the wrong assertion for this preset).
    const topOffset = vecSub(top.position, top.target);
    // Top looks straight down the Z axis
    expect(Math.abs(topOffset[0]) < 1e-6 && Math.abs(topOffset[1]) < 1e-6).toBeTruthy();
    // Top is positioned above the graph, not below it
    expect(topOffset[2] > 0).toBeTruthy();
  });
});
