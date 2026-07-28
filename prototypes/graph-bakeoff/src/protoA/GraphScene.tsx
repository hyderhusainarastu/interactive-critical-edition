/**
 * Prototype A scene — clean `react-force-graph-3d` (charter §13/§10/§11).
 *
 * Architecture notes (why it's built this way):
 *
 *  - `graphData` is built exactly once per fixture (`useMemo` keyed on
 *    `fixture.contentHash`) and its object/array *references* never change
 *    for the life of this component. `three-forcegraph` treats a new
 *    `graphData` prop reference as a hard reset (it flips `engineRunning`
 *    false and re-seeds); ordinary interactions (select/hover/filter) must
 *    never trigger that, so they mutate node/link fields in place instead.
 *
 *  - `nodeThreeObject` is a single stable function (built once via
 *    `useCallback(..., [])`), reading only refs. It is therefore never
 *    itself a reason for react-force-graph-3d's kapsule digest to rebuild
 *    node objects. Selection/hover rings are toggled by calling the cached
 *    `NodeVisual`'s own `setSelected`/`setHovered` directly — bypassing
 *    React entirely — so a click/hover never remounts or rebuilds anything
 *    (charter §14: "No renderer remount for selection ... or ordinary
 *    filter changes").
 *
 *  - `selectedId`/`hoveredId`/`filterVersion` ARE plain React state. That's
 *    intentional, not a violation of "no state updates in the frame loop":
 *    those are discrete, user-driven events (a handful of times a second at
 *    most), completely different from the continuous per-frame work (label
 *    positions, orbit-metrics sampling) which is done in this component's
 *    own `requestAnimationFrame` loop and never touches React state.
 *
 *  - Node "importance" scale (charter §10 sizing formula) is applied by
 *    directly mutating each cached `NodeVisual.object.scale`, both once at
 *    mount (from the fixture's precomputed full-graph degree) and again
 *    inside `setFilter()` (recomputed over the new visible set). This keeps
 *    size responsive to filtering without going through nodeThreeObject
 *    rebuilds.
 *
 *  - Band Z is assigned in two passes: let the simulation free-settle in
 *    X/Y/Z once (so a real median XY link distance exists), then pin every
 *    node's `fz` from `computeBandGap`/`bandZ` and call
 *    `d3ReheatSimulation()` once. `d3AlphaMin` is set explicitly (the
 *    library's own default relies on a 15s wall-clock cooldown otherwise,
 *    far slower than a real alpha-decay convergence check).
 *
 *  - Documented gap: exact dash/dot-dash edge patterns (charter §10) are
 *    not built here — the charter explicitly allows preserving the
 *    family distinction through color/opacity/arrow/legend instead "where
 *    the chosen renderer cannot provide portable subpixel patterns without
 *    violating the performance gate", which is the tradeoff made here for
 *    the 500/1000-link fixtures. See `docs/audits/graph-renderer-bakeoff.md`
 *    (written by the bakeoff-decision lane) for how this weighs against
 *    Prototype B.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import ForceGraph3D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-3d";
import * as THREE from "three";

import type { BakeoffFixture, FixtureLink, FixtureNode } from "../fixtures/types";
import type { CameraPose, NodeFilterPredicate, PrototypeCallbacks } from "../types/prototype";
import {
  boundingBoxCenter,
  computeBoundingBox,
  computeFit,
  computeFocusPose,
  computeHomePose,
  DEFAULT_FOCUS_TWEEN_MS,
  type Vec3,
} from "../camera/cameraMath";
import { computeBandGap, computeFixedZ, medianXYLinkDistance, seededInitialPosition } from "./layout";
import { computeNodeScale, computeVisibleDegrees, percentileOf } from "./sizing";
import { NodeVisualFactory, type NodeVisual } from "./nodeVisuals";
import {
  BACKDROP_COLOR,
  DEFAULT_LINK_OPACITY,
  EDGE_VISUALS,
  GRID_COLOR,
  GRID_OPACITY,
  SELECTED_NEIGHBORHOOD_LINK_OPACITY,
  UNRELATED_WHILE_SELECTED_LINK_OPACITY,
} from "./theme";
import { LabelLayer, type LabelCandidate } from "./labelLayer";
import { ResourceTracker, readLifecycleSnapshot } from "./lifecycle";

type GNode = NodeObject<FixtureNode>;
type GLink = LinkObject<FixtureNode, FixtureLink>;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const INITIAL_SPACING = 26;
const D3_ALPHA_MIN = 0.01;
const MOBILE_WIDTH_BREAKPOINT = 640;
const MAX_PRIORITY_LABELS_DESKTOP = 20;
const MAX_PRIORITY_LABELS_MOBILE = 10;

function endpointId(endpoint: unknown): string {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object" && "id" in endpoint) return String((endpoint as { id: unknown }).id);
  return String(endpoint);
}

function endpointNode(endpoint: unknown): GNode | null {
  if (endpoint && typeof endpoint === "object" && "x" in endpoint) return endpoint as GNode;
  return null;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function reducedMotionActive(): boolean {
  return typeof window !== "undefined" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export interface GraphSceneApi {
  select(nodeId: string | null): void;
  focus(nodeId: string): void;
  home(): void;
  fit(): void;
  setFilter(predicate: NodeFilterPredicate | null): void;
  resize(): void;
  getCameraPose(): CameraPose;
  getNodeScreenPosition(nodeId: string): { x: number; y: number } | null;
  isHighlightConfirmed(nodeId: string): boolean;
  readLifecycleSnapshot(cycle: number): ReturnType<typeof readLifecycleSnapshot>;
}

export interface GraphSceneProps {
  fixture: BakeoffFixture;
  callbacks: PrototypeCallbacks;
  /** Fired once the scene is genuinely attached and interactive-eligible
   * (charter bakeoff "interactive" definition) with the imperative API the
   * outer `GraphPrototypeHandle` drives. */
  onReady: (api: GraphSceneApi) => void;
  apiRef: { current: GraphSceneApi | null };
}

export function GraphScene({ fixture, callbacks, onReady, apiRef }: GraphSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const visualFactoryRef = useRef<NodeVisualFactory | null>(null);
  const nodeVisualById = useRef(new Map<string, NodeVisual>());
  const labelLayerRef = useRef<LabelLayer | null>(null);
  const trackerRef = useRef<ResourceTracker | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const contextLostHandlerRef = useRef<((e: Event) => void) | null>(null);
  const contextRestoredHandlerRef = useRef<(() => void) | null>(null);
  const rendererDomRef = useRef<HTMLCanvasElement | null>(null);

  const selectedIdRef = useRef<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const filterRef = useRef<NodeFilterPredicate | null>(null);
  const layoutPhaseRef = useRef<"settling" | "banded" | "frozen">("settling");
  const bandGapRef = useRef(60);
  const confirmedIdRef = useRef<string | null>(null);
  const pendingConfirmRef = useRef<string | null>(null);
  const upVectorSetRef = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [filterVersion, setFilterVersion] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // --- Frozen, once-built graph data (charter: canonical graph data
  // immutable; deterministic layout seed) ---
  const graphData = useMemo(() => {
    const nodes: GNode[] = fixture.nodes.map((n, i) => {
      const initial = seededInitialPosition(i, fixture.seed, INITIAL_SPACING);
      return { ...n, x: initial.x, y: initial.y, z: 0 } as GNode;
    });
    const links: GLink[] = fixture.links.map((l) => ({ ...l }) as GLink);
    return { nodes, links };
    // fixture.contentHash uniquely identifies this fixture's data; fixture
    // itself is never swapped in place for a live GraphScene instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixture.contentHash]);

  const nodesById = useMemo(() => new Map(graphData.nodes.map((n) => [n.id as string, n])), [graphData]);
  const rootNode = useMemo(() => graphData.nodes.find((n) => n.isRoot) ?? null, [graphData]);

  const neighborsOf = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const n of graphData.nodes) map.set(n.id as string, new Set());
    for (const l of graphData.links) {
      if (l.isSelfLink) continue;
      map.get(l.source as string)?.add(l.target as string);
      map.get(l.target as string)?.add(l.source as string);
    }
    return map;
  }, [graphData]);

  const evidenceNeighborsOfRoot = useMemo(() => {
    const set = new Set<string>();
    if (!rootNode) return set;
    for (const l of graphData.links) {
      if (l.isSelfLink) continue;
      const otherEnd = l.source === rootNode.id ? (l.target as string) : l.target === rootNode.id ? (l.source as string) : null;
      if (!otherEnd) continue;
      const n = nodesById.get(otherEnd);
      if (n && (n.displayKind === "claim" || n.displayKind === "evidence")) set.add(otherEnd);
    }
    return set;
  }, [graphData, rootNode, nodesById]);

  const p95FullDegree = useMemo(() => percentileOf(graphData.nodes.map((n) => n.degree), 95), [graphData]);

  // Parallel/self-link curvature, computed once (charter: "Curves only for
  // self-links and parallel edges").
  const curvatureById = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of graphData.links) {
      if (l.isSelfLink) {
        map.set(l.id, 0.65);
      } else if (l.parallelOf !== null) {
        map.set(l.id, 0.32);
        map.set(l.parallelOf, -0.32);
      }
    }
    return map;
  }, [graphData]);

  const isNodeVisible = useCallback(
    (node: Pick<FixtureNode, "id" | "displayKind" | "isRoot" | "isHub" | "degree" | "layer" | "bandIndex" | "label" | "unavailableReason">) =>
      !filterRef.current || filterRef.current(node as FixtureNode),
    [],
  );

  const isLinkVisible = useCallback(
    (link: GLink) => {
      const sourceNode = endpointNode(link.source) ?? nodesById.get(endpointId(link.source));
      const targetNode = endpointNode(link.target) ?? nodesById.get(endpointId(link.target));
      if (!sourceNode || !targetNode) return true;
      return isNodeVisible(sourceNode) && isNodeVisible(targetNode);
    },
    [isNodeVisible, nodesById],
  );

  // --- Node visuals: built once per node id, cached; never rebuilt on
  // selection/hover/filter (see top comment). ---
  const nodeThreeObject = useCallback((node: GNode): THREE.Object3D => {
    const factory = visualFactoryRef.current;
    if (!factory) return new THREE.Object3D();
    const id = node.id as string;
    let visual = nodeVisualById.current.get(id);
    if (!visual) {
      visual = factory.build(node);
      nodeVisualById.current.set(id, visual);
      const scale = computeNodeScale({
        isRoot: node.isRoot,
        visibleDegree: node.degree,
        p95VisibleDegree: p95FullDegree,
        isDirectEvidenceNeighborOfRoot: evidenceNeighborsOfRoot.has(id),
        isAggregate: node.displayKind === "aggregate",
      });
      visual.object.scale.setScalar(scale);
    }
    return visual.object;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Camera helpers ---
  const currentFov = useCallback((): number => {
    const cam = fgRef.current?.camera() as THREE.PerspectiveCamera | undefined;
    return cam?.fov ?? 50;
  }, []);

  const currentPoseVectors = useCallback((): { position: Vec3; target: Vec3 } => {
    const cam = fgRef.current?.camera();
    const controls = fgRef.current?.controls() as { target?: THREE.Vector3 } | undefined;
    const position: Vec3 = cam ? [cam.position.x, cam.position.y, cam.position.z] : [0, 0, 0];
    const target: Vec3 = controls?.target ? [controls.target.x, controls.target.y, controls.target.z] : [0, 0, 0];
    return { position, target };
  }, []);

  const visiblePoints = useCallback((): Vec3[] => {
    const pts: Vec3[] = [];
    for (const n of graphData.nodes) {
      if (!isNodeVisible(n)) continue;
      pts.push([n.x ?? 0, n.y ?? 0, n.z ?? 0]);
    }
    return pts.length > 0 ? pts : [[0, 0, 0]];
  }, [graphData, isNodeVisible]);

  const applyHome = useCallback(
    (animated: boolean) => {
      const fg = fgRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!fg || !rect || rect.width === 0 || rect.height === 0) return;
      const box = computeBoundingBox(visiblePoints());
      const home = computeHomePose({ boundingBox: box, viewportWidth: rect.width, viewportHeight: rect.height, verticalFovDeg: currentFov() });
      const ms = animated && !reducedMotionActive() ? DEFAULT_FOCUS_TWEEN_MS : 0;
      fg.cameraPosition({ x: home.position[0], y: home.position[1], z: home.position[2] }, { x: home.target[0], y: home.target[1], z: home.target[2] }, ms);
    },
    [visiblePoints, currentFov],
  );

  const applyFit = useCallback(() => {
    const fg = fgRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!fg || !rect || rect.width === 0 || rect.height === 0) return;
    const box = computeBoundingBox(visiblePoints());
    const fitResult = computeFit({ boundingBox: box, viewportWidth: rect.width, viewportHeight: rect.height, verticalFovDeg: currentFov() });
    const { position, target } = currentPoseVectors();
    const focusResult = computeFocusPose({ currentCameraPosition: position, currentControlsTarget: target, newTarget: fitResult.target, distance: fitResult.distance });
    const ms = reducedMotionActive() ? 0 : DEFAULT_FOCUS_TWEEN_MS;
    fg.cameraPosition(
      { x: focusResult.position[0], y: focusResult.position[1], z: focusResult.position[2] },
      { x: focusResult.target[0], y: focusResult.target[1], z: focusResult.target[2] },
      ms,
    );
  }, [visiblePoints, currentFov, currentPoseVectors]);

  const applyFocus = useCallback(
    (nodeId: string) => {
      const fg = fgRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      const node = nodesById.get(nodeId);
      if (!fg || !rect || !node) return;
      const neighborIds = neighborsOf.get(nodeId) ?? new Set<string>();
      const points: Vec3[] = [[node.x ?? 0, node.y ?? 0, node.z ?? 0]];
      for (const nid of neighborIds) {
        const n = nodesById.get(nid);
        if (n && isNodeVisible(n)) points.push([n.x ?? 0, n.y ?? 0, n.z ?? 0]);
      }
      const box = computeBoundingBox(points);
      const fitResult = computeFit({ boundingBox: box, viewportWidth: rect.width, viewportHeight: rect.height, verticalFovDeg: currentFov() });
      const { position, target } = currentPoseVectors();
      const focusResult = computeFocusPose({ currentCameraPosition: position, currentControlsTarget: target, newTarget: fitResult.target, distance: fitResult.distance });
      const ms = reducedMotionActive() ? 0 : DEFAULT_FOCUS_TWEEN_MS;
      fg.cameraPosition(
        { x: focusResult.position[0], y: focusResult.position[1], z: focusResult.position[2] },
        { x: focusResult.target[0], y: focusResult.target[1], z: focusResult.target[2] },
        ms,
      );
      callbacks.onFocus?.(nodeId);
    },
    [nodesById, neighborsOf, isNodeVisible, currentFov, currentPoseVectors, callbacks],
  );

  const applySelection = useCallback(
    (nodeId: string | null) => {
      const previous = selectedIdRef.current;
      if (previous === nodeId) return;
      if (previous) nodeVisualById.current.get(previous)?.setSelected(false);
      if (nodeId) nodeVisualById.current.get(nodeId)?.setSelected(true);
      selectedIdRef.current = nodeId;
      pendingConfirmRef.current = nodeId;
      setSelectedId(nodeId);
      callbacks.onSelect?.(nodeId);
    },
    [callbacks],
  );

  const applyFilter = useCallback(
    (predicate: NodeFilterPredicate | null) => {
      filterRef.current = predicate;
      const visibleIds = new Set(graphData.nodes.filter((n) => isNodeVisible(n)).map((n) => n.id as string));
      const { visibleDegreeById, p95VisibleDegree } = computeVisibleDegrees(
        [...visibleIds],
        graphData.links.map((l) => ({ source: l.source as string, target: l.target as string, isSelfLink: l.isSelfLink })),
        (l) => visibleIds.has(l.source) && visibleIds.has(l.target),
      );
      for (const n of graphData.nodes) {
        const id = n.id as string;
        const visual = nodeVisualById.current.get(id);
        if (!visual) continue;
        if (!visibleIds.has(id)) continue; // keep last-known scale for hidden nodes
        const scale = computeNodeScale({
          isRoot: n.isRoot,
          visibleDegree: visibleDegreeById.get(id) ?? 0,
          p95VisibleDegree,
          isDirectEvidenceNeighborOfRoot: evidenceNeighborsOfRoot.has(id),
          isAggregate: n.displayKind === "aggregate",
        });
        visual.object.scale.setScalar(scale);
      }
      setFilterVersion((v) => v + 1);
    },
    [graphData, isNodeVisible, evidenceNeighborsOfRoot],
  );

  // --- Imperative API exposed to the outer GraphPrototypeHandle ---
  const api: GraphSceneApi = useMemo(
    () => ({
      select: applySelection,
      focus: applyFocus,
      home: () => applyHome(true),
      fit: applyFit,
      setFilter: applyFilter,
      resize: () => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) setDimensions({ width: rect.width, height: rect.height });
      },
      getCameraPose: (): CameraPose => {
        const { position, target } = currentPoseVectors();
        return { position, target };
      },
      getNodeScreenPosition: (nodeId: string) => {
        const fg = fgRef.current;
        const node = nodesById.get(nodeId);
        if (!fg || !node || !isNodeVisible(node)) return null;
        const coords = fg.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
        if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return null;
        return { x: coords.x, y: coords.y };
      },
      isHighlightConfirmed: (nodeId: string) => confirmedIdRef.current === nodeId,
      readLifecycleSnapshot: (cycle: number) => readLifecycleSnapshot(fgRef.current?.renderer() ?? null, trackerRef.current, cycle),
    }),
    [applySelection, applyFocus, applyHome, applyFit, applyFilter, currentPoseVectors, nodesById, isNodeVisible],
  );

  useEffect(() => {
    apiRef.current = api;
  }, [api, apiRef]);

  // --- Mount-time setup: factory/tracker/label-layer/ResizeObserver, and
  // teardown of all of it on unmount (charter §14). ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    visualFactoryRef.current = new NodeVisualFactory();
    const tracker = new ResourceTracker();
    trackerRef.current = tracker;
    labelLayerRef.current = new LabelLayer(container);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setDimensions({ width, height });
    });
    observer.observe(container);
    resizeObserverRef.current = observer;
    tracker.trackObserver(observer);

    const initialRect = container.getBoundingClientRect();
    setDimensions({ width: initialRect.width, height: initialRect.height });

    return () => {
      observer.disconnect();
      tracker.untrackObserver(observer);
      resizeObserverRef.current = null;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        tracker.untrackTimer(rafIdRef.current);
        rafIdRef.current = null;
      }

      const canvas = rendererDomRef.current;
      if (canvas && contextLostHandlerRef.current) {
        canvas.removeEventListener("webglcontextlost", contextLostHandlerRef.current);
        tracker.removeListener();
      }
      if (canvas && contextRestoredHandlerRef.current) {
        canvas.removeEventListener("webglcontextrestored", contextRestoredHandlerRef.current);
        tracker.removeListener();
      }
      rendererDomRef.current = null;

      labelLayerRef.current?.dispose();
      labelLayerRef.current = null;

      visualFactoryRef.current?.dispose();
      visualFactoryRef.current = null;
      nodeVisualById.current.clear();

      tracker.disposeAll();
      trackerRef.current = null;

      fgRef.current = undefined;
    };
    // Mount/unmount only — this effect must not re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- One-time scene setup, gated on `<ForceGraph3D>` actually having
  // rendered (only true once `dimensions` is nonzero — see the JSX below).
  // Z-up camera (charter §8/§11), the low-opacity reference grid, WebGL
  // context-loss wiring, and the "interactive" callback all belong here
  // rather than the mount effect above, since `fgRef.current` is only
  // populated once `<ForceGraph3D>` itself has mounted. Guarded by
  // `upVectorSetRef` so it runs exactly once even across a dimensions
  // 0→nonzero→(temporarily 0)→nonzero wobble. ---
  const hasSize = dimensions.width > 0 && dimensions.height > 0;
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !hasSize || upVectorSetRef.current) return;
    upVectorSetRef.current = true;

    const camera = fg.camera() as THREE.PerspectiveCamera;
    camera.up.set(0, 0, 1);
    const controls = fg.controls() as { update?: () => void };
    controls.update?.();

    // Frame immediately from the deterministic seeded initial layout
    // (charter: Home must always be reproducible from data alone) rather
    // than leaving the camera at the library's own generic default pose —
    // full convergence (two engine-stop passes, see `handleEngineStop`)
    // can take several seconds on the larger fixtures, and the camera
    // shouldn't sit unframed for all of that. `applyHome` is called again
    // once band-Z settles, refining this initial estimate with real
    // positions.
    applyHome(false);

    const scene = fg.scene();
    const grid = new THREE.GridHelper(400, 20, GRID_COLOR, GRID_COLOR);
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of gridMaterials) {
      mat.transparent = true;
      mat.opacity = GRID_OPACITY;
    }
    grid.rotation.x = Math.PI / 2; // lie flat in the X/Y plane (Z-up world)
    scene.add(grid);

    const renderer = fg.renderer();
    const canvas = renderer.domElement;
    rendererDomRef.current = canvas;

    const onContextLost = (event: Event) => {
      event.preventDefault();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        trackerRef.current?.untrackTimer(rafIdRef.current);
        rafIdRef.current = null;
      }
      callbacks.onContextLost?.();
    };
    const onContextRestored = () => {
      callbacks.onContextRestored?.();
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    contextLostHandlerRef.current = onContextLost;
    contextRestoredHandlerRef.current = onContextRestored;
    trackerRef.current?.addListener();
    trackerRef.current?.addListener();

    callbacks.onInteractive?.();
    // Resolve the outer handle's `mount()` promise only now — the scene is
    // genuinely attached (nonzero-size canvas, camera oriented, picking
    // live via onNodeClick/onNodeHover already wired in the JSX below) —
    // not merely scheduled. `api`/`onReady` are intentionally omitted from
    // this effect's deps (see the eslint-disable below): both are
    // referentially stable for this component's whole lifetime, so reading
    // them via closure here is safe and keeps this effect gated purely by
    // `hasSize`/`upVectorSetRef`.
    onReady(api);

    return () => {
      scene.remove(grid);
      grid.geometry.dispose();
      for (const mat of gridMaterials) mat.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSize]);

  // --- Per-frame loop: label positions + orbit-frame callback. Never
  // touches React state (charter §14). ---
  useEffect(() => {
    const tick = (timestampMs: number) => {
      // This frame's id has now fired — untrack it before requesting (and
      // tracking) the next one, so the tracker's active-timer count always
      // reflects "one rAF pending", never the cumulative history of every
      // frame id ever requested since mount (that monotonic-growth bug is
      // exactly what charter §13 step 9's lifecycle check exists to catch).
      if (rafIdRef.current !== null) trackerRef.current?.untrackTimer(rafIdRef.current);

      const fg = fgRef.current;
      if (fg && labelLayerRef.current && containerRef.current) {
        if (pendingConfirmRef.current !== null || (pendingConfirmRef.current === null && confirmedIdRef.current !== selectedIdRef.current)) {
          confirmedIdRef.current = pendingConfirmRef.current ?? selectedIdRef.current;
          pendingConfirmRef.current = null;
        }

        const rect = containerRef.current.getBoundingClientRect();
        const isMobile = rect.width > 0 && rect.width < MOBILE_WIDTH_BREAKPOINT;
        const maxPriority = isMobile ? MAX_PRIORITY_LABELS_MOBILE : MAX_PRIORITY_LABELS_DESKTOP;
        const selected = selectedIdRef.current;
        const hovered = hoveredIdRef.current;
        const alwaysShowIds = new Set<string>();
        if (rootNode) alwaysShowIds.add(rootNode.id as string);
        if (selected) {
          alwaysShowIds.add(selected);
          for (const nid of neighborsOf.get(selected) ?? []) alwaysShowIds.add(nid);
        }
        if (hovered) alwaysShowIds.add(hovered);

        const candidates: LabelCandidate[] = [];
        for (const n of graphData.nodes) {
          const id = n.id as string;
          if (!isNodeVisible(n)) continue;
          const coords = fg.graph2ScreenCoords(n.x ?? 0, n.y ?? 0, n.z ?? 0);
          const always = alwaysShowIds.has(id);
          candidates.push({
            id,
            text: n.label,
            x: coords.x,
            y: coords.y,
            alwaysShow: always,
            degree: n.degree,
            tier: id === selected || id === hovered || n.isRoot ? "primary" : always ? "priority" : "secondary",
          });
        }
        labelLayerRef.current.update(candidates, maxPriority, rect.width, rect.height);
      }
      callbacks.onFrame?.(timestampMs);
      rafIdRef.current = requestAnimationFrame(tick);
      if (trackerRef.current && rafIdRef.current !== null) trackerRef.current.trackTimer(rafIdRef.current);
    };
    rafIdRef.current = requestAnimationFrame(tick);
    if (trackerRef.current && rafIdRef.current !== null) trackerRef.current.trackTimer(rafIdRef.current);
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        trackerRef.current?.untrackTimer(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, neighborsOf, rootNode, isNodeVisible, callbacks]);

  const handleEngineStop = useCallback(() => {
    if (layoutPhaseRef.current === "settling") {
      const positionById = new Map(graphData.nodes.map((n) => [n.id as string, { x: n.x ?? 0, y: n.y ?? 0 }]));
      const median = medianXYLinkDistance(fixture.links, positionById);
      const bandGap = computeBandGap(median || 40);
      bandGapRef.current = bandGap;
      for (const n of graphData.nodes) {
        n.fz = computeFixedZ(n, bandGap);
      }
      layoutPhaseRef.current = "banded";
      fgRef.current?.d3ReheatSimulation();
    } else if (layoutPhaseRef.current === "banded") {
      layoutPhaseRef.current = "frozen";
      applyHome(false);
    }
  }, [graphData, fixture, applyHome]);

  const handleNodeClick = useCallback(
    (node: GNode) => {
      if (!isNodeVisible(node)) return;
      applySelection(node.id as string);
    },
    [applySelection, isNodeVisible],
  );

  const handleNodeHover = useCallback(
    (node: GNode | null) => {
      const id = node && isNodeVisible(node) ? (node.id as string) : null;
      const previous = hoveredIdRef.current;
      if (previous === id) return;
      if (previous) nodeVisualById.current.get(previous)?.setHovered(false);
      if (id) nodeVisualById.current.get(id)?.setHovered(true);
      hoveredIdRef.current = id;
      setHoveredId(id);
    },
    [isNodeVisible],
  );

  const handleBackgroundClick = useCallback(() => {
    applySelection(null);
  }, [applySelection]);

  const linkColorAccessor = useCallback(
    (link: GLink) => {
      const family = EDGE_VISUALS[link.displayFamily];
      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      let alpha = DEFAULT_LINK_OPACITY;
      if (selectedId) {
        alpha = sourceId === selectedId || targetId === selectedId ? SELECTED_NEIGHBORHOOD_LINK_OPACITY : UNRELATED_WHILE_SELECTED_LINK_OPACITY;
      }
      return rgba(family.color, alpha);
    },
    [selectedId],
  );

  const linkWidthAccessor = useCallback((link: GLink) => EDGE_VISUALS[link.displayFamily].widthPx, []);

  const linkArrowLengthAccessor = useCallback(
    (link: GLink) => {
      if (!link.directed) return 0;
      const family = EDGE_VISUALS[link.displayFamily];
      if (family.arrow) return 3.2;
      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      if (selectedId && (sourceId === selectedId || targetId === selectedId)) return 3.2;
      return 0;
    },
    [selectedId],
  );

  const linkCurvatureAccessor = useCallback((link: GLink) => curvatureById.get(link.id) ?? 0, [curvatureById]);

  const nodeVisibilityAccessor = useCallback((node: GNode) => isNodeVisible(node), [isNodeVisible, filterVersion]);
  const linkVisibilityAccessor = useCallback((link: GLink) => isLinkVisible(link), [isLinkVisible, filterVersion]);

  const handleEngineTick = useCallback(() => {
    // Intentionally empty: presence of onEngineTick lets us later hook
    // per-tick diagnostics without adding a second render-loop consumer.
    // No React state is touched here (charter §14 frame-loop rule).
  }, []);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }} data-testid="proto-a-container">
      {dimensions.width > 0 && dimensions.height > 0 && (
        <ForceGraph3D<FixtureNode, FixtureLink>
          ref={fgRef as MutableRefObject<ForceGraphMethods<GNode, GLink> | undefined>}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor={BACKDROP_COLOR}
          showNavInfo={false}
          numDimensions={3}
          d3AlphaMin={D3_ALPHA_MIN}
          warmupTicks={0}
          nodeThreeObject={nodeThreeObject}
          nodeThreeObjectExtend={false}
          nodeVisibility={nodeVisibilityAccessor}
          nodeLabel={() => ""}
          linkVisibility={linkVisibilityAccessor}
          linkColor={linkColorAccessor}
          linkWidth={linkWidthAccessor}
          linkCurvature={linkCurvatureAccessor}
          linkDirectionalArrowLength={linkArrowLengthAccessor}
          linkDirectionalArrowRelPos={1}
          linkOpacity={1}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={handleBackgroundClick}
          onEngineStop={handleEngineStop}
          onEngineTick={handleEngineTick}
          enableNodeDrag={false}
        />
      )}
    </div>
  );
}
