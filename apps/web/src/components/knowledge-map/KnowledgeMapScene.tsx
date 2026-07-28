/**
 * The Knowledge Map 3D scene (charter §10/§14, spec §1.1). Mounts
 * `<ForceGraph3D>`, owns the frozen `graphData` memo, `nodeThreeObject`,
 * click/hover/background handlers, engine-stop band-Z pinning, WebGL
 * context-loss listeners, the per-frame label/orbit `requestAnimationFrame`
 * loop, and full lifecycle disposal.
 *
 * Ported from `prototypes/graph-bakeoff/src/protoA/GraphScene.tsx`
 * (748 lines, per spec §1.1) with camera math extracted into
 * `useKnowledgeMapCamera` (that extraction is exactly why this file isn't
 * also 748 lines) and every fixture-specific field (`FixtureNode.degree`/
 * `.isRoot`/`.isHub`, `FixtureLink.isSelfLink`/`.parallelOf`) replaced by
 * an equivalent computed once per (stable) `nodes`/`links` prop pair — see
 * §1.4's "bakeoff fixture field -> production equivalent" table, which
 * this file implements literally.
 *
 * ## Topology vs. visibility (reconciling spec §2's data-flow diagram with
 * charter §14's "no renderer remount for ... ordinary filter changes")
 *
 * Spec §2 draws ONE filtered `DisplayNode[]`/`DisplayLink[]` selection
 * flowing into "3D Scene / 2D View / List View / InspectorDrawer" as a
 * single pipeline stage. Taken completely literally, that would mean this
 * component's `nodes`/`links` props change identity on every ordinary
 * attribute-filter change (search/state/type/...) — which would force
 * `react-force-graph-3d`'s `graphData` prop to a new reference, and
 * `three-forcegraph` treats a new `graphData` reference as a hard reset
 * (flips `engineRunning` false, re-seeds), directly violating charter §14
 * ("No renderer remount for selection, inspector, or ordinary filter
 * changes... Preserve coordinates across selection and filter changes").
 *
 * `protoA/GraphScene.tsx` already resolved exactly this tension for the
 * bakeoff, and this port keeps its resolution: `nodes`/`links` here are the
 * current DISCLOSED TOPOLOGY (root + everything `initialNeighborhood`/
 * `expandNeighborhood`/`enforceVisibleCap` have admitted so far — i.e. the
 * charter §8 disclosure/expansion state, which only grows on a genuine
 * expansion action, never on an ordinary attribute-filter change), fed to
 * `<ForceGraph3D>` as a stable-by-reference `graphData` for as long as that
 * topology hasn't changed. `visibleNodeIds` is a SEPARATE, independently-
 * changing prop representing the current attribute filter's result over
 * that topology — it drives `nodeVisibility`/`linkVisibility` accessors
 * (visibility toggling, not array membership), so an ordinary filter
 * change never touches `graphData` identity at all. `KnowledgeMapWorkspace`
 * (a later Stage 3 step, not built here) is what actually computes both:
 * the "topology so far" array (stable across filter changes) and the
 * "currently filtered" id set (the thing that changes on every keystroke
 * in a search box).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import ForceGraph3D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-3d";
import * as THREE from "three";

import { distanceToTarget, zForLayer, type Layer, type Vec3 } from "@ice/graph-display";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";
import { computeBandGap, computeFixedZ, medianXYLinkDistance, seededInitialPosition } from "./layout";
import { computeNodeScale, computeVisibleDegrees } from "./sizing";
import { NodeVisualFactory, type CredibilityRingInput, type NodeVisual } from "./nodeVisuals";
import {
  BACKDROP_COLOR,
  DEFAULT_LINK_OPACITY,
  EDGE_VISUALS,
  GRID_COLOR,
  GRID_OPACITY,
  LAYER_GUIDE_OPACITY,
  LAYER_GUIDE_ORDER,
  LAYER_GUIDE_PLANE_COLOR,
  LAYER_LABEL,
  SELECTED_NEIGHBORHOOD_LINK_OPACITY,
  UNRELATED_WHILE_SELECTED_LINK_OPACITY,
} from "./theme";
import { LabelLayer, type LabelCandidate } from "./labelLayer";
import { useKnowledgeMapCamera, type KnowledgeMapCameraApi, type OrientationPreset } from "./useKnowledgeMapCamera";
import {
  nextKnowledgeMapMountId,
  registerKnowledgeMapTestHook,
  unregisterKnowledgeMapTestHook,
  type KnowledgeMapTestHook,
} from "./testBridge";

/** A link augmented, once per stable `links` array, with the two
 *  bakeoff-fixture-only fields §1.4's table says must now be computed at
 *  scene-build time: self-link/parallel-link identification (charter
 *  "Curves only for self-links and parallel edges"). */
type AugmentedLink = KnowledgeMapDisplayLink & { isSelfLink: boolean };

type GNode = NodeObject<KnowledgeMapDisplayNode>;
type GLink = LinkObject<KnowledgeMapDisplayNode, AugmentedLink>;

const INITIAL_SPACING = 26;
const D3_ALPHA_MIN = 0.01;
const MOBILE_WIDTH_BREAKPOINT = 640;
const MAX_PRIORITY_LABELS_DESKTOP = 20;
const MAX_PRIORITY_LABELS_MOBILE = 10;
/** Fixed, not per-dataset (charter §14's "deterministic layout seed" only
 *  requires the SAME data to reproduce the SAME layout across mounts, not
 *  that different datasets look visually distinct from each other's
 *  spiral). A per-node id-derived jitter (`seededInitialPosition`) already
 *  keeps two different datasets from looking identically bare. */
const LAYOUT_SEED = 0x5eed;

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

/** Minimal, scene-instance-scoped resource bookkeeping for charter §14
 *  teardown ("Dispose ... listeners, observers, timers"). Not the
 *  bakeoff's own `lifecycle.ts` (that module's `readLifecycleSnapshot`/
 *  `captureLifecycleAccessor` surface exists to back the Stage 2 bench
 *  harness's mount/unmount leak measurement — a testing concern, not a
 *  production one) — this is the smaller, production-only subset: just
 *  enough to guarantee every rAF id and every DOM listener this component
 *  registers is actually cancelled/removed on unmount. */
class SceneResourceTracker {
  private timerIds = new Set<number>();
  private listeners: Array<{ target: EventTarget; type: string; handler: EventListenerOrEventListenerObject }> = [];

  trackTimer(id: number): void {
    this.timerIds.add(id);
  }
  untrackTimer(id: number): void {
    this.timerIds.delete(id);
  }
  addListener(target: EventTarget, type: string, handler: EventListenerOrEventListenerObject): void {
    target.addEventListener(type, handler);
    this.listeners.push({ target, type, handler });
  }
  disposeAll(): void {
    for (const id of this.timerIds) cancelAnimationFrame(id);
    this.timerIds.clear();
    for (const { target, type, handler } of this.listeners) target.removeEventListener(type, handler);
    this.listeners = [];
  }
}

export interface KnowledgeMapSceneApi extends KnowledgeMapCameraApi {
  select(nodeId: string | null): void;
  getNodeScreenPosition(nodeId: string): { x: number; y: number } | null;
  applyOrientationPreset(preset: OrientationPreset): void;
  /** Focuses the camera on a node BY ID — the toolbar's "Focus" control
   *  (spec §1.1's `KnowledgeMapWorkspace.tsx`) needs this because, unlike
   *  the inline double-click handler, it has no live `Vec3` position of
   *  its own to pass to the inherited `focus(nodePosition, ...)`. A thin
   *  wrapper around the same internal `applyFocus` the double-click
   *  handler already calls — no new focus math, just an id-keyed entry
   *  point into it. A no-op when the node doesn't exist or isn't
   *  currently visible, same as the double-click path. */
  focusOnNode(nodeId: string): void;
  /** Live world X/Y of a currently-topology-known node — backs the
   *  toolbar's explicit "Pin" action (spec §4.3), which pins whatever
   *  position the node is CURRENTLY at (post-settle, or mid-drag) rather
   *  than requiring the user to drag it. `null` when the node isn't part
   *  of the current topology. */
  getNodePosition(nodeId: string): { x: number; y: number } | null;
  /** Fixes a node's live simulation `fx`/`fy` to exactly `position` — the
   *  same in-place mutation `handleEngineStop` already performs for `fz`
   *  (see that handler's own doc comment on why this is a different fact
   *  from charter §9's canonical-payload immutability). Z is deliberately
   *  untouched (Arrange never moves a node out of its semantic band,
   *  charter §8/§11) — only x/y are ever pinned. A no-op for an unknown
   *  node id. */
  pinNode(nodeId: string, position: { x: number; y: number }): void;
  /** Releases a node's `fx`/`fy` back to the force simulation (Z stays
   *  fixed, as above) — a no-op for an unknown or already-unpinned node
   *  id. */
  unpinNode(nodeId: string): void;
}

export interface KnowledgeMapSceneProps {
  /** The current disclosed TOPOLOGY — see this file's top comment for why
   *  this must stay reference-stable across ordinary filter changes and
   *  only grows on a genuine expansion/aggregation action. */
  nodes: KnowledgeMapDisplayNode[];
  links: KnowledgeMapDisplayLink[];
  /** `null`/`undefined` shows every node in `nodes` — the current
   *  attribute-filter's visible subset, independent of `nodes`/`links`
   *  identity (see top comment). Changing this alone never remounts or
   *  reheats the simulation. */
  visibleNodeIds?: ReadonlySet<string> | null;
  rootNodeId: string | null;
  selectedId: string | null;
  /** Node ids whose canonical `NodeState` is `"reading"` (charter §10
   *  "Reading state") — supplied by the caller since `DisplayNode` itself
   *  carries no state field (see `./adapter.ts`'s own scope note). */
  readingNodeIds?: ReadonlySet<string>;
  /** Per-node credibility dossier for the segmented ring (charter §10),
   *  again supplied by the caller for the same reason. */
  credibilityByNodeId?: ReadonlyMap<string, CredibilityRingInput>;
  onSelect?: (nodeId: string | null) => void;
  onHover?: (nodeId: string | null) => void;
  onFocus?: (nodeId: string) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
  onInteractive?: () => void;
  apiRef?: MutableRefObject<KnowledgeMapSceneApi | null>;
  /** Explicit Arrange mode (charter §11 "Arrange mode", spec §4.3) —
   *  `false`/omitted keeps ordinary navigation (`enableNodeDrag={false}`,
   *  the charter-mandated default). `true` enables node dragging AND wires
   *  `onArrangeNodeDragEnd` below; both flip together, never independently,
   *  so a caller can't accidentally leave drag enabled without a persist
   *  path or vice versa. */
  arrangeMode?: boolean;
  /** Positions previously pinned for THIS context (`arrangeStore.ts`,
   *  keyed by the caller's own `(userId, contextKind, contextId)` — this
   *  component knows nothing about that scoping, only the resolved
   *  node-id → position map for whatever's currently open). Applied via a
   *  dedicated effect (not inside `graphData`'s own `useMemo` — see that
   *  memo's doc comment for why reading this prop there would either
   *  violate the "no ref reads during render" rule or force an expensive
   *  full topology rebuild on every later pin/unpin) that mutates the
   *  already-built nodes' `x`/`y`/`fx`/`fy` in place — so a pinned node's
   *  position is deterministic from local storage on a fresh mount
   *  (charter §14 "deterministic layout seed" / spec §4.3), without ever
   *  discarding every OTHER node's already-settled position along the way. */
  pinnedPositions?: ReadonlyMap<string, { x: number; y: number }>;
  /** Fires once per completed drag while `arrangeMode` is true, with the
   *  node's final (post-drag) x/y — spec §4.3: "wires onNodeDragEnd to
   *  write the dragged node's final (x, y) ... into arrangeStore.ts's
   *  localStorage-backed map." This component does NOT touch
   *  `localStorage` itself (that stays the caller's job, same separation
   *  `KnowledgeMapWorkspace.tsx` already keeps for `recentContexts.ts`) —
   *  it only reports the drag outcome and locks the node's own `fx`/`fy`
   *  in the live simulation (see `handleNodeDragEnd`'s own comment for why
   *  the latter is necessary at all). */
  onArrangeNodeDragEnd?: (nodeId: string, position: { x: number; y: number }) => void;
  /** Charter §8 "Provide restrained layer-reference labels or planes at no
   *  more than 6% opacity when the layer guide is enabled." Toggled from
   *  the toolbar's secondary menu (spec §10's "advanced layout controls in
   *  secondary menus"), never on by default. */
  showLayerGuide?: boolean;
}

export function KnowledgeMapScene({
  nodes,
  links,
  visibleNodeIds,
  rootNodeId,
  selectedId: controlledSelectedId,
  readingNodeIds,
  credibilityByNodeId,
  onSelect,
  onHover,
  onFocus,
  onContextLost,
  onContextRestored,
  onInteractive,
  apiRef,
  arrangeMode,
  pinnedPositions,
  onArrangeNodeDragEnd,
  showLayerGuide,
}: KnowledgeMapSceneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const visualFactoryRef = useRef<NodeVisualFactory | null>(null);
  const nodeVisualById = useRef(new Map<string, NodeVisual>());
  const labelLayerRef = useRef<LabelLayer | null>(null);
  const trackerRef = useRef<SceneResourceTracker | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const rendererDomRef = useRef<HTMLCanvasElement | null>(null);
  const upVectorSetRef = useRef(false);
  const layoutPhaseRef = useRef<"settling" | "banded" | "frozen">("settling");
  const bandGapRef = useRef(60);
  /** Charter §8 layer-reference planes (`showLayerGuide` prop) — one
   *  translucent plane per band, repositioned once the real `BAND_GAP`
   *  emerges (same "settling" → "banded" transition `handleEngineStop`
   *  already drives for node `fz`, §14 below). Kept in a Map (not just the
   *  group) so that reposition step can address each plane by layer
   *  without a linear scan. */
  const layerPlanesGroupRef = useRef<THREE.Group | null>(null);
  const layerPlaneByLayerRef = useRef<Map<Layer, THREE.Mesh> | null>(null);

  const selectedIdRef = useRef<string | null>(controlledSelectedId);
  const hoveredIdRef = useRef<string | null>(null);

  // --- Test bridge (spec §7.3, ./testBridge.ts) — allocated once per real
  // component instance (guarded, not a plain `useRef(nextKnowledgeMapMountId())`
  // call, since THAT form would still evaluate the counter-increment
  // expression on every render even though only the FIRST render's result is
  // ever kept — wasteful and, more importantly, would make the id space less
  // obviously "one per mount" to a future reader). ---
  const testHookMountIdRef = useRef<number | null>(null);
  if (testHookMountIdRef.current === null) testHookMountIdRef.current = nextKnowledgeMapMountId();
  const testHookRef = useRef<KnowledgeMapTestHook | null>(null);
  const visibleNodeIdsRef = useRef(visibleNodeIds);
  const rootNodeIdRef = useRef(rootNodeId);
  const cameraApiRef = useRef<KnowledgeMapCameraApi | null>(null);
  useEffect(() => {
    visibleNodeIdsRef.current = visibleNodeIds;
  }, [visibleNodeIds]);
  useEffect(() => {
    rootNodeIdRef.current = rootNodeId;
  }, [rootNodeId]);

  const [selectedId, setSelectedId] = useState<string | null>(controlledSelectedId);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Keep the internal ref in sync with an externally-driven `selectedId`
  // prop change (e.g. a selection made from the List/2D view) — this is a
  // one-way sync (external -> internal), never the reverse, since the
  // internal click/background handlers are the source of truth for
  // selections that ORIGINATE in this scene.
  useEffect(() => {
    if (controlledSelectedId !== selectedIdRef.current) {
      const previous = selectedIdRef.current;
      if (previous) nodeVisualById.current.get(previous)?.setSelected(false);
      if (controlledSelectedId) nodeVisualById.current.get(controlledSelectedId)?.setSelected(true, credibilityByNodeId?.get(controlledSelectedId) ?? null);
      selectedIdRef.current = controlledSelectedId;
      setSelectedId(controlledSelectedId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSelectedId]);

  // --- Frozen, once-built graph data (charter: canonical graph data
  // immutable; deterministic layout seed; stable across filter changes —
  // see this file's top comment). Keyed on the `nodes`/`links` array
  // REFERENCES, which the caller (KnowledgeMapWorkspace, a later step) is
  // responsible for keeping stable across ordinary attribute-filter
  // changes and only replacing on a genuine topology change.
  //
  // Deliberately does NOT read `pinnedPositions` here, for two independent
  // reasons: (1) reading a prop/ref inside a `useMemo` callback whose
  // dependency array doesn't include it is exactly what this repo's
  // stricter lint rules (`react-hooks/refs`) exist to catch — a memo must
  // not silently depend on something outside its own deps; and (2) even
  // setting that lint concern aside, adding `pinnedPositions` to this
  // memo's OWN dependency array would rebuild the ENTIRE topology (every
  // node's seeded position, not just the pinned one) on every later
  // pin/unpin, discarding every other node's already-settled position —
  // exactly the "stable topology reference across ordinary changes"
  // invariant this file's own top comment is built around. Pinned
  // positions are instead applied by a dedicated effect below
  // (`applyPinnedPositions`), which mutates the already-built nodes in
  // place instead of rebuilding this array. ---
  const graphData = useMemo(() => {
    const augmentedLinks: AugmentedLink[] = links.map((l) => ({ ...l, isSelfLink: l.source === l.target }));
    const gNodes: GNode[] = nodes.map((n, i) => {
      const initial = seededInitialPosition(i, LAYOUT_SEED, INITIAL_SPACING);
      return { ...n, x: initial.x, y: initial.y, z: 0 } as GNode;
    });
    const gLinks: GLink[] = augmentedLinks.map((l) => ({ ...l }) as GLink);
    return { nodes: gNodes, links: gLinks };
  }, [nodes, links]);

  // Applies `pinnedPositions` to the just-(re)built `graphData.nodes` by
  // direct mutation (same live-simulation-runtime-state fact as
  // `handleEngineStop`'s `fz` assignment below) — runs once per genuine
  // topology rebuild AND again whenever `pinnedPositions` itself changes
  // (a later pin/unpin), without ever touching `graphData`'s own identity.
  // A pinned node's position is therefore deterministic from local storage
  // on a fresh mount (charter §14 "deterministic layout seed" / spec §4.3).
  useEffect(() => {
    if (!pinnedPositions || pinnedPositions.size === 0) return;
    for (const n of graphData.nodes) {
      const pinned = pinnedPositions.get(n.id as string);
      if (!pinned) continue;
      // eslint-disable-next-line react-hooks/immutability
      n.x = pinned.x;
      n.y = pinned.y;
      n.fx = pinned.x;
      n.fy = pinned.y;
    }
  }, [graphData, pinnedPositions]);

  // A plain ref mirror of `graphData`, read (not the `useMemo` binding
  // itself) by `handleEngineStop` below. `d3-force-3d`'s own contract for a
  // "fixed" axis IS in-place mutation of a live simulation node's fx/fy/fz
  // — there is no non-mutating API this vendor library offers for pinning
  // a simulated node's position, and `graphData.nodes` here ARE those same
  // live simulation node objects (already mutated every tick by d3-force
  // itself for velocity/position, independent of anything this component
  // does). That is a different fact from charter §9's "canonical graph
  // data remains immutable," which is about the `DisplayNode`/`DisplayLink`
  // contract objects `adapter.ts` deep-freezes upstream of this file, not
  // about a physics engine's own simulation runtime state. Reading through
  // a ref (rather than closing over the `useMemo` return value directly in
  // a `useCallback` that also lists it as a dependency) keeps the mutation
  // out of the specific "argument passed to a hook, later mutated" shape.
  const graphDataRef = useRef(graphData);
  useEffect(() => {
    graphDataRef.current = graphData;
  }, [graphData]);

  const nodesById = useMemo(() => new Map(graphData.nodes.map((n) => [n.id as string, n])), [graphData]);
  const rootNode = useMemo(() => (rootNodeId ? (nodesById.get(rootNodeId) ?? null) : null), [nodesById, rootNodeId]);

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

  // Full-topology p95 degree (spec §1.4: production has no precomputed
  // static `FixtureNode.degree` — derived once via computeVisibleDegrees
  // with an always-visible predicate, over the full disclosed topology).
  const p95FullDegree = useMemo(() => {
    const allIds = graphData.nodes.map((n) => n.id as string);
    const { p95VisibleDegree } = computeVisibleDegrees(allIds, graphData.links.map((l) => ({ source: l.source as string, target: l.target as string, isSelfLink: l.isSelfLink })), () => true);
    return p95VisibleDegree;
  }, [graphData]);

  // Parallel/self-link curvature (spec §1.4: computed at scene-build time
  // by grouping links on unordered (source, target) pairs — charter
  // "Curves only for self-links and parallel edges").
  const curvatureById = useMemo(() => {
    const map = new Map<string, number>();
    const groups = new Map<string, GLink[]>();
    for (const l of graphData.links) {
      if (l.isSelfLink) {
        map.set(l.id as string, 0.65);
        continue;
      }
      const key = [l.source as string, l.target as string].sort().join("|");
      const group = groups.get(key) ?? [];
      group.push(l);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      group.forEach((l, i) => {
        const magnitude = 0.24 + 0.1 * Math.floor(i / 2);
        map.set(l.id as string, i % 2 === 0 ? magnitude : -magnitude);
      });
    }
    return map;
  }, [graphData]);

  const isNodeVisible = useCallback((node: Pick<GNode, "id">) => !visibleNodeIds || visibleNodeIds.has(node.id as string), [visibleNodeIds]);

  const isLinkVisible = useCallback(
    (link: GLink) => {
      const sourceNode = endpointNode(link.source) ?? nodesById.get(endpointId(link.source));
      const targetNode = endpointNode(link.target) ?? nodesById.get(endpointId(link.target));
      if (!sourceNode || !targetNode) return true;
      return isNodeVisible(sourceNode) && isNodeVisible(targetNode);
    },
    [isNodeVisible, nodesById],
  );

  const applyVisibleScale = useCallback(() => {
    const visibleIds = new Set(graphData.nodes.filter((n) => isNodeVisible(n)).map((n) => n.id as string));
    const { visibleDegreeById, p95VisibleDegree } = computeVisibleDegrees(
      [...visibleIds],
      graphData.links.map((l) => ({ source: l.source as string, target: l.target as string, isSelfLink: l.isSelfLink })),
      (l) => visibleIds.has(l.source) && visibleIds.has(l.target),
    );
    for (const n of graphData.nodes) {
      const id = n.id as string;
      const visual = nodeVisualById.current.get(id);
      if (!visual || !visibleIds.has(id)) continue; // keep last-known scale for hidden nodes
      const scale = computeNodeScale({
        isRoot: id === rootNodeId,
        visibleDegree: visibleDegreeById.get(id) ?? 0,
        p95VisibleDegree,
        isDirectEvidenceNeighborOfRoot: evidenceNeighborsOfRoot.has(id),
        isAggregate: n.displayKind === "aggregate",
      });
      // Object3D is at graphData.nodes[i] — recovered via nodeThreeObject's
      // own cache, mutated in place (never a `nodeThreeObject` rebuild).
      const object = nodeVisualById.current.get(id)?.object;
      object?.scale.setScalar(scale);
    }
  }, [graphData, isNodeVisible, rootNodeId, evidenceNeighborsOfRoot]);

  // Recompute scale whenever the ACTIVE FILTER (visibleNodeIds) changes —
  // never on a pure re-render, and never touching graphData identity.
  useEffect(() => {
    applyVisibleScale();
  }, [applyVisibleScale]);

  // --- Node visuals: built once per node id, cached; never rebuilt on
  // selection/hover/filter (matches protoA's own architecture). ---
  const nodeThreeObject = useCallback((node: GNode): THREE.Object3D => {
    const factory = visualFactoryRef.current;
    if (!factory) return new THREE.Object3D();
    const id = node.id as string;
    let visual = nodeVisualById.current.get(id);
    if (!visual) {
      visual = factory.build({ displayKind: node.displayKind, unavailableReason: node.unavailableReason, sourceEntity: node.sourceEntity });
      nodeVisualById.current.set(id, visual);
      const scale = computeNodeScale({
        isRoot: id === rootNodeId,
        visibleDegree: (neighborsOf.get(id)?.size ?? 0),
        p95VisibleDegree: p95FullDegree,
        isDirectEvidenceNeighborOfRoot: evidenceNeighborsOfRoot.has(id),
        isAggregate: node.displayKind === "aggregate",
      });
      visual.object.scale.setScalar(scale);
      if (readingNodeIds?.has(id)) visual.setReading(true);
      if (id === selectedIdRef.current) visual.setSelected(true, credibilityByNodeId?.get(id) ?? null);
    }
    return visual.object;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Camera controller ---
  const visiblePoints = useCallback((): Vec3[] => {
    const pts: Vec3[] = [];
    for (const n of graphData.nodes) {
      if (!isNodeVisible(n)) continue;
      pts.push([n.x ?? 0, n.y ?? 0, n.z ?? 0]);
    }
    return pts.length > 0 ? pts : [[0, 0, 0]];
  }, [graphData, isNodeVisible]);

  const camera = useKnowledgeMapCamera(fgRef, containerRef, visiblePoints);
  useEffect(() => {
    cameraApiRef.current = camera;
  }, [camera]);

  // --- Register the test bridge exactly once per real mount (`[]` deps —
  // deliberately NOT `[camera]`/`[graphData]`, both of which change far more
  // often than a genuine mount/unmount does; re-running this on every such
  // change would both mint confusing extra registration churn and, worse,
  // reset `.interactive` back to `false` on every later topology/camera
  // change even though the scene never actually remounted). Every accessor
  // below reads through a REF, never a closed-over render value, so the one
  // long-lived hook object this effect creates always reports the CURRENT
  // state for the life of this mount. ---
  useEffect(() => {
    const mountId = testHookMountIdRef.current as number;
    const hook: KnowledgeMapTestHook = {
      mountId,
      interactive: false,
      isNodeVisible: (nodeId: string) => {
        const visible = visibleNodeIdsRef.current;
        return !visible || visible.has(nodeId);
      },
      getVisibleNodeIds: () => {
        const visible = visibleNodeIdsRef.current;
        const all = graphDataRef.current.nodes.map((n) => n.id as string);
        return visible ? all.filter((id) => visible.has(id)) : all;
      },
      getRootNodeId: () => rootNodeIdRef.current,
      getSelectedId: () => selectedIdRef.current,
      isLayoutFrozen: () => layoutPhaseRef.current === "frozen",
      getNodeScreenPosition: (nodeId: string) => {
        const fg = fgRef.current;
        if (!fg) return null;
        const visible = visibleNodeIdsRef.current;
        if (visible && !visible.has(nodeId)) return null;
        const node = graphDataRef.current.nodes.find((n) => (n.id as string) === nodeId);
        if (!node) return null;
        const coords = fg.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
        if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return null;
        return { x: coords.x, y: coords.y };
      },
      getCameraPose: () => {
        const pose = cameraApiRef.current?.getCameraPose();
        return pose ?? { position: [0, 0, 0], target: [0, 0, 0] };
      },
      getNodeWorldPosition: (nodeId: string) => {
        const node = graphDataRef.current.nodes.find((n) => (n.id as string) === nodeId);
        return node ? { x: node.x ?? 0, y: node.y ?? 0, z: node.z ?? 0 } : null;
      },
    };
    testHookRef.current = hook;
    registerKnowledgeMapTestHook(hook);
    return () => {
      testHookRef.current = null;
      unregisterKnowledgeMapTestHook(mountId);
    };
    // Mount/unmount only — see comment above.
  }, []);

  // --- Selection / hover / background handlers (charter §11: single
  // click selects only, never moves the camera; hover never moves the
  // camera; background click clears selection). ---
  const applySelection = useCallback(
    (nodeId: string | null) => {
      const previous = selectedIdRef.current;
      if (previous === nodeId) return;
      if (previous) nodeVisualById.current.get(previous)?.setSelected(false);
      if (nodeId) nodeVisualById.current.get(nodeId)?.setSelected(true, credibilityByNodeId?.get(nodeId) ?? null);
      selectedIdRef.current = nodeId;
      setSelectedId(nodeId);
      onSelect?.(nodeId);
    },
    [onSelect, credibilityByNodeId],
  );

  const applyFocus = useCallback(
    (nodeId: string) => {
      const node = nodesById.get(nodeId);
      if (!node || !isNodeVisible(node)) return;
      const neighborIds = neighborsOf.get(nodeId) ?? new Set<string>();
      const points: Vec3[] = [[node.x ?? 0, node.y ?? 0, node.z ?? 0]];
      for (const nid of neighborIds) {
        const n = nodesById.get(nid);
        if (n && isNodeVisible(n)) points.push([n.x ?? 0, n.y ?? 0, n.z ?? 0]);
      }
      camera.focus([node.x ?? 0, node.y ?? 0, node.z ?? 0], points.slice(1));
      onFocus?.(nodeId);
    },
    [nodesById, neighborsOf, isNodeVisible, camera, onFocus],
  );

  // Single handler for both single- and double-click (charter §11: "Single
  // click/tap selects... no camera move" / "Double-click ... moves the
  // camera"). `react-force-graph-3d` has no dedicated double-click prop —
  // the standard browser signal for "this click is the second click of a
  // double-click" is `MouseEvent.detail >= 2`, which every native `click`
  // listener (including this library's own canvas-level one) receives, so
  // this needs no custom timing/threshold logic of its own.
  const handleNodeClick = useCallback(
    (node: GNode, event: MouseEvent) => {
      if (!isNodeVisible(node)) return;
      applySelection(node.id as string);
      if (event.detail >= 2) applyFocus(node.id as string);
    },
    [applySelection, applyFocus, isNodeVisible],
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
      onHover?.(id);
    },
    [isNodeVisible, onHover],
  );

  const handleBackgroundClick = useCallback(() => {
    applySelection(null);
  }, [applySelection]);

  // --- Arrange mode drag persistence (charter §11 "Arrange mode", spec
  // §4.3). The underlying `3d-force-graph` drag implementation fixes a
  // node's fx/fy only WHILE dragging and — since this node had no fx/fy set
  // before the drag started — releases them again once the drag ends
  // (verified by reading `3d-force-graph`'s own `dragend` handler: it
  // restores whatever `fx`/`fy` state existed at `dragstart`, which for an
  // unpinned node is `undefined`). So dragging alone does NOT pin a node —
  // this handler is what actually turns "drag" into "drag, and it stays
  // there," by re-fixing fx/fy itself immediately after the library's own
  // cleanup runs, then reporting the outcome so the caller can persist it
  // to `arrangeStore.ts` (this component never touches `localStorage`
  // itself — same separation as `onArrangeNodeDragEnd`'s own doc comment). */
  const handleNodeDragEnd = useCallback(
    (node: GNode) => {
      if (!arrangeMode) return;
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      node.fx = x;
      node.fy = y;
      onArrangeNodeDragEnd?.(node.id as string, { x, y });
    },
    [arrangeMode, onArrangeNodeDragEnd],
  );

  // --- Imperative API exposed to callers (toolbar/inspector/etc.) ---
  const api: KnowledgeMapSceneApi = useMemo(
    () => ({
      select: applySelection,
      home: camera.home,
      fit: camera.fit,
      focus: camera.focus,
      applyOrientationPreset: camera.applyOrientationPreset,
      getCameraPose: camera.getCameraPose,
      getNodeScreenPosition: (nodeId: string) => {
        const fg = fgRef.current;
        const node = nodesById.get(nodeId);
        if (!fg || !node || !isNodeVisible(node)) return null;
        const coords = fg.graph2ScreenCoords(node.x ?? 0, node.y ?? 0, node.z ?? 0);
        if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y)) return null;
        return { x: coords.x, y: coords.y };
      },
      focusOnNode: applyFocus,
      getNodePosition: (nodeId: string) => {
        const node = nodesById.get(nodeId);
        return node ? { x: node.x ?? 0, y: node.y ?? 0 } : null;
      },
      pinNode: (nodeId: string, position: { x: number; y: number }) => {
        const node = nodesById.get(nodeId);
        if (!node) return;
        // Live simulation runtime mutation — same fact as `handleEngineStop`'s
        // own `fz` assignment below (physics-engine "fixed axis" state, not
        // the canonical DisplayNode/DisplayLink contract charter §9 guards).
        node.fx = position.x;
        node.fy = position.y;
        node.x = position.x;
        node.y = position.y;
      },
      unpinNode: (nodeId: string) => {
        const node = nodesById.get(nodeId);
        if (!node) return;
        node.fx = undefined;
        node.fy = undefined;
      },
    }),
    [applySelection, camera, nodesById, isNodeVisible, applyFocus],
  );

  useEffect(() => {
    if (apiRef) apiRef.current = api;
  }, [api, apiRef]);

  // --- Mount-time setup: factory/tracker/label-layer/ResizeObserver, and
  // teardown of all of it on unmount (charter §14). ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Captured once at effect-setup time, not re-read inside the cleanup
    // below — `nodeVisualById` itself never changes identity, but its
    // `.current` Map is mutated throughout the component's life
    // (`nodeThreeObject` adds entries), so the cleanup must dispose the
    // exact set of visuals that exist at unmount time, read through this
    // captured reference rather than a fresh `nodeVisualById.current` read
    // inside the closure.
    const visualsById = nodeVisualById.current;

    visualFactoryRef.current = new NodeVisualFactory();
    const tracker = new SceneResourceTracker();
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

    const initialRect = container.getBoundingClientRect();
    setDimensions({ width: initialRect.width, height: initialRect.height });

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;

      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        tracker.untrackTimer(rafIdRef.current);
        rafIdRef.current = null;
      }

      const canvas = rendererDomRef.current;
      rendererDomRef.current = null;

      labelLayerRef.current?.dispose();
      labelLayerRef.current = null;

      for (const visual of visualsById.values()) visual.dispose();
      visualsById.clear();

      visualFactoryRef.current?.dispose();
      visualFactoryRef.current = null;

      tracker.disposeAll();
      trackerRef.current = null;

      fgRef.current = undefined;
      void canvas;
    };
    // Mount/unmount only — this effect must not re-run on every render.
  }, []);

  // --- One-time scene setup, gated on `<ForceGraph3D>` actually having
  // rendered (only true once `dimensions` is nonzero). Z-up camera
  // (charter §8/§11), the low-opacity reference grid, WebGL context-loss
  // wiring, and the "interactive" callback all belong here rather than the
  // mount effect above, since `fgRef.current` is only populated once
  // `<ForceGraph3D>` itself has mounted. ---
  const hasSize = dimensions.width > 0 && dimensions.height > 0;
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !hasSize || upVectorSetRef.current) return;
    upVectorSetRef.current = true;

    const cam = fg.camera() as THREE.PerspectiveCamera;
    cam.up.set(0, 0, 1);
    const controls = fg.controls() as { update?: () => void };
    controls.update?.();

    // Frame immediately from the deterministic seeded initial layout
    // (charter: Home must always be reproducible from data alone) rather
    // than leaving the camera at the library's own generic default pose.
    camera.home(false);

    const scene = fg.scene();
    const grid = new THREE.GridHelper(400, 20, GRID_COLOR, GRID_COLOR);
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const mat of gridMaterials) {
      mat.transparent = true;
      mat.opacity = GRID_OPACITY;
    }
    grid.rotation.x = Math.PI / 2; // lie flat in the X/Y plane (Z-up world)
    scene.add(grid);

    // Layer-reference planes (charter §8, `showLayerGuide` prop) — built
    // eagerly (like the grid above) so toggling the prop later is a plain
    // visibility flip, not a rebuild; positioned at z=0 for now since the
    // real BAND_GAP isn't known until the first free-settle pass converges
    // (handleEngineStop repositions them once it does — see that handler).
    // `THREE.PlaneGeometry` already lies flat in the X/Y plane by default
    // (its face normal is +Z), so — unlike the grid above — no rotation is
    // needed for a Z-up world.
    const layerGuideGroup = new THREE.Group();
    layerGuideGroup.visible = Boolean(showLayerGuide);
    const layerPlaneMaterial = new THREE.MeshBasicMaterial({
      color: LAYER_GUIDE_PLANE_COLOR,
      transparent: true,
      opacity: LAYER_GUIDE_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const layerPlaneGeometry = new THREE.PlaneGeometry(400, 400);
    const layerPlaneByLayer = new Map<Layer, THREE.Mesh>();
    for (const layer of LAYER_GUIDE_ORDER) {
      const plane = new THREE.Mesh(layerPlaneGeometry, layerPlaneMaterial);
      layerGuideGroup.add(plane);
      layerPlaneByLayer.set(layer, plane);
    }
    scene.add(layerGuideGroup);
    layerPlanesGroupRef.current = layerGuideGroup;
    layerPlaneByLayerRef.current = layerPlaneByLayer;

    const renderer = fg.renderer();
    const canvas = renderer.domElement;
    rendererDomRef.current = canvas;

    const onContextLostHandler = (event: Event) => {
      event.preventDefault();
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        trackerRef.current?.untrackTimer(rafIdRef.current);
        rafIdRef.current = null;
      }
      onContextLost?.();
    };
    const onContextRestoredHandler = () => {
      onContextRestored?.();
    };
    trackerRef.current?.addListener(canvas, "webglcontextlost", onContextLostHandler);
    trackerRef.current?.addListener(canvas, "webglcontextrestored", onContextRestoredHandler);

    onInteractive?.();
    // Charter §16 "data loading to scene ready": flips the test bridge's
    // `interactive` flag the same instant the caller's own `onInteractive`
    // fires — this effect only runs once the scene has nonzero dimensions
    // and `<ForceGraph3D>` has actually mounted (`hasSize` gate above), so
    // "interactive" here means the same thing it means everywhere else in
    // this file, not a separately-invented definition.
    if (testHookRef.current) testHookRef.current.interactive = true;

    return () => {
      scene.remove(grid);
      grid.geometry.dispose();
      for (const mat of gridMaterials) mat.dispose();

      scene.remove(layerGuideGroup);
      layerPlaneGeometry.dispose();
      layerPlaneMaterial.dispose();
      layerPlanesGroupRef.current = null;
      layerPlaneByLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSize]);

  // --- Resize self-heal (Stage 3 verification round 1 §7/§8: "resizing to
  // a narrow viewport blanks the 3D scene entirely and it does NOT
  // self-heal on further resizes"). The one-time scene setup effect above
  // only computes Home once, at the FIRST `hasSize` transition — a later
  // resize keeps `<ForceGraph3D>`'s own renderer width/height correct (fed
  // straight from `dimensions` below) but never re-runs any camera math, so
  // an aspect-ratio change extreme enough to push every currently-visible
  // node outside the frustum leaves the camera frozen there indefinitely,
  // confirmed NOT to recover on further resizes (including one that returns
  // to the exact original size) — only an actual remount does.
  //
  // This effect detects exactly that degenerate case — at least one node is
  // currently visible, but NONE of them still project inside the canvas —
  // and recovers with `camera.fit()`, which reframes from the CURRENT
  // camera direction (see `resolveFitPose`) rather than resetting to the
  // canonical Home pose, so it does not discard a user's own orbit/zoom on
  // an ORDINARY resize that still frames the scene fine. A resize that
  // still has any visible node on-screen is left completely alone.
  const previousDimensionsRef = useRef<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const previous = previousDimensionsRef.current;
    previousDimensionsRef.current = hasSize ? { width: dimensions.width, height: dimensions.height } : null;
    // The first hasSize transition is already framed by the mount-time
    // effect above (`camera.home(false)`) — only later resizes reach here.
    if (!hasSize || !previous) return;
    const fg = fgRef.current;
    if (!fg) return;

    const visibleNodes = graphData.nodes.filter((n) => isNodeVisible(n));
    if (visibleNodes.length === 0) return; // nothing to frame — a deliberate empty filter, not the bug

    const anyInFrustum = visibleNodes.some((n) => {
      const coords = fg.graph2ScreenCoords(n.x ?? 0, n.y ?? 0, n.z ?? 0);
      return (
        Number.isFinite(coords.x) &&
        Number.isFinite(coords.y) &&
        coords.x >= 0 &&
        coords.x <= dimensions.width &&
        coords.y >= 0 &&
        coords.y <= dimensions.height
      );
    });
    if (!anyInFrustum) camera.fit();
  }, [dimensions.width, dimensions.height, hasSize, graphData, isNodeVisible, camera]);

  // Reactive visibility toggle — flipping `showLayerGuide` never rebuilds
  // the planes (built once above), only shows/hides the already-resident
  // group, matching the grid's own "cheap to keep resident" cost profile.
  useEffect(() => {
    if (layerPlanesGroupRef.current) layerPlanesGroupRef.current.visible = Boolean(showLayerGuide);
  }, [showLayerGuide]);

  // --- Per-frame loop: label positions only. Never touches React state
  // (charter §14 frame-loop rule) — `pendingConfirm`/scale updates happen
  // in event handlers/effects above, not here. ---
  useEffect(() => {
    const tick = () => {
      if (rafIdRef.current !== null) trackerRef.current?.untrackTimer(rafIdRef.current);

      const fg = fgRef.current;
      if (fg && labelLayerRef.current && containerRef.current) {
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
            degree: neighborsOf.get(id)?.size ?? 0,
            tier: id === selected || id === hovered || id === rootNodeId ? "primary" : always ? "priority" : "secondary",
          });
        }
        labelLayerRef.current.update(candidates, maxPriority, rect.width, rect.height);
      }
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
  }, [graphData, neighborsOf, rootNode, rootNodeId, isNodeVisible]);

  // --- Band-Z two-pass pinning (charter §8/§14): let the simulation free-
  // settle once (real median XY link distance emerges), pin every node's
  // `fz` from computeBandGap/computeFixedZ, reheat exactly once, then
  // freeze (charter §14 "Freeze the force simulation after convergence").
  const handleEngineStop = useCallback(() => {
    const currentGraphData = graphDataRef.current;
    if (layoutPhaseRef.current === "settling") {
      const positionById = new Map(currentGraphData.nodes.map((n) => [n.id as string, { x: n.x ?? 0, y: n.y ?? 0 }]));
      const linksForMedian = currentGraphData.links.map((l) => ({ source: l.source as string, target: l.target as string, isSelfLink: l.isSelfLink }));
      const median = medianXYLinkDistance(linksForMedian, positionById);
      const bandGap = computeBandGap(median || 40);
      bandGapRef.current = bandGap;
      // d3-force-3d's own contract for a "fixed" axis IS in-place mutation
      // of a live simulation node's fx/fy/fz — there is no non-mutating
      // API this vendor library offers for pinning a simulated node's
      // position, and `currentGraphData.nodes` here ARE those same live
      // simulation node objects (already mutated every tick by d3-force
      // itself for velocity/position, independent of anything this
      // component does). That is a different fact from charter §9's
      // "canonical graph data remains immutable," which is about the
      // `DisplayNode`/`DisplayLink` contract objects `adapter.ts` deep-
      // freezes upstream of this file, not a physics engine's own runtime
      // simulation state.
      for (const n of currentGraphData.nodes) {
        // eslint-disable-next-line react-hooks/immutability
        n.fz = computeFixedZ({ id: n.id as string, layer: n.layer }, bandGap);
      }
      // Layer-reference planes (charter §8) reposition to the same real
      // BAND_GAP the nodes themselves were just pinned to, so the "planes
      // make the band structure legible" guarantee reflects the actual
      // layout, not a placeholder z=0 guess.
      if (layerPlaneByLayerRef.current) {
        for (const [layer, plane] of layerPlaneByLayerRef.current) {
          // Same physics/scene-runtime-mutation fact as `n.fz` above — a
          // THREE.Object3D transform, not the canonical DisplayNode/
          // DisplayLink contract.
          // eslint-disable-next-line react-hooks/immutability
          plane.position.z = zForLayer(layer, bandGap);
        }
      }
      layoutPhaseRef.current = "banded";
      fgRef.current?.d3ReheatSimulation();
    } else if (layoutPhaseRef.current === "banded") {
      layoutPhaseRef.current = "frozen";
      camera.home(false);
    }
    // "frozen" phase: no further reheats — charter "Reheat only for a
    // genuine topology or layout change," which this handler already only
    // does once (the settling->banded transition).
  }, [camera]);

  const linkColorAccessor = useCallback(
    (link: GLink) => {
      const family = EDGE_VISUALS[link.displayFamily];
      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      let alpha = DEFAULT_LINK_OPACITY;
      if (selectedId) {
        alpha = sourceId === selectedId || targetId === selectedId ? SELECTED_NEIGHBORHOOD_LINK_OPACITY : UNRELATED_WHILE_SELECTED_LINK_OPACITY;
      }
      // Charter §10 ai_inferred provenance overlay: "reduce default
      // opacity to 70% of that family" — never a distinct color.
      if (link.aiInferred) alpha *= 0.7;
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

  const linkCurvatureAccessor = useCallback((link: GLink) => curvatureById.get(link.id as string) ?? 0, [curvatureById]);
  const nodeVisibilityAccessor = useCallback((node: GNode) => isNodeVisible(node), [isNodeVisible]);
  const linkVisibilityAccessor = useCallback((link: GLink) => isLinkVisible(link), [isLinkVisible]);

  const handleEngineTick = useCallback(() => {
    // Intentionally empty (matches protoA): presence of onEngineTick lets a
    // later step hook per-tick diagnostics without adding a second
    // render-loop consumer. No React state is touched here (charter §14).
  }, []);

  void hoveredId; // read via ref inside the rAF loop; state exists to trigger label/style re-renders where needed by consumers of this component

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }} data-testid="knowledge-map-scene">
      {showLayerGuide && (
        <ul
          aria-hidden="true"
          data-testid="knowledge-map-layer-guide-legend"
          className="pointer-events-none absolute bottom-2 left-2 z-10 flex flex-col gap-0.5 rounded bg-[var(--color-background)]/70 px-2 py-1.5 text-[10px] text-[var(--color-text-muted)]"
        >
          {LAYER_GUIDE_ORDER.map((layer) => (
            <li key={layer}>{LAYER_LABEL[layer]}</li>
          ))}
        </ul>
      )}
      {dimensions.width > 0 && dimensions.height > 0 && (
        <ForceGraph3D<KnowledgeMapDisplayNode, AugmentedLink>
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
          onNodeDragEnd={handleNodeDragEnd}
          onBackgroundClick={handleBackgroundClick}
          onEngineStop={handleEngineStop}
          onEngineTick={handleEngineTick}
          enableNodeDrag={Boolean(arrangeMode)}
        />
      )}
    </div>
  );
}

// distanceToTarget is re-exported here purely so callers of this file that
// need zoom-dependent sizing (a future label/LOD step) import it from the
// same module as the scene rather than reaching into @ice/graph-display
// directly for one function — matches charter §11's "distance to the
// active target/node, not camera.position.length()" requirement being
// visibly reachable from the scene's own module surface.
export { distanceToTarget };
