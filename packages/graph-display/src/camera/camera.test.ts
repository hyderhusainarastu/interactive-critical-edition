import { describe, expect, it } from "vitest";
import {
  EPSILON,
  MIN_ELEVATION_DEG,
  MIN_FIT_DISTANCE,
  boundingBoxCenter,
  boundingBoxRadius,
  canonicalDirection,
  canonicalHomeDirection,
  computeBoundingBox,
  computeFit,
  computeFocusPose,
  computeHomePose,
  degToRad,
  distanceToTarget,
  elevationAngleDeg,
  medianOf,
  validatePose,
  vecLength,
  vecNormalize,
  vecSub,
  type Vec3,
} from "./camera";

// Ported verbatim from prototypes/graph-bakeoff/src/camera/cameraMath.test.ts
// per the Stage 3 spec (docs/design/knowledge-map-spec.md §1.3), MINUS the
// bakeoff's own "band Z assignment (charter §8)" describe block. That block
// exercised computeBandGap/bandZ/maxBandJitter, which are deliberately NOT
// ported into this module — see camera.ts's own top comment for the full
// §1.3 reconciliation. Those same charter §8 invariants (BAND_GAP clamp,
// z = bandIndex * BAND_GAP, 0.08x jitter bound) are exhaustively covered by
// this package's own ./bands.test.ts (computeBandGap/zForLayer/
// deterministicJitter), so nothing is lost — this is 25 of the bakeoff
// module's 29 tests, with the 4 band-Z tests' coverage living in
// bands.test.ts instead of being duplicated here.

describe("medianOf", () => {
  it("returns 0 for an empty array", () => {
    expect(medianOf([])).toBe(0);
  });
  it("averages the two middle values for an even-length array", () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
  it("returns the middle value for an odd-length array, unsorted input", () => {
    expect(medianOf([9, 1, 5])).toBe(5);
  });
});

describe("canonical direction", () => {
  it("matches the charter formula exactly for the Home pose (45°/35°)", () => {
    const dir = canonicalHomeDirection();
    const e = degToRad(35);
    const a = degToRad(45);
    expect(dir[0]).toBeCloseTo(Math.cos(e) * Math.cos(a), 12);
    expect(dir[1]).toBeCloseTo(Math.cos(e) * Math.sin(a), 12);
    expect(dir[2]).toBeCloseTo(Math.sin(e), 12);
  });
  it("is always a unit vector for any azimuth/elevation", () => {
    for (const [az, el] of [
      [0, 0],
      [90, 60],
      [200, -10],
      [359, 89],
    ]) {
      const dir = canonicalDirection(az, el);
      expect(vecLength(dir)).toBeCloseTo(1, 10);
    }
  });
});

describe("elevationAngleDeg", () => {
  it("is 0 for a degenerate (near-zero) vector", () => {
    expect(elevationAngleDeg([0, 0, 0])).toBe(0);
  });
  it("is 90 for straight up along +Z", () => {
    expect(elevationAngleDeg([0, 0, 5])).toBeCloseTo(90, 10);
  });
  it("is 0 for a vector lying in the X/Y band plane", () => {
    expect(elevationAngleDeg([3, 4, 0])).toBeCloseTo(0, 10);
  });
  it("recovers the canonical Home elevation (35°) from its own direction vector", () => {
    expect(elevationAngleDeg(canonicalHomeDirection())).toBeCloseTo(35, 10);
  });
});

describe("bounding box", () => {
  it("is a zero-size box at the origin for an empty point set", () => {
    const box = computeBoundingBox([]);
    expect(box.min).toEqual([0, 0, 0]);
    expect(box.max).toEqual([0, 0, 0]);
    expect(boundingBoxRadius(box)).toBe(0);
  });
  it("computes the correct center and half-diagonal radius for known points", () => {
    const points: Vec3[] = [
      [-10, -5, 0],
      [10, 5, 0],
      [0, 0, 20],
    ];
    const box = computeBoundingBox(points);
    expect(box.min).toEqual([-10, -5, 0]);
    expect(box.max).toEqual([10, 5, 20]);
    expect(boundingBoxCenter(box)).toEqual([0, 0, 10]);
    // diagonal = (20,10,20), length = sqrt(400+100+400)=sqrt(900)=30, radius=15
    expect(boundingBoxRadius(box)).toBeCloseTo(15, 10);
  });
});

describe("computeFit — horizontal AND vertical FOV, wide vs tall aspect", () => {
  const radius = 100;
  const box = { min: [-radius, -radius, -radius] as Vec3, max: [radius, radius, radius] as Vec3 };
  const vFovDeg = 50;

  function independentDvDh(aspect: number, paddedRadius: number) {
    const vFovRad = degToRad(vFovDeg);
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
    return {
      dv: paddedRadius / Math.sin(vFovRad / 2),
      dh: paddedRadius / Math.sin(hFovRad / 2),
    };
  }

  it("is dominated by the VERTICAL constraint for a wide viewport", () => {
    const viewportWidth = 1920;
    const viewportHeight = 640; // aspect = 3
    const result = computeFit({ boundingBox: box, viewportWidth, viewportHeight, verticalFovDeg: vFovDeg });

    const paddedRadius = boundingBoxRadius(box) * (1 + 0.18);
    const { dv, dh } = independentDvDh(viewportWidth / viewportHeight, paddedRadius);

    expect(dv).toBeGreaterThan(dh); // sanity check on the test's own premise
    expect(result.distance).toBeCloseTo(dv, 6);
  });

  it("is dominated by the HORIZONTAL constraint for a tall viewport", () => {
    const viewportWidth = 640;
    const viewportHeight = 1920; // aspect = 1/3
    const result = computeFit({ boundingBox: box, viewportWidth, viewportHeight, verticalFovDeg: vFovDeg });

    const paddedRadius = boundingBoxRadius(box) * (1 + 0.18);
    const { dv, dh } = independentDvDh(viewportWidth / viewportHeight, paddedRadius);

    expect(dh).toBeGreaterThan(dv); // sanity check on the test's own premise
    expect(result.distance).toBeCloseTo(dh, 6);
  });

  it("never returns a distance below MIN_FIT_DISTANCE for a zero-size (single-point) box", () => {
    const originBox = { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
    const result = computeFit({ boundingBox: originBox, viewportWidth: 1440, viewportHeight: 900, verticalFovDeg: 50 });
    expect(result.distance).toBeGreaterThanOrEqual(MIN_FIT_DISTANCE);
    expect(Number.isFinite(result.distance)).toBe(true);
  });

  it("increases required distance when safe-area insets shrink the usable viewport", () => {
    const noInsets = computeFit({ boundingBox: box, viewportWidth: 1440, viewportHeight: 900, verticalFovDeg: 50 });
    const withInsets = computeFit({
      boundingBox: box,
      viewportWidth: 1440,
      viewportHeight: 900,
      verticalFovDeg: 50,
      safeAreaInsets: { top: 56, right: 360, bottom: 0, left: 232 },
    });
    // Shrinking the effective viewport changes the aspect ratio fed into the
    // horizontal-FOV derivation; for this case (rail+drawer eat width, not
    // height) the effective aspect drops, tightening the horizontal
    // constraint, so distance must not be smaller than the uninset fit.
    expect(withInsets.distance).toBeGreaterThanOrEqual(noInsets.distance);
  });
});

describe("computeHomePose", () => {
  it("produces a valid pose (nonzero separation, >=20° elevation) even for a single node at the origin", () => {
    const originBox = { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
    const home = computeHomePose({ boundingBox: originBox, viewportWidth: 1440, viewportHeight: 900, verticalFovDeg: 50 });
    const validation = validatePose(home.position, home.target);
    expect(validation.valid).toBe(true);
    expect(validation.separation).toBeGreaterThan(EPSILON);
    expect(validation.elevationDeg).toBeCloseTo(35, 6); // canonical Home elevation
  });

  it("targets the real bounding-box center, not the origin, for an off-center graph", () => {
    const box = { min: [40, 40, 0] as Vec3, max: [60, 60, 0] as Vec3 };
    const home = computeHomePose({ boundingBox: box, viewportWidth: 1440, viewportHeight: 900, verticalFovDeg: 50 });
    expect(home.target).toEqual([50, 50, 0]);
  });
});

describe("computeFocusPose — the three charter-mandated scenarios", () => {
  it("ORIGIN NODE FOCUS: camera/target/newTarget all at the world origin never collapses to zero separation", () => {
    const result = computeFocusPose({
      currentCameraPosition: [0, 0, 0],
      currentControlsTarget: [0, 0, 0],
      newTarget: [0, 0, 0],
      distance: 40,
    });
    expect(result.usedCanonicalFallback).toBe(true);
    const validation = validatePose(result.position, result.target);
    expect(validation.valid).toBe(true);
  });

  it("DEGENERATE ZERO VECTOR: camera position equal to controls target (nonzero point) falls back to canonical direction", () => {
    const result = computeFocusPose({
      currentCameraPosition: [10, 10, 10],
      currentControlsTarget: [10, 10, 10],
      newTarget: [200, -30, 0],
      distance: 60,
    });
    expect(result.usedCanonicalFallback).toBe(true);
    expect(vecLength(vecSub(result.position, result.target))).toBeGreaterThan(EPSILON);
    expect(validatePose(result.position, result.target).valid).toBe(true);
  });

  it("MINIMUM 20° ELEVATION CLAMP: a shallow live camera vector (5° elevation) is replaced by the canonical direction", () => {
    // Construct a live camera vector at ~5° elevation above the band plane.
    const shallowElevationRad = degToRad(5);
    const liveDir: Vec3 = [Math.cos(shallowElevationRad), 0, Math.sin(shallowElevationRad)];
    const cameraPosition: Vec3 = [liveDir[0] * 50, liveDir[1] * 50, liveDir[2] * 50];

    const result = computeFocusPose({
      currentCameraPosition: cameraPosition,
      currentControlsTarget: [0, 0, 0],
      newTarget: [5, 5, 0],
      distance: 60,
    });

    expect(result.usedCanonicalFallback).toBe(true);
    const finalDirection = vecNormalize(vecSub(result.position, result.target))!;
    expect(elevationAngleDeg(finalDirection)).toBeCloseTo(35, 6);
    expect(validatePose(result.position, result.target).elevationDeg).toBeGreaterThanOrEqual(MIN_ELEVATION_DEG);
  });

  it("does NOT substitute the canonical direction when the live vector is valid (>=20° elevation, nonzero)", () => {
    const dir = canonicalDirection(120, 40); // 40deg >= 20deg minimum, arbitrary azimuth
    const cameraPosition: Vec3 = [dir[0] * 80, dir[1] * 80, dir[2] * 80];
    const result = computeFocusPose({
      currentCameraPosition: cameraPosition,
      currentControlsTarget: [0, 0, 0],
      newTarget: [1, 1, 0],
      distance: 60,
    });
    expect(result.usedCanonicalFallback).toBe(false);
  });
});

describe("validatePose", () => {
  it("flags zero separation as invalid", () => {
    const v = validatePose([5, 5, 5], [5, 5, 5]);
    expect(v.valid).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/zero separation/);
  });
  it("flags below-minimum elevation as invalid even with nonzero separation", () => {
    const v = validatePose([100, 0, 1], [0, 0, 0]); // elevation ~0.57deg
    expect(v.valid).toBe(false);
    expect(v.reasons.join(" ")).toMatch(/elevation/);
  });
  it("accepts a canonical Home-style pose as valid", () => {
    const dir = canonicalHomeDirection();
    const v = validatePose([dir[0] * 100, dir[1] * 100, dir[2] * 100], [0, 0, 0]);
    expect(v.valid).toBe(true);
    expect(v.reasons).toHaveLength(0);
  });
});

describe("distanceToTarget — the confirmed baseline-defect regression guard", () => {
  it("measures distance to the active target, which differs from distance-to-origin when target != origin", () => {
    const cameraPosition: Vec3 = [110, 0, 0];
    const target: Vec3 = [100, 0, 0];
    const correct = distanceToTarget(cameraPosition, target);
    const wrongOriginBased = vecLength(cameraPosition); // the confirmed baseline defect's formula
    expect(correct).toBeCloseTo(10, 10);
    expect(wrongOriginBased).toBeCloseTo(110, 10);
    expect(correct).not.toBeCloseTo(wrongOriginBased, 0);
  });
});
