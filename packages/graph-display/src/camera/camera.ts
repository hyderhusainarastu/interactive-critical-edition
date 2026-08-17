/**
 * Shared, pure, renderer-agnostic camera math (charter §8/§9/§11/§13).
 *
 * Ported verbatim from `prototypes/graph-bakeoff/src/camera/cameraMath.ts`
 * into this package per the Stage 3 spec (`docs/design/knowledge-map-spec.md`
 * §1.3): both bakeoff prototypes and the real Knowledge Map rebuild consume
 * exactly this module for camera pose so the renderer decision and the
 * production camera controller are never judged against two different
 * reimplementations of the same geometry. Every export here is a pure
 * function of its inputs — no DOM, no three.js, no React, no mutable module
 * state — precisely so it is unit-testable with vitest without a WebGL
 * context.
 *
 * Coordinate convention (charter §8): world Z is the semantic-band normal
 * and world up (`camera.up = (0, 0, 1)`). Azimuth rotates in the X/Y plane
 * around +Z; elevation is the angle above the X/Y plane. If a renderer
 * assumes Y-up internally (three.js's default), adapt at exactly one
 * boundary — the renderer's own scene-graph construction — never here.
 *
 * This module deliberately reproduces, as documented negative tests, the
 * exact defect classes the baseline audit confirmed in the current graph
 * code (docs/audits/ui-graph-redesign-baseline.md §2): deriving view
 * direction from world-origin-relative camera position, sizing/zoom from
 * `camera.position.length()`, and fit/reset math that ignores the active
 * controls target.
 *
 * §1.3 reconciliation (recorded here per the spec's own instruction, not
 * hand-waved): the bakeoff's own `computeBandGap`/`bandZ`/`maxBandJitter`
 * are DELETED at port time — `./bands.ts` already owns this package's
 * `computeBandGap`/`zForLayer`/`deterministicJitter`, already wired into
 * `layerForDisplayKind`/the aggregate-layer machinery other Stage 3 code
 * depends on, and already exhaustively tested (`bands.test.ts`). Keeping
 * both would have shipped two near-duplicate band-Z definitions in the same
 * package. A real caller (`apps/web/src/components/knowledge-map/layout.ts`)
 * imports `computeBandGap`/`zForLayer`/`deterministicJitter` from `./bands`
 * instead of from this module.
 */

export type Vec3 = readonly [number, number, number];

export const EPSILON = 1e-6;

/** Charter §11: "Maintain at least 20° elevation relative to the graph's
 * X/Y plane" for every programmatic Home/Fit/Focus operation. */
export const MIN_ELEVATION_DEG = 20;

/** Charter §8/§11 canonical Home pose angles. */
export const HOME_AZIMUTH_DEG = 45;
export const HOME_ELEVATION_DEG = 35;

/** Charter §11: "18% content padding". */
export const DEFAULT_FIT_PADDING = 0.18;

/** Charter §11 default focus tween duration; reduced motion snaps instead. */
export const DEFAULT_FOCUS_TWEEN_MS = 350;

/**
 * Safety floor for camera-target distance so a zero/degenerate bounding
 * box (charter §11's "a node at (0,0,0) must be safe") never produces a
 * zero or vanishingly small camera distance.
 */
export const MIN_FIT_DISTANCE = 10;

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

// ---------------------------------------------------------------------
// Vector helpers
// ---------------------------------------------------------------------

export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vecScale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function vecLength(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** Returns null (not a zero vector) when `v` is degenerate (length < EPSILON)
 * — callers must handle the fallback explicitly rather than dividing by a
 * near-zero length. */
export function vecNormalize(v: Vec3): Vec3 | null {
  const len = vecLength(v);
  if (len < EPSILON) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Median of a numeric array (average of the two middle values for an even
 * length). Returns 0 for an empty array. */
export function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------
// Canonical direction / elevation
// ---------------------------------------------------------------------

/**
 * The canonical unit view direction for a given azimuth/elevation (charter
 * §8/§11): `(cos(elevation) × cos(azimuth), cos(elevation) × sin(azimuth),
 * sin(elevation))`. Defaults to the canonical Home pose (45°/35°).
 */
export function canonicalDirection(azimuthDeg: number = HOME_AZIMUTH_DEG, elevationDeg: number = HOME_ELEVATION_DEG): Vec3 {
  const a = degToRad(azimuthDeg);
  const e = degToRad(elevationDeg);
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
}

/** The canonical Home direction, exactly `canonicalDirection()` with no
 * arguments — named separately so call sites read as intent, not just
 * "the default args happen to be home". */
export function canonicalHomeDirection(): Vec3 {
  return canonicalDirection(HOME_AZIMUTH_DEG, HOME_ELEVATION_DEG);
}

/** The angle, in degrees, of unit-or-not vector `v` above the world X/Y
 * plane (i.e. off-band-plane elevation). Returns 0 for a degenerate (near-
 * zero-length) vector — callers needing to distinguish "degenerate" from
 * "genuinely at 0° elevation" should length-check separately via
 * `vecLength`/`vecNormalize` first. */
export function elevationAngleDeg(v: Vec3): number {
  const len = vecLength(v);
  if (len < EPSILON) return 0;
  const sinE = Math.max(-1, Math.min(1, v[2] / len));
  return radToDeg(Math.asin(sinE));
}

// ---------------------------------------------------------------------
// Bounding box / fit
// ---------------------------------------------------------------------

export interface BoundingBox {
  min: Vec3;
  max: Vec3;
}

/** Bounding box of `points`. Every axis defaults to [0, 0] for an empty
 * input (a zero-size box centered at the origin), rather than throwing or
 * returning Infinity — this is exactly the "node at (0,0,0)"/empty-scene
 * safety case the camera controller must handle without producing NaNs. */
export function computeBoundingBox(points: readonly Vec3[]): BoundingBox {
  if (points.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const [x, y, z] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function boundingBoxCenter(box: BoundingBox): Vec3 {
  return [
    (box.min[0] + box.max[0]) / 2,
    (box.min[1] + box.max[1]) / 2,
    (box.min[2] + box.max[2]) / 2,
  ];
}

/** Half the box's diagonal length — used as a conservative bounding-sphere
 * radius so a fit computed from it frames the box regardless of camera
 * orientation, not just one axis. */
export function boundingBoxRadius(box: BoundingBox): number {
  const diag = vecSub(box.max, box.min);
  return vecLength(diag) / 2;
}

export interface FitParams {
  boundingBox: BoundingBox;
  viewportWidth: number;
  viewportHeight: number;
  /** Vertical field of view, in degrees. */
  verticalFovDeg: number;
  /** Fractional padding around content; charter default 0.18. */
  padding?: number;
  /** Chrome (toolbar/rail/drawer) that eats into the usable viewport;
   * charter §11 "current toolbar/rail/drawer safe-area insets". */
  safeAreaInsets?: SafeAreaInsets;
}

export interface FitResult {
  target: Vec3;
  distance: number;
}

/**
 * Computes a camera-target and required distance that frames
 * `boundingBox` using BOTH horizontal and vertical FOV (charter §11) —
 * never just one axis, so a fit is not silently wrong for the axis the
 * caller forgot to check. Uses a bounding-sphere fit (distance =
 * radius / sin(halfFov)) rather than a plane-fit (radius / tan(halfFov))
 * because the padded region must contain the box from any azimuth/
 * elevation the user can orbit to, not only square-on.
 */
export function computeFit(params: FitParams): FitResult {
  const center = boundingBoxCenter(params.boundingBox);
  const rawRadius = boundingBoxRadius(params.boundingBox);
  const padding = params.padding ?? DEFAULT_FIT_PADDING;
  const paddedRadius = Math.max(rawRadius, 0) * (1 + padding);
  const insets = params.safeAreaInsets ?? NO_INSETS;

  const effectiveWidth = Math.max(1, params.viewportWidth - insets.left - insets.right);
  const effectiveHeight = Math.max(1, params.viewportHeight - insets.top - insets.bottom);
  const aspect = effectiveWidth / effectiveHeight;

  const vFovRad = degToRad(params.verticalFovDeg);
  const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);

  // Node-at-origin / empty-scene safety: a zero-radius box must still
  // produce a sane, nonzero distance rather than collapsing the camera
  // onto the target.
  const safeRadius = paddedRadius < EPSILON ? MIN_FIT_DISTANCE * Math.sin(vFovRad / 2) : paddedRadius;

  const distanceForVertical = safeRadius / Math.sin(vFovRad / 2);
  const distanceForHorizontal = safeRadius / Math.sin(hFovRad / 2);

  const distance = Math.max(distanceForVertical, distanceForHorizontal, MIN_FIT_DISTANCE);

  return { target: center, distance };
}

// ---------------------------------------------------------------------
// Home pose
// ---------------------------------------------------------------------

export interface HomePose {
  position: Vec3;
  target: Vec3;
  distance: number;
}

/** The canonical, deterministic Home pose: fit distance from the real
 * bounding box, viewed from the canonical 45°/35° direction. Camera
 * coordinates are otherwise ephemeral (charter §9) — Home is the one pose
 * that must always be reproducible from data alone. */
export function computeHomePose(params: FitParams): HomePose {
  const fit = computeFit(params);
  const direction = canonicalHomeDirection();
  const position = vecAdd(fit.target, vecScale(direction, fit.distance));
  return { position, target: fit.target, distance: fit.distance };
}

// ---------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------

export interface FocusParams {
  currentCameraPosition: Vec3;
  currentControlsTarget: Vec3;
  /** The new target to focus on — typically the selected node's position,
   * or the bounding-box center of it plus its emphasized neighborhood. */
  newTarget: Vec3;
  /** Precomputed via `computeFit` over the focused node's (+ neighborhood's)
   * expanded render bounds — never a fixed scalar multiple of coordinates
   * (charter §11 explicitly rules that out; it's the confirmed baseline
   * defect this module exists to not repeat). */
  distance: number;
}

export interface FocusResult {
  position: Vec3;
  target: Vec3;
  /** True when the canonical direction was substituted for the live
   * camera-relative one, because the live vector was degenerate or too
   * shallow (charter §11's two explicit fallback triggers). Exposed so
   * tests and callers can assert *why* a pose came out the way it did,
   * not just that it's numerically valid. */
  usedCanonicalFallback: boolean;
}

/**
 * Computes a focus camera pose per charter §11:
 *   cameraPosition = target + normalize(currentCameraPosition - currentControlsTarget) × distance
 * falling back to the canonical Home direction when that vector is
 * degenerate (length < EPSILON) or violates the minimum 20° off-band-plane
 * elevation — both explicit fallback triggers named in the charter, not an
 * arbitrary superset.
 */
export function computeFocusPose(params: FocusParams): FocusResult {
  const rawDirection = vecSub(params.currentCameraPosition, params.currentControlsTarget);
  const normalized = vecNormalize(rawDirection);

  let direction: Vec3;
  let usedCanonicalFallback = false;

  if (normalized === null) {
    direction = canonicalHomeDirection();
    usedCanonicalFallback = true;
  } else if (elevationAngleDeg(normalized) < MIN_ELEVATION_DEG) {
    direction = canonicalHomeDirection();
    usedCanonicalFallback = true;
  } else {
    direction = normalized;
  }

  // Enforced nonzero camera-target separation (charter §11): distance is
  // always at least MIN_FIT_DISTANCE, and `direction` is always a genuine
  // unit vector (either the validated live one, or the canonical one),
  // so `position` can never coincide with `target`.
  const distance = Math.max(params.distance, MIN_FIT_DISTANCE);
  const position = vecAdd(params.newTarget, vecScale(direction, distance));

  return { position, target: params.newTarget, usedCanonicalFallback };
}

// ---------------------------------------------------------------------
// Pose validation (used by Home/Fit/Focus callers and by tests)
// ---------------------------------------------------------------------

export interface PoseValidation {
  valid: boolean;
  separation: number;
  elevationDeg: number;
  reasons: string[];
}

/**
 * Validates the two invariants charter §11 requires of every programmatic
 * Home/Fit/Focus operation: nonzero camera-target separation, and at least
 * 20° off-band-plane elevation. (The Top orientation preset is a
 * deliberate, documented exception to the elevation floor — charter §11 —
 * and must not be run through this validator as if it were a bug.)
 */
export function validatePose(position: Vec3, target: Vec3): PoseValidation {
  const offset = vecSub(position, target);
  const separation = vecLength(offset);
  const reasons: string[] = [];

  if (separation < EPSILON) {
    reasons.push("camera position coincides with target (zero separation)");
  }

  const elevation = separation < EPSILON ? 0 : elevationAngleDeg(offset);
  if (separation >= EPSILON && elevation < MIN_ELEVATION_DEG) {
    reasons.push(`elevation ${elevation.toFixed(2)}° below the ${MIN_ELEVATION_DEG}° minimum`);
  }

  return { valid: reasons.length === 0, separation, elevationDeg: elevation, reasons };
}

// ---------------------------------------------------------------------
// Zoom-dependent sizing (charter §11: "distance to the active
// target/node, not camera.position.length() from world origin")
// ---------------------------------------------------------------------

/** The one correct distance measurement for zoom-dependent node/label
 * sizing: distance from the camera to the *current controls target*, not
 * `camera.position.length()` (distance from world origin) — the exact
 * baseline defect (docs/audits/ui-graph-redesign-baseline.md §2, item 4)
 * this function exists to make impossible to accidentally reintroduce. */
export function distanceToTarget(cameraPosition: Vec3, target: Vec3): number {
  return vecLength(vecSub(cameraPosition, target));
}
