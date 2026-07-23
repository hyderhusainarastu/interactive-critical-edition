"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import {
  EDGE_FAMILY_META,
  STATE_META,
  TYPE_META,
  edgeFamilyFor,
  type EdgeFamily,
  type GraphData,
  type GraphLink,
  type GraphNode,
  type NodeState,
  type NodeType,
} from "./types";
import {
  REFERENCE_CAMERA_DISTANCE,
  edgeDirectionCue,
  edgeLabelVisible,
  edgeRelationLabel,
  nodeScaleForDistance,
} from "./graphSceneScaling";

// Relative node size by kind — work is the anchor, concepts next, then
// references, with sections (a per-work outline, often numerous) smallest.
// This is the BASE radius baked into the sphere geometry at creation time
// only — never the final on-screen size. Distance/selection/pin accents are
// applied afterward via `mesh.scale` mutation (see D-21-5 below), so this
// table never needs to change for a node to visually grow or shrink.
const NODE_SIZE: Record<NodeType, number> = {
  work: 6,
  reference: 3,
  peer_reviewed_source: 4.5,
  online_source: 3.5,
  concept: 4,
  person: 4,
  section: 2,
};

// Label canvas geometry — two SEPARATE sprites (title, type/state) rather
// than one combined canvas, specifically so the secondary line can be
// hidden independently of the primary one (plan §21.4's "hide secondary
// before shrinking primary") without redrawing/regenerating a texture.
const PRIMARY_LABEL_CANVAS_HEIGHT = 72;
const SECONDARY_LABEL_CANVAS_HEIGHT = 56;
const EDGE_LABEL_CANVAS_HEIGHT = 46;
const PRIMARY_LABEL_ASPECT = PRIMARY_LABEL_CANVAS_HEIGHT / 512;
const SECONDARY_LABEL_ASPECT = SECONDARY_LABEL_CANVAS_HEIGHT / 512;
const EDGE_LABEL_ASPECT = EDGE_LABEL_CANVAS_HEIGHT / 512;

// Selection/pin visual accents — additive bumps on top of the
// distance-driven scale factor, applied via mutation (see `applyNodeAccents`
// below), never by changing `nodeThreeObject`'s own dependency surface.
const PIN_SCALE_BUMP = 0.3;
const SELECTED_SCALE_BUMP = 0.15;

// A stable base link width. The previous binary (1.6 connected / 0.5 idle)
// depended on `hoverNode` INSIDE the `linkWidth` accessor — but `linkWidth`
// is one of the three props (`linkThreeObject`/`linkThreeObjectExtend`/
// `linkWidth`) whose identity changing forces the library to fully rebuild
// every link's line object, exactly the D-21-5 class of defect, just for
// edges instead of nodes. Keeping `linkWidth` constant and applying the
// same "connected" emphasis via a scale mutation (`LINK_HOVER_WIDTH_FACTOR`)
// avoids reintroducing that on every hover — doubly important now that a
// custom `linkThreeObject` (the new edge label, D-21-4) also depends on
// that same rebuild trigger.
const BASE_LINK_WIDTH = 0.5;
const LINK_HOVER_WIDTH_FACTOR = 3.2; // 1.6 / 0.5 — preserves the prior visual ratio.

/** react-force-graph-3d mutates link.source/target from a string id into the
 *  actual node object once the simulation runs — normalize both shapes to a
 *  plain id, matching the same pattern `filterGraphData`/the accessible
 *  table already use for this exact reason. */
function endpointId(end: GraphLink["source"] | GraphLink["target"]): string {
  return typeof end === "string" ? end : (end as { id: string }).id;
}

function makeLabelSprite(text: string, font: string, color: string, canvasHeight: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(20, 18, 15, 0.78)";
    context.roundRect(8, 6, canvas.width - 16, canvas.height - 12, 14);
    context.fill();
    context.fillStyle = color;
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 28);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
}

/** `userData` shape stashed on each node's top-level `THREE.Group` by
 *  `nodeThreeObject` — read back by `applyNodeAccents` via `scene().traverse()`
 *  (see that function's own doc comment for why traversal, not `graphData()`,
 *  is the read-back mechanism here). */
type NodeGroupUserData = Partial<{
  nodeId: string;
  baseRadius: number;
  baseLabelScale: number;
  sphere: THREE.Mesh;
  primarySprite: THREE.Sprite;
  secondarySprite: THREE.Sprite;
}>;

/** `userData` shape stashed on each edge-label `THREE.Sprite` by
 *  `linkThreeObject` — same traversal-based read-back as node accents.
 *  `sourceId`/`targetId` are captured at creation time (when the link
 *  object's own `.source`/`.target` are still available) so the hover-
 *  connected check never needs `graphData()` either. */
type LinkSpriteUserData = Partial<{
  linkId: string;
  baseScale: { x: number; y: number };
  sourceId: string;
  targetId: string;
}>;

/**
 * The 3D force-directed knowledge graph (plan §16/§19). Built with
 * react-force-graph-3d, deliberately restrained per the design rules: no
 * forced auto-rotation, damped default controls, node/link colors drawn
 * from the same warm palette tokens as the rest of the app (resolved to
 * concrete values from CSS custom properties so WebGL can use them, and
 * re-resolved when the theme changes). This is an enhancement over the
 * accessible table, never the only way to read the data.
 *
 * **Phase 21.4/21.5 caching architecture (D-21-5):** `nodeThreeObject` and
 * `linkThreeObject` are memoized with STABLE dependencies only
 * (`typeColors`; nothing for links) — never `selectedNodeId`,
 * `pinnedWorkIds`, `hoverNode`, or the throttled camera-distance sample.
 * react-force-graph-3d treats a changed accessor identity for either of
 * these (plus, for links, `linkWidth`) as "rebuild every node/link's 3D
 * object from scratch," so selection/pin/hover/zoom visual accents are
 * instead applied by MUTATING the already-created objects' `.scale`/
 * `.visible` in a `userData`-tagged post-creation pass
 * (`applyNodeAccents`/`applyLinkAccents`) — the dossier's own warning that
 * distance-based scaling would "compound catastrophically" on top of the
 * pre-existing per-click full-scene rebuild, addressed by removing the
 * rebuild trigger first rather than layering more state onto it.
 */
export function KnowledgeGraph3D({
  data,
  onNodeClick,
  onLinkClick,
  pinnedWorkIds = [],
  selectedNodeId,
  resetSignal = 0,
  isFullscreen = false,
}: {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  onLinkClick?: (link: GraphLink) => void;
  pinnedWorkIds?: readonly string[];
  selectedNodeId?: string | null;
  /** Incremented by the stage control; keeps reset independent from selection. */
  resetSignal?: number;
  isFullscreen?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Typed loosely: the library's own generic ref shape (wrapping NodeType in
  // NodeObject<...>/LinkObject<...>) doesn't line up cleanly with our plain
  // GraphNode/GraphLink types when passed through JSX inference — cast at
  // the two call sites below instead of fighting the generics here.
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [colors, setColors] = useState<Record<NodeState, string>>();
  const [typeColors, setTypeColors] = useState<Record<NodeType, string>>();
  const [linkColors, setLinkColors] = useState<Record<EdgeFamily, string>>();
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [motionAllowed, setMotionAllowed] = useState(true);
  // D-21-3: camera-to-origin distance, sampled on a THROTTLED interval
  // (never a per-frame/unthrottled setState) and quantized so a setState
  // only fires when the distance actually moves enough to matter.
  const [cameraDistance, setCameraDistance] = useState(REFERENCE_CAMERA_DISTANCE);
  const cameraDistanceRef = useRef(REFERENCE_CAMERA_DISTANCE);

  // Measure the container so the canvas fills it (react-force-graph-3d
  // otherwise defaults to the full window and overflows the layout).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Resolve palette CSS vars to concrete color strings for WebGL, and
  // re-resolve when the theme toggle flips data-theme.
  useEffect(() => {
    const resolve = () => {
      const cs = getComputedStyle(document.documentElement);
      const next = {} as Record<NodeState, string>;
      for (const state of Object.keys(STATE_META) as NodeState[]) {
        next[state] = cs.getPropertyValue(STATE_META[state].colorVar).trim() || "#888";
      }
      const nextTypes = {} as Record<NodeType, string>;
      for (const type of Object.keys(TYPE_META) as NodeType[]) {
        nextTypes[type] = cs.getPropertyValue(TYPE_META[type].colorVar).trim() || "#888";
      }
      const nextLinks = {} as Record<EdgeFamily, string>;
      for (const family of Object.keys(EDGE_FAMILY_META) as EdgeFamily[]) {
        nextLinks[family] = cs.getPropertyValue(EDGE_FAMILY_META[family].colorVar).trim() || "#888";
      }
      setColors(next);
      setTypeColors(nextTypes);
      setLinkColors(nextLinks);
    };
    resolve();
    const obs = new MutationObserver(resolve);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Decorative motion is an enhancement only: stop particles/camera animation
  // for reduced-motion users, hidden browser tabs, and graphs large enough to
  // make animation compete with reading the relationship data.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionAllowed(!media.matches && document.visibilityState === "visible");
    update();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  // D-21-3: throttled camera-distance sampling. Direct-manipulation zoom
  // feedback (not ambient/decorative animation), so this runs regardless of
  // `motionAllowed` — same distinction this file already draws for
  // billboarding always facing the camera.
  useEffect(() => {
    const sample = () => {
      const graph = fgRef.current;
      if (!graph) return;
      const camera = graph.camera();
      if (!camera) return;
      const distance = camera.position.length();
      // Only setState when the change is large enough to actually move a
      // clamped scale factor — keeps this genuinely throttled rather than
      // firing a React update every 180ms regardless of whether anything
      // would visually change.
      if (Math.abs(distance - cameraDistanceRef.current) > 3) {
        cameraDistanceRef.current = distance;
        setCameraDistance(distance);
      }
    };
    sample();
    const id = setInterval(sample, 180);
    return () => clearInterval(id);
  }, []);

  const nodeSceneScale = useMemo(() => nodeScaleForDistance(cameraDistance), [cameraDistance]);

  // Clone so the library can annotate nodes with x/y/z without mutating props.
  const graphData = useMemo(() => {
    const pinned = data.nodes.filter((node) => pinnedWorkIds.includes(node.id));
    const pinIndex = new Map(pinned.map((node, index) => [node.id, index]));
    return {
      nodes: data.nodes.map((node) => {
        const index = pinIndex.get(node.id);
        // Fixed anchors make a selected uploaded work stay in place as filters
        // change, while the remaining sources form a force-directed web around
        // it. A small ring keeps multi-selection legible rather than stacking.
        if (index == null) return { ...node };
        const angle = (index / Math.max(pinned.length, 1)) * Math.PI * 2;
        return { ...node, fx: Math.cos(angle) * 55, fy: Math.sin(angle) * 55, fz: 0 };
      }),
      links: data.links.map((link) => ({ ...link })),
    };
  }, [data, pinnedWorkIds]);

  // Neighbor adjacency for the hover highlight, built once per data change
  // rather than per hover event.
  const neighborsByNode = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of data.links) {
      const s = endpointId(l.source);
      const t = endpointId(l.target);
      (map.get(s) ?? map.set(s, new Set()).get(s)!).add(t);
      (map.get(t) ?? map.set(t, new Set()).get(t)!).add(s);
    }
    return map;
  }, [data.links]);

  const highlightNodeIds = useMemo(() => {
    if (!hoverNode) return null;
    return new Set([hoverNode.id, ...(neighborsByNode.get(hoverNode.id) ?? [])]);
  }, [hoverNode, neighborsByNode]);
  const effectsEnabled = motionAllowed && data.nodes.length <= 140;

  // D-21-5: depends ONLY on `typeColors` — never `selectedNodeId`/
  // `pinnedWorkIds`, which used to force a full rebuild of every node's
  // sphere + label sprites on every single click anywhere in the graph.
  // Selection/pin accents are applied afterward by `applyNodeAccents`
  // mutating the objects tagged here via `userData`.
  const nodeThreeObject = useCallback((value: object) => {
    const node = value as GraphNode;
    const baseRadius = NODE_SIZE[node.type];
    const color = typeColors?.[node.type] ?? "#888";
    const group = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(baseRadius, 18, 14),
      new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.92 }),
    );
    group.add(sphere);

    // Two SEPARATE canvas sprites (title, type/state) rather than one
    // combined texture, so the secondary line can be hidden on zoom-out
    // (D-21-3) without redrawing anything. Both always face the camera by
    // construction (THREE.Sprite billboarding) — unchanged from before.
    const title = node.label.length > 42 ? `${node.label.slice(0, 39)}…` : node.label;
    const primarySprite = makeLabelSprite(title, "600 30px system-ui, sans-serif", "#ffffff", PRIMARY_LABEL_CANVAS_HEIGHT);
    const secondaryText = `${node.type.replace(/_/g, " ")} · ${STATE_META[node.state].label}`;
    const secondarySprite = makeLabelSprite(secondaryText, "22px system-ui, sans-serif", "rgba(255,255,255,0.78)", SECONDARY_LABEL_CANVAS_HEIGHT);

    const baseLabelScale = Math.max(20, Math.min(42, 16 + node.label.length * 0.45));
    primarySprite.scale.set(baseLabelScale, baseLabelScale * PRIMARY_LABEL_ASPECT, 1);
    secondarySprite.scale.set(baseLabelScale, baseLabelScale * SECONDARY_LABEL_ASPECT, 1);
    const primaryOffset = baseRadius + baseLabelScale * PRIMARY_LABEL_ASPECT * 0.65;
    primarySprite.position.set(0, primaryOffset, 0);
    secondarySprite.position.set(0, primaryOffset + baseLabelScale * (PRIMARY_LABEL_ASPECT + SECONDARY_LABEL_ASPECT) * 0.6, 0);
    primarySprite.renderOrder = 1;
    secondarySprite.renderOrder = 1;
    group.add(primarySprite, secondarySprite);

    const nodeUserData: NodeGroupUserData = { nodeId: node.id, baseRadius, baseLabelScale, sphere, primarySprite, secondarySprite };
    group.userData = nodeUserData;
    return group;
  }, [typeColors]);

  // D-21-4: the edge-relation label sprite. Depends on NOTHING that changes
  // over time (no hover/selection/distance) — its text is fixed per edge,
  // and it starts invisible, revealed by `applyLinkAccents` below. Combined
  // with `linkThreeObjectExtend` (constant `true`, see the JSX), the
  // library keeps managing the default line/cylinder object exactly as
  // before; this sprite is purely an additional child.
  const linkThreeObject = useCallback((value: object) => {
    const link = value as GraphLink;
    const text = edgeRelationLabel(link.edgeType, link.category);
    const clipped = text.length > 30 ? `${text.slice(0, 27)}…` : text;
    const sprite = makeLabelSprite(clipped, "600 22px system-ui, sans-serif", "#ffffff", EDGE_LABEL_CANVAS_HEIGHT);
    const baseScale = { x: 16, y: 16 * EDGE_LABEL_ASPECT };
    sprite.scale.set(baseScale.x, baseScale.y, 1);
    sprite.visible = false;
    sprite.renderOrder = 2;
    const linkUserData: LinkSpriteUserData = { linkId: link.id, baseScale, sourceId: endpointId(link.source), targetId: endpointId(link.target) };
    sprite.userData = linkUserData;
    return sprite;
  }, []);

  // The library calls this every tick with the two endpoints' current
  // positions and passes OUR sprite directly (since `linkThreeObjectExtend`
  // is set) — cheap per-tick position sync, no object creation involved.
  const linkPositionUpdate = useCallback(
    (obj: THREE.Object3D, coords: { start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }) => {
      obj.position.set((coords.start.x + coords.end.x) / 2, (coords.start.y + coords.end.y) / 2, (coords.start.z + coords.end.z) / 2);
      return true;
    },
    [],
  );

  // A stable base width — see the module-level comment on
  // `LINK_HOVER_WIDTH_FACTOR` for why this can no longer read `hoverNode`.
  const linkWidth = useCallback(() => BASE_LINK_WIDTH, []);

  const linkDirectionalParticles = useCallback((l: object) => {
    const link = l as GraphLink;
    return edgeDirectionCue(link.edgeType, effectsEnabled) === "particles" ? 2 : 0;
  }, [effectsEnabled]);

  // Direction-cue gap: a static arrowhead is the fallback the instant
  // particles are disabled (reduced motion / hidden tab / >140 nodes), and
  // genuinely symmetric relation types get neither cue (see
  // `edgeDirectionCue`'s own doc comment).
  const linkDirectionalArrowLength = useCallback((l: object) => {
    const link = l as GraphLink;
    return edgeDirectionCue(link.edgeType, effectsEnabled) === "arrow" ? 3.4 : 0;
  }, [effectsEnabled]);

  // D-21-5's node-side fix applied post-creation via mutation, not by
  // widening `nodeThreeObject`'s dependency array. Reads back via
  // `scene().traverse()` rather than `graphData()` — react-force-graph-3d's
  // exposed `ForceGraphMethods` ref does NOT forward a `graphData()`
  // getter (only the underlying, unexposed Kapsule instance has one); an
  // earlier version of this fix called it anyway and threw
  // `TypeError: graph.graphData is not a function` inside a passive
  // effect, which the app's error boundary caught, replacing the ENTIRE
  // graph page (including the accessible table) with "This workspace view
  // could not load" — found via a real filter-triggered E2E regression,
  // not by inspection. `scene()` IS part of `ForceGraphMethods`, so
  // traversal reads back exactly the same `userData` stash with no cast
  // onto unexposed methods.
  const applyNodeAccents = useCallback(() => {
    const graph = fgRef.current;
    if (!graph) return;
    graph.scene().traverse((object) => {
      const stash = object.userData as NodeGroupUserData;
      if (!stash.nodeId || !stash.sphere || !stash.primarySprite || !stash.secondarySprite || stash.baseRadius == null || stash.baseLabelScale == null) return;
      const isSelected = selectedNodeId === stash.nodeId;
      const isPinned = pinnedWorkIds.includes(stash.nodeId);
      const nodeFactor = nodeSceneScale.nodeScaleFactor + (isPinned ? PIN_SCALE_BUMP : 0) + (isSelected ? SELECTED_SCALE_BUMP : 0);
      stash.sphere.scale.setScalar(nodeFactor);
      const labelFactor = nodeSceneScale.labelScaleFactor;
      stash.primarySprite.scale.set(stash.baseLabelScale * labelFactor, stash.baseLabelScale * labelFactor * PRIMARY_LABEL_ASPECT, 1);
      stash.secondarySprite.visible = nodeSceneScale.secondaryLabelVisible;
      stash.secondarySprite.scale.set(stash.baseLabelScale * labelFactor, stash.baseLabelScale * labelFactor * SECONDARY_LABEL_ASPECT, 1);
      const radiusWorld = stash.baseRadius * nodeFactor;
      const primaryOffset = radiusWorld + stash.baseLabelScale * labelFactor * PRIMARY_LABEL_ASPECT * 0.65;
      stash.primarySprite.position.set(0, primaryOffset, 0);
      stash.secondarySprite.position.set(0, primaryOffset + stash.baseLabelScale * labelFactor * (PRIMARY_LABEL_ASPECT + SECONDARY_LABEL_ASPECT) * 0.6, 0);
    });
  }, [selectedNodeId, pinnedWorkIds, nodeSceneScale]);

  // D-21-4/D-21-5 (edge side): hover-connected width emphasis and edge-label
  // reveal/scale, both applied by mutating the already-created line mesh +
  // label sprite rather than through any accessor's dependency surface.
  // Same `scene().traverse()` read-back as `applyNodeAccents` above, for
  // the same reason (no exposed `graphData()`); `sourceId`/`targetId` were
  // captured into the sprite's own `userData` at creation time so the
  // hover-connected check needs no link-array lookup at all.
  const applyLinkAccents = useCallback(() => {
    const graph = fgRef.current;
    if (!graph) return;
    graph.scene().traverse((object) => {
      const stash = object.userData as LinkSpriteUserData;
      if (!stash.linkId || !stash.baseScale) return;
      const sprite = object as THREE.Sprite;
      const lineMesh = sprite.parent?.children?.[0] as THREE.Mesh | undefined;
      const connected = hoverNode ? stash.sourceId === hoverNode.id || stash.targetId === hoverNode.id : false;
      const widthFactor = (connected ? LINK_HOVER_WIDTH_FACTOR : 1) * nodeSceneScale.nodeScaleFactor;
      if (lineMesh?.scale) lineMesh.scale.set(widthFactor, widthFactor, lineMesh.scale.z);
      const visible = edgeLabelVisible(cameraDistance, connected);
      sprite.visible = visible;
      if (visible) {
        const factor = nodeSceneScale.labelScaleFactor;
        sprite.scale.set(stash.baseScale.x * factor, stash.baseScale.y * factor, 1);
      }
    });
  }, [hoverNode, nodeSceneScale, cameraDistance]);

  // Both accent passes run once immediately (in case objects already exist)
  // and once more next frame (to catch objects the library hasn't finished
  // creating yet after a `graphData`/filter change) — never on a per-frame
  // loop of their own.
  useEffect(() => {
    applyNodeAccents();
    const raf = requestAnimationFrame(applyNodeAccents);
    return () => cancelAnimationFrame(raf);
  }, [applyNodeAccents, graphData]);

  useEffect(() => {
    applyLinkAccents();
    const raf = requestAnimationFrame(applyLinkAccents);
    return () => cancelAnimationFrame(raf);
  }, [applyLinkAccents, graphData]);

  useEffect(() => {
    if (!resetSignal) return;
    (fgRef.current as ForceGraphMethods | undefined)?.cameraPosition({ x: 0, y: 0, z: 260 }, { x: 0, y: 0, z: 0 }, effectsEnabled ? 450 : 0);
  }, [effectsEnabled, resetSignal]);

  return (
    <div ref={containerRef} className={`${isFullscreen ? "h-full min-h-0" : "h-[520px]"} w-full overflow-hidden rounded-lg border border-[var(--color-border)]`} data-graph-canvas data-graph-effects={effectsEnabled ? "active" : "paused"}>
      {colors && typeColors && linkColors && (
        <ForceGraph3D
          ref={fgRef as never}
          graphData={graphData}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          nodeThreeObject={nodeThreeObject as never}
          nodeColor={(n: object) => {
            const node = n as GraphNode;
            const base = typeColors[node.type];
            // nodeOpacity is a fixed number, not a per-node accessor, so the
            // hover dim/highlight effect is folded into the color itself —
            // dim non-neighbors toward the background instead.
            if (highlightNodeIds && !highlightNodeIds.has(node.id)) return "rgba(140,130,115,0.25)";
            return base;
          }}
          nodeLabel={(n: object) => {
            const node = n as GraphNode;
            return `${node.label} — ${node.type.replace(/_/g, " ")} · ${STATE_META[node.state].label}`;
          }}
          nodeVal={(n: object) => {
            const node = n as GraphNode;
            return NODE_SIZE[node.type] + (pinnedWorkIds.includes(node.id) ? 2 : 0) + (selectedNodeId === node.id ? 1 : 0);
          }}
          nodeOpacity={0.9}
          linkColor={(l: object) => {
            const link = l as GraphLink;
            const family = edgeFamilyFor(link.edgeType, link.category);
            if (!hoverNode) return linkColors[family];
            const connected = endpointId(link.source) === hoverNode.id || endpointId(link.target) === hoverNode.id;
            return connected ? linkColors[family] : "rgba(120,110,90,0.08)";
          }}
          linkWidth={linkWidth}
          linkThreeObject={linkThreeObject as never}
          linkThreeObjectExtend={true}
          linkPositionUpdate={linkPositionUpdate as never}
          linkDirectionalParticles={linkDirectionalParticles}
          linkDirectionalParticleWidth={1.2}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={(l: object) => {
            const link = l as GraphLink;
            return linkColors[edgeFamilyFor(link.edgeType, link.category)];
          }}
          linkDirectionalArrowLength={linkDirectionalArrowLength}
          linkDirectionalArrowRelPos={1}
          enableNodeDrag={false}
          cooldownTicks={data.nodes.length > 140 ? 35 : 80}
          showNavInfo={false}
          showPointerCursor={() => true}
          onNodeHover={(n: object | null) => setHoverNode(n as GraphNode | null)}
          onNodeClick={(n: object) => {
            const node = n as GraphNode & { x?: number; y?: number; z?: number };
            // Fly the camera toward the clicked node rather than snapping to
            // it, still restrained (a single damped transition, no forced
            // auto-rotation, no repeated motion — plan §19/§35.2).
            const distance = 120;
            const nx = node.x ?? 0;
            const ny = node.y ?? 0;
            const nz = node.z ?? 0;
            const ratio = nz === 0 && nx === 0 && ny === 0 ? 1 : 1 + distance / Math.hypot(nx, ny, nz || 1);
            (fgRef.current as ForceGraphMethods | undefined)?.cameraPosition(
              { x: nx * ratio, y: ny * ratio, z: nz * ratio },
              { x: nx, y: ny, z: nz },
              effectsEnabled ? 700 : 0,
            );
            onNodeClick(node);
          }}
          onLinkClick={(link: object) => onLinkClick?.(link as GraphLink)}
        />
      )}
    </div>
  );
}
