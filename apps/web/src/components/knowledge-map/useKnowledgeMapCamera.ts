/**
 * Camera controller hook (charter §11, spec §1.1/§4.1). Wraps
 * `@ice/graph-display/camera.ts`'s pure functions around a live
 * `ForceGraphMethods` ref: `home()`, `fit()`, `focus(...)`,
 * `applyOrientationPreset(...)`, `getCameraPose()`.
 *
 * Structurally a direct port of `prototypes/graph-bakeoff/src/protoA/GraphScene.tsx`'s
 * inline `applyHome`/`applyFit`/`applyFocus`/`currentPoseVectors`/`currentFov`
 * (lines 268–345), extracted into a reusable hook per spec §1.1/§4.1 so
 * `KnowledgeMapScene.tsx` stays focused on scene/lifecycle/interaction
 * wiring rather than repeating this file-size problem.
 *
 * Split in two layers, deliberately:
 *   1. `resolveHomePose`/`resolveFitPose`/`resolveFocusPose`/
 *      `resolveOrientationPresetPose` — pure functions of plain data
 *      (points, viewport, current pose vectors). Directly unit-testable
 *      without React/DOM/WebGL (`useKnowledgeMapCamera.test.ts`).
 *   2. `useKnowledgeMapCamera` itself — the thin ref-reading/`fg.cameraPosition()`-
 *      calling binding layer around layer 1. This layer is NOT covered by
 *      this step's unit tests (it needs a real mounted `ForceGraph3D`
 *      instance / React Testing Library + jsdom, neither of which exists
 *      in `apps/web` today — see this repo's established convention of
 *      `.test.ts` files running via plain `tsx`+`node:assert`, not
 *      vitest). Real coverage for this layer is the charter §16 Playwright
 *      suite (`knowledge-map.spec.ts`, spec §7.3), a later step's
 *      deliverable — recorded here rather than silently assumed covered.
 *
 * Every operation funnels through the SAME `computeHomePose`/`computeFit`/
 * `computeFocusPose`/`distanceToTarget` primitives — no new camera math is
 * written here, only the binding layer around it (spec §4.1's own table).
 */
import { useCallback, useMemo } from "react";
import type { RefObject } from "react";
import {
  boundingBoxCenter,
  canonicalDirection,
  computeBoundingBox,
  computeFit,
  computeFocusPose,
  computeHomePose,
  DEFAULT_FOCUS_TWEEN_MS,
  vecAdd,
  vecScale,
  type SafeAreaInsets,
  type Vec3,
} from "@ice/graph-display";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function reducedMotionActive(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export interface CameraPoseVectors {
  position: Vec3;
  target: Vec3;
}

/**
 * The minimal slice of `react-force-graph-3d`'s `ForceGraphMethods<N, L>`
 * this hook actually calls — none of `camera()`/`controls()`/
 * `cameraPosition()`'s own signatures reference the `N`/`L` generic
 * parameters at all, so this hook has no reason to be generic over them
 * either. Declaring the dependency this narrowly (rather than importing
 * the full `ForceGraphMethods<N, L>` type) is also what lets
 * `KnowledgeMapScene.tsx` pass its own `ForceGraphMethods<GNode, GLink>`
 * ref straight through — a structurally-narrower interface is always
 * assignable from a wider one, whereas two different generic
 * instantiations of `ForceGraphMethods` are NOT mutually assignable
 * (`d3Force`'s return type makes the two generic surfaces contravariant),
 * which is exactly the type error this narrowing avoids.
 */
export interface CameraCapableForceGraph {
  camera(): { fov?: number; position: { x: number; y: number; z: number } };
  controls(): { target?: { x: number; y: number; z: number } };
  cameraPosition(position: { x: number; y: number; z: number }, lookAt?: { x: number; y: number; z: number }, transitionMs?: number): unknown;
}

export interface ViewportInfo {
  width: number;
  height: number;
  /** Vertical field of view, in degrees. */
  verticalFovDeg: number;
  safeAreaInsets?: SafeAreaInsets;
}

/** Charter §11 canonical Home: fit distance from the real bounding box of
 *  `points`, viewed from the canonical 45°/35° direction. No dependency on
 *  the live camera pose — Home is always reproducible from data alone. */
export function resolveHomePose(points: readonly Vec3[], viewport: ViewportInfo): CameraPoseVectors {
  const box = computeBoundingBox(points);
  const home = computeHomePose({
    boundingBox: box,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    verticalFovDeg: viewport.verticalFovDeg,
    safeAreaInsets: viewport.safeAreaInsets,
  });
  return { position: home.position, target: home.target };
}

/**
 * Charter §11 Fit: frame the expanded current visible render bounds around
 * their real center — recentred via the *current* camera-relative
 * direction (`computeFocusPose` around `computeFit`'s target/distance),
 * not always the canonical direction, matching `protoA`'s own `applyFit`.
 */
export function resolveFitPose(points: readonly Vec3[], viewport: ViewportInfo, currentPose: CameraPoseVectors): CameraPoseVectors {
  const box = computeBoundingBox(points);
  const fit = computeFit({
    boundingBox: box,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    verticalFovDeg: viewport.verticalFovDeg,
    safeAreaInsets: viewport.safeAreaInsets,
  });
  const focus = computeFocusPose({
    currentCameraPosition: currentPose.position,
    currentControlsTarget: currentPose.target,
    newTarget: fit.target,
    distance: fit.distance,
  });
  return { position: focus.position, target: focus.target };
}

/**
 * Charter §11 Focus: distance derived from the focused node PLUS its
 * currently emphasized neighborhood's expanded render bounds (never a
 * fixed scalar multiple of coordinates — the confirmed baseline defect
 * this whole module exists to not repeat).
 */
export function resolveFocusPose(
  nodePosition: Vec3,
  neighborhoodPoints: readonly Vec3[],
  viewport: ViewportInfo,
  currentPose: CameraPoseVectors,
): CameraPoseVectors {
  const box = computeBoundingBox([nodePosition, ...neighborhoodPoints]);
  const fit = computeFit({
    boundingBox: box,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    verticalFovDeg: viewport.verticalFovDeg,
    safeAreaInsets: viewport.safeAreaInsets,
  });
  const focus = computeFocusPose({
    currentCameraPosition: currentPose.position,
    currentControlsTarget: currentPose.target,
    newTarget: fit.target,
    distance: fit.distance,
  });
  return { position: focus.position, target: focus.target };
}

export type OrientationPreset = "top" | "front" | "side";

/** Charter §11: "Front/Side presets retain at least 20° elevation; Top is
 *  a deliberate 90° orientation and must retain an unambiguous up
 *  direction." Fixed azimuth/elevation per preset — Top's 90° elevation is
 *  a documented exception to the 20° floor that other poses enforce
 *  (`camera.ts`'s own `validatePose` doc comment says as much); this
 *  function simply never runs Top through that validator, which is the
 *  correct way to honor the carve-out (skip the check, not weaken it). */
const ORIENTATION_ANGLES: Record<OrientationPreset, { azimuthDeg: number; elevationDeg: number }> = {
  front: { azimuthDeg: 0, elevationDeg: 20 },
  side: { azimuthDeg: 90, elevationDeg: 20 },
  top: { azimuthDeg: 0, elevationDeg: 90 },
};

export function resolveOrientationPresetPose(preset: OrientationPreset, points: readonly Vec3[], viewport: ViewportInfo): CameraPoseVectors {
  const box = computeBoundingBox(points);
  const fit = computeFit({
    boundingBox: box,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    verticalFovDeg: viewport.verticalFovDeg,
    safeAreaInsets: viewport.safeAreaInsets,
  });
  const { azimuthDeg, elevationDeg } = ORIENTATION_ANGLES[preset];
  const direction = canonicalDirection(azimuthDeg, elevationDeg);
  const position = vecAdd(fit.target, vecScale(direction, fit.distance));
  return { position, target: boundingBoxCenter(box) };
}

export interface KnowledgeMapCameraApi {
  /** `animated` defaults to `true` — set `false` for the initial framing
   *  before the layout has converged (matches `protoA`'s own
   *  `applyHome(false)` mount-time call). */
  home(animated?: boolean): void;
  fit(): void;
  focus(nodePosition: Vec3, neighborhoodPoints?: readonly Vec3[]): void;
  applyOrientationPreset(preset: OrientationPreset): void;
  getCameraPose(): CameraPoseVectors;
}

/**
 * `visiblePoints` is a caller-supplied accessor (not a static array) so the
 * hook always reads the CURRENT filtered/visible selection at call time —
 * matching `protoA`'s own `visiblePoints` `useCallback`, which reads live
 * `graphData`/`isNodeVisible` state rather than a snapshot taken at some
 * earlier render.
 */
export function useKnowledgeMapCamera(
  fgRef: RefObject<CameraCapableForceGraph | undefined>,
  containerRef: RefObject<HTMLDivElement | null>,
  visiblePoints: () => Vec3[],
  safeAreaInsets?: SafeAreaInsets,
): KnowledgeMapCameraApi {
  const currentFov = useCallback((): number => {
    const cam = fgRef.current?.camera();
    return cam?.fov ?? 50;
  }, [fgRef]);

  const currentPoseVectors = useCallback((): CameraPoseVectors => {
    const cam = fgRef.current?.camera();
    const controls = fgRef.current?.controls() as { target?: { x: number; y: number; z: number } } | undefined;
    const position: Vec3 = cam ? [cam.position.x, cam.position.y, cam.position.z] : [0, 0, 0];
    const target: Vec3 = controls?.target ? [controls.target.x, controls.target.y, controls.target.z] : [0, 0, 0];
    return { position, target };
  }, [fgRef]);

  const viewportInfo = useCallback((): ViewportInfo | null => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return { width: rect.width, height: rect.height, verticalFovDeg: currentFov(), safeAreaInsets };
  }, [containerRef, currentFov, safeAreaInsets]);

  const applyPose = useCallback(
    (pose: CameraPoseVectors, animated: boolean) => {
      const fg = fgRef.current;
      if (!fg) return;
      const ms = animated && !reducedMotionActive() ? DEFAULT_FOCUS_TWEEN_MS : 0;
      fg.cameraPosition(
        { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
        { x: pose.target[0], y: pose.target[1], z: pose.target[2] },
        ms,
      );
    },
    [fgRef],
  );

  const home = useCallback(
    (animated = true) => {
      const viewport = viewportInfo();
      if (!viewport) return;
      applyPose(resolveHomePose(visiblePoints(), viewport), animated);
    },
    [viewportInfo, visiblePoints, applyPose],
  );

  const fit = useCallback(() => {
    const viewport = viewportInfo();
    if (!viewport) return;
    applyPose(resolveFitPose(visiblePoints(), viewport, currentPoseVectors()), true);
  }, [viewportInfo, visiblePoints, currentPoseVectors, applyPose]);

  const focus = useCallback(
    (nodePosition: Vec3, neighborhoodPoints: readonly Vec3[] = []) => {
      const viewport = viewportInfo();
      if (!viewport) return;
      applyPose(resolveFocusPose(nodePosition, neighborhoodPoints, viewport, currentPoseVectors()), true);
    },
    [viewportInfo, currentPoseVectors, applyPose],
  );

  const applyOrientationPreset = useCallback(
    (preset: OrientationPreset) => {
      const viewport = viewportInfo();
      if (!viewport) return;
      applyPose(resolveOrientationPresetPose(preset, visiblePoints(), viewport), true);
    },
    [viewportInfo, visiblePoints, applyPose],
  );

  const getCameraPose = useCallback((): CameraPoseVectors => currentPoseVectors(), [currentPoseVectors]);

  return useMemo(
    () => ({ home, fit, focus, applyOrientationPreset, getCameraPose }),
    [home, fit, focus, applyOrientationPreset, getCameraPose],
  );
}
