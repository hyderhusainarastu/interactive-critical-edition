/**
 * Prototype B's actual React Three Fiber + Three.js scene (charter §13):
 * `InstancedMesh` per repeated silhouette (six max), batched `LineSegments`
 * links, instance-aware raycast picking, the shared camera module, a
 * screen-space HTML label layer, and `OrbitControls` with `up=(0,0,1)`.
 *
 * Rendered nodes/positions come from `computeLayout` (offline d3-force-3d
 * pre-pass, fixed seed, band-constrained Z — see `layout.ts`) and are never
 * recomputed inside the frame loop. Selection/hover/filter only touch
 * per-instance matrices/colors and edge vertex colors — the scene is never
 * remounted or the layout re-run for those changes (charter §14).
 *
 * Known, documented simplifications for this bakeoff prototype (not the
 * production Knowledge Map rebuild):
 *  - Home/Fit/Focus camera moves snap immediately rather than tweening over
 *    the charter's 350ms default — camera-pose *correctness* is what the
 *    bakeoff measures/tests (via the shared `cameraMath` module, already
 *    unit-tested), not transition easing. Reduced motion behaves identically
 *    to normal motion as a result (both snap) — a strict superset of the
 *    charter's reduced-motion requirement, never a violation of it.
 *  - Self-link and parallel-link edges are rendered as short, offset straight
 *    segments (still two vertices, one shared `LineSegments` buffer) rather
 *    than true bezier curves, so they stay visually distinguishable without
 *    breaking the batched-buffer invariant.
 *  - "Missing/unavailable" nodes are shown desaturated (blended toward a
 *    neutral gray) rather than true per-instance wireframe, since wireframe
 *    is a `Material`-level flag shared by every instance of an
 *    `InstancedMesh` and per-instance wireframe would need a custom shader.
 *  - Directed-edge arrowheads are not drawn in this prototype pass.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import type { BakeoffFixture, DisplayEdgeFamily, FixtureLink, FixtureNode } from "../../fixtures/types";
import type { CameraPose, NodeFilterPredicate } from "../../types/prototype";
import {
  DEFAULT_FIT_PADDING,
  computeBoundingBox,
  boundingBoxRadius,
  computeFit,
  computeFocusPose,
  computeHomePose,
  distanceToTarget,
  type Vec3,
} from "../../camera/cameraMath";
import { computeLayout } from "./layout";
import {
  BACKGROUND_HEX,
  EDGE_FAMILY_VISUALS,
  EDGE_OPACITY_DEFAULT,
  EDGE_OPACITY_DIMMED,
  EDGE_OPACITY_SELECTED_PATH,
  KIND_VISUALS,
  RING_COLORS,
  SILHOUETTE_KEYS,
  blendTowardBackground,
  computeNodeScale,
  p95Of,
  type SilhouetteKey,
} from "./visuals";
import { buildRingGeometry, buildSilhouetteGeometries, buildStateRingGeometry, disposeGeometries } from "./geometries";
import { clientToNdc, pickNodeAt, type PickableMesh } from "./picking";
import { LabelLayerB, type LabelCandidate } from "./labelLayer";

const VERTICAL_FOV_DEG = 50;
const PICK_SCALE_MULTIPLIER = 1.8;
const MOBILE_WIDTH_BREAKPOINT = 768;
const DESKTOP_PRIORITY_LABEL_CAP = 20;
const MOBILE_PRIORITY_LABEL_CAP = 10;
const NEUTRAL_MISSING_HEX = 0x5a6472;
const SELF_LINK_OFFSET = 6;
const PARALLEL_LINK_OFFSET = 3;

/** Charter §10: "Tune world dimensions so ordinary nodes project to roughly
 * 10-24px at Home and the root to roughly 24-30px." Node geometry itself is
 * a fixed 1-world-unit primitive (`geometries.ts`); the actual on-screen
 * size is this fraction of the scene's own Home-fit padded bounding-sphere
 * radius — since Home always frames that padded radius to exactly half the
 * viewport height (see `computeFit`'s `distance = safeRadius / sin(halfFov)`
 * construction), a fixed *fraction* of it converts directly to a
 * viewport-independent target pixel size, unlike a fixture-independent
 * absolute world-unit constant (which produced sub-pixel, invisible nodes
 * on the denser/larger-spread fixtures during initial verification). */
const NODE_SIZE_FRACTION_OF_PADDED_RADIUS = 0.02;
const MIN_WORLD_NODE_UNIT = 6;

/** Mirrors `src/bench/types.ts`'s `LifecycleSnapshot` shape without importing
 * across the isolated-prototype boundary (see `index.tsx`'s `ProtoBHandle`
 * doc comment for why: this file stays a pure scene component, agnostic of
 * the harness bench types). */
export interface SceneLifecycleSnapshot {
  cycle: number;
  geometries: number;
  textures: number;
  programs: number;
  activeWorkers: number;
  activeObservers: number;
  activeTimers: number;
  registeredListeners: number;
}

export interface SceneImperativeApi {
  select(nodeId: string | null): void;
  focus(nodeId: string): void;
  home(): void;
  fit(): void;
  setFilter(predicate: NodeFilterPredicate | null): void;
  resize(): void;
  getCameraPose(): CameraPose;
  getNodeScreenPosition(nodeId: string): { x: number; y: number } | null;
  isHighlightConfirmed(nodeId: string): boolean;
  /** Charter §13 bench step 9 (mount/unmount lifecycle leak check). Real
   * geometry/texture/program counts come straight from three.js's own
   * `renderer.info`; workers/observers/timers are 0 because this scene
   * registers none of its own (R3F's `<Canvas>` owns its internal render
   * loop/resize handling, not code this prototype creates) — the two
   * `pointermove`/`click` listeners added in the mount effect below are the
   * only resources this component itself is responsible for tracking. */
  readLifecycleSnapshot(cycle: number): SceneLifecycleSnapshot;
}

export interface SceneCallbacks {
  onPayloadReceived?: () => void;
  onInteractive?: () => void;
  onSelect?: (nodeId: string | null) => void;
  onFocus?: (nodeId: string) => void;
}

interface NodeTransform {
  node: FixtureNode;
  position: Vec3;
  baseScale: number;
  silhouette: SilhouetteKey;
  instanceIndex: number;
}

interface LinkEntry {
  link: FixtureLink;
  vertexOffset: number;
  family: DisplayEdgeFamily;
}

function directionUnit(v: Vec3, fallback: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-6) return fallback;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Applies a `Vec3` position/target to a live three.js camera + controls
 * target with no interpolation — see the module doc's "snap" simplification. */
function applyPoseNow(camera: THREE.PerspectiveCamera, controls: OrbitControls, position: Vec3, target: Vec3): void {
  camera.position.set(position[0], position[1], position[2]);
  controls.target.set(target[0], target[1], target[2]);
  camera.updateMatrixWorld();
  controls.update();
}

interface SceneContentProps {
  fixture: BakeoffFixture;
  apiRef: React.MutableRefObject<SceneImperativeApi | null>;
  callbacks: SceneCallbacks;
}

function SceneContent({ fixture, apiRef, callbacks }: SceneContentProps) {
  const { camera, gl, size, scene } = useThree();
  const perspCamera = camera as THREE.PerspectiveCamera;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filterRef = useRef<NodeFilterPredicate | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const confirmedHighlightRef = useRef<string | null>(null);
  const registeredListenerCountRef = useRef(0);

  // ---- Static per-mount derivations (fixture is stable for a mount) ----
  const layout = useMemo(() => computeLayout(fixture), [fixture]);
  const p95Degree = useMemo(() => p95Of(fixture.nodes.map((n) => n.degree)), [fixture]);

  const transformsById = useMemo(() => {
    const bySilhouette = new Map<SilhouetteKey, FixtureNode[]>();
    for (const key of SILHOUETTE_KEYS) bySilhouette.set(key, []);
    for (const node of fixture.nodes) {
      const silhouette = KIND_VISUALS[node.displayKind].silhouette;
      bySilhouette.get(silhouette)!.push(node);
    }
    const result = new Map<string, NodeTransform>();
    for (const [silhouette, nodes] of bySilhouette) {
      nodes.forEach((node, instanceIndex) => {
        const position = layout.positionsByNodeId.get(node.id) ?? [0, 0, 0];
        const scale = computeNodeScale({
          degree: node.degree,
          isRoot: node.isRoot,
          isAggregate: node.displayKind === "aggregate",
          p95VisibleDegree: p95Degree,
        });
        result.set(node.id, { node, position, baseScale: scale, silhouette, instanceIndex });
      });
    }
    return result;
  }, [fixture, layout, p95Degree]);

  const nodesBySilhouette = useMemo(() => {
    const map = new Map<SilhouetteKey, FixtureNode[]>();
    for (const key of SILHOUETTE_KEYS) map.set(key, []);
    for (const node of fixture.nodes) {
      map.get(KIND_VISUALS[node.displayKind].silhouette)!.push(node);
    }
    return map;
  }, [fixture]);

  const geometries = useMemo(() => buildSilhouetteGeometries(), []);
  const ringGeometry = useMemo(() => buildRingGeometry(), []);
  const selectionRingGeometry = useMemo(() => buildStateRingGeometry(), []);
  const hoverRingGeometry = useMemo(() => buildStateRingGeometry(), []);

  const visibleMeshRefs = useRef(new Map<SilhouetteKey, THREE.InstancedMesh>());
  const pickMeshRefs = useRef(new Map<SilhouetteKey, THREE.InstancedMesh>());
  const ringMeshRef = useRef<THREE.InstancedMesh | null>(null);
  const nodesWithRing = useMemo(() => fixture.nodes.filter((n) => KIND_VISUALS[n.displayKind].ring), [fixture]);

  const selectionRingRef = useRef<THREE.Mesh | null>(null);
  const hoverRingRef = useRef<THREE.Mesh | null>(null);

  const linksGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const linkEntries = useMemo<LinkEntry[]>(
    () => fixture.links.map((link, i) => ({ link, vertexOffset: i * 2, family: link.displayFamily })),
    [fixture],
  );

  const controlsRef = useRef<OrbitControls | null>(null);
  const labelLayerRef = useRef<LabelLayerB | null>(null);
  const pickableMeshesRef = useRef<PickableMesh[]>([]);

  // ---- One-time scene bounding box + home pose ----
  const boundingBox = useMemo(() => computeBoundingBox(fixture.nodes.map((n) => transformsById.get(n.id)!.position)), [fixture, transformsById]);

  const worldNodeUnit = useMemo(() => {
    const paddedRadius = boundingBoxRadius(boundingBox) * (1 + DEFAULT_FIT_PADDING);
    return Math.max(MIN_WORLD_NODE_UNIT, paddedRadius * NODE_SIZE_FRACTION_OF_PADDED_RADIUS);
  }, [boundingBox]);

  // ---- Build instance matrices for a silhouette's visible + pick meshes ----
  function rebuildInstances(silhouette: SilhouetteKey): void {
    const nodes = nodesBySilhouette.get(silhouette) ?? [];
    const visibleMesh = visibleMeshRefs.current.get(silhouette);
    const pickMesh = pickMeshRefs.current.get(silhouette);
    if (!visibleMesh || !pickMesh || nodes.length === 0) return;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const nodeIdsByInstance: string[] = new Array(nodes.length);

    nodes.forEach((node, i) => {
      const transform = transformsById.get(node.id)!;
      const filteredOut = filterRef.current ? !filterRef.current(node) : false;
      const effectiveScale = filteredOut ? 0 : transform.baseScale * worldNodeUnit;

      matrix.compose(
        new THREE.Vector3(transform.position[0], transform.position[1], transform.position[2]),
        quaternion,
        new THREE.Vector3(effectiveScale, effectiveScale, effectiveScale),
      );
      visibleMesh.setMatrixAt(i, matrix);

      const kindVisual = KIND_VISUALS[node.displayKind];
      const baseColor = new THREE.Color(node.unavailableReason ? NEUTRAL_MISSING_HEX : kindVisual.colorHex);
      visibleMesh.setColorAt(i, baseColor);

      const pickScale = filteredOut ? 0 : transform.baseScale * worldNodeUnit * PICK_SCALE_MULTIPLIER;
      matrix.compose(
        new THREE.Vector3(transform.position[0], transform.position[1], transform.position[2]),
        quaternion,
        new THREE.Vector3(pickScale, pickScale, pickScale),
      );
      pickMesh.setMatrixAt(i, matrix);
      nodeIdsByInstance[i] = node.id;
    });

    visibleMesh.instanceMatrix.needsUpdate = true;
    if (visibleMesh.instanceColor) visibleMesh.instanceColor.needsUpdate = true;
    pickMesh.instanceMatrix.needsUpdate = true;

    const existingIndex = pickableMeshesRef.current.findIndex((p) => p.mesh === pickMesh);
    const entry: PickableMesh = { mesh: pickMesh, nodeIdsByInstance };
    if (existingIndex >= 0) pickableMeshesRef.current[existingIndex] = entry;
    else pickableMeshesRef.current.push(entry);
  }

  function rebuildRings(): void {
    const mesh = ringMeshRef.current;
    if (!mesh || nodesWithRing.length === 0) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
    nodesWithRing.forEach((node, i) => {
      const transform = transformsById.get(node.id)!;
      const filteredOut = filterRef.current ? !filterRef.current(node) : false;
      const scale = filteredOut ? 0 : transform.baseScale * worldNodeUnit;
      matrix.compose(new THREE.Vector3(transform.position[0], transform.position[1], transform.position[2]), quaternion, new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(i, matrix);
      const ring = KIND_VISUALS[node.displayKind].ring;
      mesh.setColorAt(i, new THREE.Color(ring ? RING_COLORS[ring] : 0xffffff));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function endpointFor(link: FixtureLink, nodeId: string, isSource: boolean): Vec3 {
    const base = transformsById.get(nodeId)?.position ?? [0, 0, 0];
    if (link.isSelfLink) {
      // Short offset loop so a self-link is a visible, non-zero-length
      // segment near its own node rather than a degenerate point.
      return isSource ? base : [base[0] + SELF_LINK_OFFSET, base[1] + SELF_LINK_OFFSET, base[2]];
    }
    if (link.parallelOf) {
      // Perpendicular offset for the second of a parallel pair, so both
      // remain visible straight segments rather than exactly overlapping.
      const other = link.source === nodeId ? link.target : link.source;
      const otherPos = transformsById.get(other)?.position ?? [0, 0, 0];
      const dx = otherPos[0] - base[0];
      const dy = otherPos[1] - base[1];
      const len = Math.hypot(dx, dy) || 1;
      const perpX = (-dy / len) * PARALLEL_LINK_OFFSET;
      const perpY = (dx / len) * PARALLEL_LINK_OFFSET;
      return [base[0] + perpX, base[1] + perpY, base[2]];
    }
    return base;
  }

  function computeEdgeOpacity(link: FixtureLink): number {
    const sourceHidden = filterRef.current ? !filterRef.current(fixtureNodeById(link.source)) : false;
    const targetHidden = filterRef.current ? !filterRef.current(fixtureNodeById(link.target)) : false;
    if (sourceHidden || targetHidden) return 0;
    if (!selectedId) return EDGE_OPACITY_DEFAULT;
    const incident = link.source === selectedId || link.target === selectedId;
    return incident ? EDGE_OPACITY_SELECTED_PATH : EDGE_OPACITY_DIMMED;
  }

  function fixtureNodeById(id: string): FixtureNode {
    return transformsById.get(id)!.node;
  }

  function rebuildLinks(): void {
    const geometry = linksGeometryRef.current;
    if (!geometry) return;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = geometry.getAttribute("color") as THREE.BufferAttribute;

    for (const entry of linkEntries) {
      const { link, vertexOffset } = entry;
      const sourcePos = endpointFor(link, link.source, true);
      const targetPos = endpointFor(link, link.target, false);
      positions.setXYZ(vertexOffset, sourcePos[0], sourcePos[1], sourcePos[2]);
      positions.setXYZ(vertexOffset + 1, targetPos[0], targetPos[1], targetPos[2]);

      const visual = EDGE_FAMILY_VISUALS[entry.family];
      const opacity = computeEdgeOpacity(link);
      const [r, g, b] = blendTowardBackground(visual.colorHex, opacity, BACKGROUND_HEX);
      colors.setXYZ(vertexOffset, r, g, b);
      colors.setXYZ(vertexOffset + 1, r, g, b);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }

  // ---- Mount: build all instances + links + controls + picking + labels ----
  useEffect(() => {
    callbacks.onPayloadReceived?.();

    for (const key of SILHOUETTE_KEYS) rebuildInstances(key);
    rebuildRings();
    rebuildLinks();

    // Charter §8/§11: world Z is the semantic-band normal and world up. Set
    // the camera's own `.up` *before* constructing OrbitControls — the
    // controls derive their internal spherical/orbit basis from
    // `this.object.up` at construction and on each `update()`, so this is
    // the one boundary where the Z-up convention is adapted into three.js's
    // otherwise Y-up-flavored camera/controls code (OrbitControls itself has
    // no separate settable `.up`; it always reads the camera's).
    perspCamera.up.set(0, 0, 1);
    const controls = new OrbitControls(perspCamera, gl.domElement);
    controls.enableDamping = false;
    controlsRef.current = controls;

    const home = computeHomePose({
      boundingBox,
      viewportWidth: Math.max(1, size.width),
      viewportHeight: Math.max(1, size.height),
      verticalFovDeg: VERTICAL_FOV_DEG,
      padding: DEFAULT_FIT_PADDING,
    });
    applyPoseNow(perspCamera, controls, home.position, home.target);

    labelLayerRef.current = new LabelLayerB(gl.domElement.parentElement ?? gl.domElement);

    const canvasEl = gl.domElement;

    function handlePointerMove(ev: PointerEvent) {
      const rect = canvasEl.getBoundingClientRect();
      const ndc = clientToNdc(ev.clientX, ev.clientY, rect);
      const hit = pickNodeAt(ndc, perspCamera, pickableMeshesRef.current);
      const nodeId = hit?.nodeId ?? null;
      if (hoveredIdRef.current !== nodeId) {
        hoveredIdRef.current = nodeId;
        updateHoverRing(nodeId);
      }
    }

    function handleClick(ev: MouseEvent) {
      const rect = canvasEl.getBoundingClientRect();
      const ndc = clientToNdc(ev.clientX, ev.clientY, rect);
      const hit = pickNodeAt(ndc, perspCamera, pickableMeshesRef.current);
      applySelection(hit?.nodeId ?? null);
    }

    canvasEl.addEventListener("pointermove", handlePointerMove);
    canvasEl.addEventListener("click", handleClick);
    registeredListenerCountRef.current = 2;

    // "Interactive": nonzero dimensions, root in-frustum (home pose frames
    // the whole bounding box, which includes the root), picking wired,
    // no loading overlay.
    callbacks.onInteractive?.();

    return () => {
      canvasEl.removeEventListener("pointermove", handlePointerMove);
      canvasEl.removeEventListener("click", handleClick);
      registeredListenerCountRef.current = 0;
      controls.dispose();
      labelLayerRef.current?.dispose();
      labelLayerRef.current = null;
      disposeGeometries(geometries as unknown as Record<string, THREE.BufferGeometry>);
      ringGeometry.dispose();
      selectionRingGeometry.dispose();
      hoverRingGeometry.dispose();
      linksGeometryRef.current?.dispose();
    };
    // Mount-once effect: fixture is stable for the lifetime of this
    // component (a new fixture means a new mount/key upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture]);

  function updateHoverRing(nodeId: string | null): void {
    const mesh = hoverRingRef.current;
    if (!mesh) return;
    if (!nodeId) {
      mesh.visible = false;
      return;
    }
    const transform = transformsById.get(nodeId);
    if (!transform) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.set(transform.position[0], transform.position[1], transform.position[2]);
    mesh.scale.setScalar(transform.baseScale * worldNodeUnit);
  }

  function updateSelectionRing(nodeId: string | null): void {
    const mesh = selectionRingRef.current;
    if (!mesh) return;
    if (!nodeId) {
      mesh.visible = false;
      return;
    }
    const transform = transformsById.get(nodeId);
    if (!transform) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.set(transform.position[0], transform.position[1], transform.position[2]);
    mesh.scale.setScalar(transform.baseScale * worldNodeUnit);
  }

  function applySelection(nodeId: string | null): void {
    setSelectedId(nodeId);
    updateSelectionRing(nodeId);
    confirmedHighlightRef.current = nodeId;
    callbacks.onSelect?.(nodeId);
  }

  // Selection changes re-tint edges (selected-path vs. dimmed) without any
  // remount or layout recompute.
  useEffect(() => {
    rebuildLinks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ---- Imperative API surfaced to the harness handle ----
  useImperativeHandle(
    apiRef,
    () => ({
      select(nodeId) {
        applySelection(nodeId);
      },
      focus(nodeId) {
        const transform = transformsById.get(nodeId);
        const controls = controlsRef.current;
        if (!transform || !controls) return;
        const neighborIds = new Set<string>();
        for (const link of fixture.links) {
          if (link.source === nodeId) neighborIds.add(link.target);
          if (link.target === nodeId) neighborIds.add(link.source);
        }
        const neighborhoodPoints: Vec3[] = [transform.position];
        for (const id of neighborIds) {
          const t = transformsById.get(id);
          if (t) neighborhoodPoints.push(t.position);
        }
        const neighborhoodBox = computeBoundingBox(neighborhoodPoints);
        const fit = computeFit({
          boundingBox: neighborhoodBox,
          viewportWidth: Math.max(1, size.width),
          viewportHeight: Math.max(1, size.height),
          verticalFovDeg: VERTICAL_FOV_DEG,
          padding: DEFAULT_FIT_PADDING,
        });
        const focusResult = computeFocusPose({
          currentCameraPosition: [perspCamera.position.x, perspCamera.position.y, perspCamera.position.z],
          currentControlsTarget: [controls.target.x, controls.target.y, controls.target.z],
          newTarget: transform.position,
          distance: fit.distance,
        });
        applyPoseNow(perspCamera, controls, focusResult.position, focusResult.target);
        callbacks.onFocus?.(nodeId);
      },
      home() {
        const controls = controlsRef.current;
        if (!controls) return;
        const home = computeHomePose({
          boundingBox,
          viewportWidth: Math.max(1, size.width),
          viewportHeight: Math.max(1, size.height),
          verticalFovDeg: VERTICAL_FOV_DEG,
          padding: DEFAULT_FIT_PADDING,
        });
        applyPoseNow(perspCamera, controls, home.position, home.target);
      },
      fit() {
        const controls = controlsRef.current;
        if (!controls) return;
        const visiblePoints = fixture.nodes
          .filter((n) => (filterRef.current ? filterRef.current(n) : true))
          .map((n) => transformsById.get(n.id)!.position);
        const box = computeBoundingBox(visiblePoints.length > 0 ? visiblePoints : [[0, 0, 0]]);
        const fit = computeFit({
          boundingBox: box,
          viewportWidth: Math.max(1, size.width),
          viewportHeight: Math.max(1, size.height),
          verticalFovDeg: VERTICAL_FOV_DEG,
          padding: DEFAULT_FIT_PADDING,
        });
        const direction = directionUnit(
          [
            perspCamera.position.x - controls.target.x,
            perspCamera.position.y - controls.target.y,
            perspCamera.position.z - controls.target.z,
          ],
          [0.574, 0.574, 0.574],
        );
        const position: Vec3 = [
          fit.target[0] + direction[0] * fit.distance,
          fit.target[1] + direction[1] * fit.distance,
          fit.target[2] + direction[2] * fit.distance,
        ];
        applyPoseNow(perspCamera, controls, position, fit.target);
      },
      setFilter(predicate) {
        filterRef.current = predicate;
        for (const key of SILHOUETTE_KEYS) rebuildInstances(key);
        rebuildRings();
        rebuildLinks();
      },
      resize() {
        perspCamera.updateProjectionMatrix();
      },
      getCameraPose() {
        const controls = controlsRef.current;
        return {
          position: [perspCamera.position.x, perspCamera.position.y, perspCamera.position.z],
          target: controls ? [controls.target.x, controls.target.y, controls.target.z] : [0, 0, 0],
        };
      },
      getNodeScreenPosition(nodeId) {
        const transform = transformsById.get(nodeId);
        if (!transform) return null;
        const vector = new THREE.Vector3(transform.position[0], transform.position[1], transform.position[2]);
        vector.project(perspCamera);
        if (vector.z > 1 || vector.z < -1) return null;
        return {
          x: ((vector.x + 1) / 2) * size.width,
          y: ((1 - vector.y) / 2) * size.height,
        };
      },
      isHighlightConfirmed(nodeId) {
        return confirmedHighlightRef.current === nodeId;
      },
      readLifecycleSnapshot(cycle) {
        const info = gl.info;
        return {
          cycle,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
          programs: info.programs?.length ?? 0,
          activeWorkers: 0, // Prototype B does not use Web Workers.
          activeObservers: 0, // No ResizeObserver/other observer of its own — see interface doc comment.
          activeTimers: 0, // No self-created timer/rAF loop — R3F's Canvas owns its own render loop.
          registeredListeners: registeredListenerCountRef.current,
        };
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fixture, boundingBox],
  );

  // ---- Per-frame: controls damping (disabled, but update() still needed
  // for internal state) + capped label layer positions ----
  useFrame(() => {
    controlsRef.current?.update();

    const layer = labelLayerRef.current;
    if (!layer) return;

    const mobile = size.width < MOBILE_WIDTH_BREAKPOINT;
    const cap = mobile ? MOBILE_PRIORITY_LABEL_CAP : DESKTOP_PRIORITY_LABEL_CAP;

    const neighborIds = new Set<string>();
    if (selectedId) {
      for (const link of fixture.links) {
        if (link.source === selectedId) neighborIds.add(link.target);
        if (link.target === selectedId) neighborIds.add(link.source);
      }
    }

    const candidates: LabelCandidate[] = [];
    const vector = new THREE.Vector3();
    for (const node of fixture.nodes) {
      const transform = transformsById.get(node.id)!;
      if (filterRef.current && !filterRef.current(node)) continue;
      vector.set(transform.position[0], transform.position[1], transform.position[2]);
      vector.project(perspCamera);
      if (vector.z > 1 || vector.z < -1) continue;
      const x = ((vector.x + 1) / 2) * size.width;
      const y = ((1 - vector.y) / 2) * size.height;
      const alwaysShow = node.isRoot || node.id === selectedId || node.id === hoveredIdRef.current || neighborIds.has(node.id);
      candidates.push({
        id: node.id,
        text: node.label,
        x,
        y,
        alwaysShow,
        degree: node.degree,
        tier: node.isRoot || node.id === selectedId ? "primary" : alwaysShow ? "priority" : "secondary",
      });
    }
    layer.update(candidates, cap, size.width, size.height);
  });

  return (
    <>
      <color attach="background" args={[BACKGROUND_HEX]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[100, 150, 200]} intensity={0.5} />

      {SILHOUETTE_KEYS.map((key) => {
        const nodes = nodesBySilhouette.get(key) ?? [];
        if (nodes.length === 0) return null;
        return (
          <instancedMesh
            key={`visible-${key}`}
            ref={(m) => {
              if (m) {
                visibleMeshRefs.current.set(key, m);
                rebuildInstances(key);
              }
            }}
            args={[geometries[key], undefined, nodes.length]}
          >
            <meshStandardMaterial roughness={0.55} metalness={0.05} />
          </instancedMesh>
        );
      })}

      {SILHOUETTE_KEYS.map((key) => {
        const nodes = nodesBySilhouette.get(key) ?? [];
        if (nodes.length === 0) return null;
        return (
          <instancedMesh
            key={`pick-${key}`}
            ref={(m) => {
              if (m) {
                m.visible = false;
                pickMeshRefs.current.set(key, m);
                rebuildInstances(key);
              }
            }}
            args={[geometries[key], undefined, nodes.length]}
          >
            <meshBasicMaterial />
          </instancedMesh>
        );
      })}

      {nodesWithRing.length > 0 && (
        <instancedMesh
          ref={(m) => {
            if (m) {
              ringMeshRef.current = m;
              rebuildRings();
            }
          }}
          args={[ringGeometry, undefined, nodesWithRing.length]}
        >
          <meshBasicMaterial transparent opacity={0.9} />
        </instancedMesh>
      )}

      <mesh ref={selectionRingRef} geometry={selectionRingGeometry} visible={false} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={0xf0c47c} transparent opacity={0.95} />
      </mesh>
      <mesh ref={hoverRingRef} geometry={hoverRingGeometry} visible={false} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={0xfdf8ee} transparent opacity={0.6} />
      </mesh>

      <lineSegments
        ref={(m) => {
          if (m) linksGeometryRef.current = m.geometry;
        }}
      >
        <bufferGeometry
          ref={(g) => {
            if (g && !g.getAttribute("position")) {
              const count = linkEntries.length * 2;
              g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
              g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
              // R3F's JSX `bufferGeometry` ref type carries a broader
              // attribute-map generic (it also permits GL buffer
              // attributes) than the plain `THREE.BufferGeometry` this ref
              // is typed as elsewhere; the runtime object is the same real
              // `THREE.BufferGeometry` either way.
              linksGeometryRef.current = g as unknown as THREE.BufferGeometry;
              rebuildLinks();
            }
          }}
        />
        <lineBasicMaterial vertexColors transparent opacity={1} depthWrite={false} />
      </lineSegments>
    </>
  );
}

export interface GraphSceneBProps {
  fixture: BakeoffFixture;
  callbacks: SceneCallbacks;
}

/** Top-level Prototype B component: owns the `<Canvas>` (the one renderer
 * lifecycle owner, charter §14) and forwards an imperative API so the
 * `GraphPrototypeHandle` wrapper (`index.tsx`) can drive it without any
 * prop-driven remount for selection/focus/filter/resize. */
export const GraphSceneB = forwardRef<SceneImperativeApi, GraphSceneBProps>(function GraphSceneB(
  { fixture, callbacks },
  ref,
) {
  const apiRef = useRef<SceneImperativeApi | null>(null);

  useImperativeHandle(ref, () => ({
    select: (nodeId) => apiRef.current?.select(nodeId),
    focus: (nodeId) => apiRef.current?.focus(nodeId),
    home: () => apiRef.current?.home(),
    fit: () => apiRef.current?.fit(),
    setFilter: (predicate) => apiRef.current?.setFilter(predicate),
    resize: () => apiRef.current?.resize(),
    getCameraPose: () =>
      apiRef.current?.getCameraPose() ?? { position: [0, 0, 300], target: [0, 0, 0] },
    getNodeScreenPosition: (nodeId) => apiRef.current?.getNodeScreenPosition(nodeId) ?? null,
    isHighlightConfirmed: (nodeId) => apiRef.current?.isHighlightConfirmed(nodeId) ?? false,
    readLifecycleSnapshot: (cycle) =>
      apiRef.current?.readLifecycleSnapshot(cycle) ?? {
        cycle,
        geometries: 0,
        textures: 0,
        programs: 0,
        activeWorkers: 0,
        activeObservers: 0,
        activeTimers: 0,
        registeredListeners: 0,
      },
  }));

  return (
    <Canvas
      data-testid="proto-b-canvas"
      camera={{ fov: VERTICAL_FOV_DEG, near: 1, far: 100000, up: [0, 0, 1] }}
      dpr={[1, 1.5]}
      gl={{ antialias: true }}
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <SceneContent fixture={fixture} apiRef={apiRef} callbacks={callbacks} />
    </Canvas>
  );
});
