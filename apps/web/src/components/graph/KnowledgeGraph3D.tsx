"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import * as THREE from "three";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { forceCollide, forceLink } from "d3-force-3d";
import { STAGE_LABEL, type CurriculumStage } from "@ice/curriculum";
import { READER_LEVELS, type ReaderLevel } from "@ice/roadmap";
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
  type NodeLabelVisibilityContext,
} from "./graphSceneScaling";
import { buildNodeAdjacency, EMPTY_FOCUS_EMPHASIS, type FocusEmphasis } from "./graphFocus";
import { CONCEPT_ATTRACTION_STRENGTH, computeConceptAttractionPairs, type ConceptAttractionPair } from "./graphForces";
import { assignStagePositions, stageHeaderPositions } from "./roadmapLayout";

// Graph P3 (scene redesign core): a shared serif stack matching the app's
// own --font-serif token (globals.css) -- canvas 2D text can't read a CSS
// custom property, so the resolved font family is hardcoded here rather
// than duplicated as a magic string at every `makeLabelSprite` call site.
const LABEL_FONT_SERIF = "Georgia, 'Times New Roman', serif";

// Reading-state surface opacity (plan's node-language table): "read solid,
// reading + progress arc, unread 55% opacity, missing = wireframe,
// structural muted". Missing's number is the WIREFRAME STROKE opacity, not
// a fill -- its material also gets `wireframe: true` at creation time
// (baked in, not mutated later, since state never changes without a full
// `graphData` rebuild anyway).
const STATE_OPACITY: Record<NodeState, number> = {
  primary: 0.95,
  read: 0.95,
  reading: 0.85,
  unread: 0.55,
  missing: 0.55,
  structural: 0.65,
};

/**
 * Node GEOMETRY family (plan's node-language table): type = hue (material
 * color, applied by the caller) + geometry family. Concept-typed nodes
 * further vary by `concept_kind` (doctrine/tradition/debate/concept) rather
 * than by NodeType, since `kind` is what the data contract actually attaches
 * to a concept node (person-kind concepts are promoted to NodeType "person"
 * upstream and get the capsule geometry via the ordinary type branch below,
 * not a concept sub-case). "Debate" is the one composite shape --
 * `mergeGeometries` bakes two offset tetrahedra into a single BufferGeometry
 * so the rest of this file's "one shape mesh per node" mutation machinery
 * (`stash.sphere`) needs no special-casing for it.
 *
 * Graph P4 (performance ladder): `sphereSegments` sizes every sphere this
 * function returns (the generic type AND every non-`geometryVariety` node);
 * `geometryVariety === false` (the ladder's ">800 nodes" tier) collapses
 * EVERY node to the plain sphere regardless of type/kind, the single
 * biggest geometry-cost reduction available at that scale.
 */
function nodeShapeGeometry(
  node: Pick<GraphNode, "type" | "kind">,
  baseRadius: number,
  sphereSegments: readonly [number, number],
  geometryVariety: boolean,
): THREE.BufferGeometry {
  if (geometryVariety) {
    if (node.type === "person") return new THREE.CapsuleGeometry(baseRadius * 0.5, baseRadius * 0.9, 4, 10);
    if (node.type === "section") return new THREE.CylinderGeometry(baseRadius, baseRadius, baseRadius * 0.22, 20);
    // Debate layer (Phase 28.4): reuses the SAME crossed-tetrahedra
    // composite the `concept_kind === "debate"` branch below already builds
    // for a pre-existing philosophical-debate CONCEPT — thematically apt for
    // a NodeType `"debate"` cluster too (a genuinely contested node), and
    // distinguished from that concept case by color (`TYPE_META.debate` vs.
    // `TYPE_META.concept`) plus label, never by shape alone. `claim` gets
    // its own distinct pointed shape (an assertion "points at" something).
    if (node.type === "debate") {
      const a = new THREE.TetrahedronGeometry(baseRadius * 0.72);
      a.translate(-baseRadius * 0.28, 0, 0);
      const b = new THREE.TetrahedronGeometry(baseRadius * 0.72);
      b.rotateY(Math.PI);
      b.translate(baseRadius * 0.28, 0, 0);
      return mergeGeometries([a, b]) ?? new THREE.OctahedronGeometry(baseRadius);
    }
    if (node.type === "claim") return new THREE.ConeGeometry(baseRadius * 0.62, baseRadius * 1.15, 4);
    if (node.type === "concept") {
      switch (node.kind) {
        case "doctrine":
          return new THREE.DodecahedronGeometry(baseRadius * 0.92);
        case "tradition":
          return new THREE.TorusKnotGeometry(baseRadius * 0.62, baseRadius * 0.2, 64, 8);
        case "debate": {
          const a = new THREE.TetrahedronGeometry(baseRadius * 0.72);
          a.translate(-baseRadius * 0.28, 0, 0);
          const b = new THREE.TetrahedronGeometry(baseRadius * 0.72);
          b.rotateY(Math.PI);
          b.translate(baseRadius * 0.28, 0, 0);
          return mergeGeometries([a, b]) ?? new THREE.OctahedronGeometry(baseRadius);
        }
        case "concept":
        default:
          return new THREE.OctahedronGeometry(baseRadius * 0.95);
      }
    }
  }
  // work, reference, peer_reviewed_source, online_source (always), and
  // EVERY node type once `geometryVariety` is off: the generic sphere.
  return new THREE.SphereGeometry(baseRadius, sphereSegments[0], sphereSegments[1]);
}

// Relative node size by kind — work is the anchor, concepts next, then
// references, with sections (a per-work outline, often numerous) smallest.
// This is the BASE radius baked into the sphere geometry at creation time
// only — never the final on-screen size. Distance/selection/pin accents are
// applied afterward via `mesh.scale` mutation (see D-21-5 below), so this
// table never needs to change for a node to visually grow or shrink.
// Owner report ("hard to make out individual nodes"): roughly doubled from
// the original table (work 6→12, reference 3→6, section 2→4, etc.) — still
// scaled afterward by zoom/pin/selection/roadmap-mode accents exactly as
// before, just off a bigger base.
const NODE_SIZE: Record<NodeType, number> = {
  work: 12,
  reference: 6,
  peer_reviewed_source: 9,
  online_source: 7,
  concept: 8,
  person: 8,
  section: 4,
  // Debate layer (Phase 28.4): a debate cluster is a summary node (at most
  // `MAX_DEBATE_NODES` of them, one per cluster) sized similarly to a
  // concept; a claim only appears after an explicit expansion, at
  // `section`-like granularity — small and numerous, not a headline node.
  debate: 8,
  claim: 5,
};

// Label canvas geometry — two SEPARATE sprites (title, type/state) rather
// than one combined canvas, specifically so the secondary line can be
// hidden independently of the primary one (plan §21.4's "hide secondary
// before shrinking primary") without redrawing/regenerating a texture.
// These are TEXTURE resolutions (pixel crispness), not world/screen size —
// actual on-screen size is set separately (see `screenSpaceLabelScale`).
const PRIMARY_LABEL_CANVAS_HEIGHT = 72;
const SECONDARY_LABEL_CANVAS_HEIGHT = 56;
const EDGE_LABEL_CANVAS_HEIGHT = 46;
// Fallback aspect ratios (canvasHeight / 512), used only if a sprite's own
// measured aspect is somehow missing — never hit in practice since
// `makeLabelSprite` always returns one.
const PRIMARY_LABEL_ASPECT_FALLBACK = PRIMARY_LABEL_CANVAS_HEIGHT / 512;
const SECONDARY_LABEL_ASPECT_FALLBACK = SECONDARY_LABEL_CANVAS_HEIGHT / 512;

// MEASURED PILLS: the label canvas is now sized to the actual text (via
// `ctx.measureText`) plus this padding, clamped to a sane range — no more
// full-512px pills behind a three-word title.
const LABEL_PAD_X = 20;
const LABEL_MIN_CANVAS_WIDTH = 60;
const LABEL_MAX_CANVAS_WIDTH = 420;

// SCREEN-SPACE LABELS: target on-screen pixel heights for the primary/
// secondary node labels once `SpriteMaterial.sizeAttenuation` is off — a
// fixed, always-legible size regardless of camera distance, replacing the
// old distance-clamped world-space scale (calibrated around a 260-unit
// reference distance, but real fit distances run 1000-3000+ at production
// scale — see `screenSpaceLabelScale`'s own doc comment).
const PRIMARY_LABEL_PX = 13;
const SECONDARY_LABEL_PX = 11;
/** Reasonable initial placeholder (fov/viewport) for a label sprite's scale
 *  at CREATION time, before the first `applyNodeAccents` pass (which uses
 *  the live camera fov + measured container height) corrects it. Sprites
 *  start `.visible = false` regardless, so this is never actually seen —
 *  it only guards against a moment where `getGraphBbox()` (which does not
 *  check `.visible`, see that call site's own comment) would otherwise see
 *  THREE.Sprite's native (1,1,1) default scale, orders of magnitude bigger
 *  than the true screen-space size. */
const PLACEHOLDER_FOV_DEGREES = 50;
const PLACEHOLDER_VIEWPORT_HEIGHT = 600;

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
// Owner report ("can't tell what connects to what"): base width roughly
// tripled (0.5 -> 1.6) so an idle edge is legible on its own, not just once
// hover-emphasized.
const BASE_LINK_WIDTH = 1.6;
const LINK_HOVER_WIDTH_FACTOR = 2; // Preserves a clear idle-vs-connected distinction off the new, thicker base.

/** react-force-graph-3d mutates link.source/target from a string id into the
 *  actual node object once the simulation runs — normalize both shapes to a
 *  plain id, matching the same pattern `filterGraphData`/the accessible
 *  table already use for this exact reason. */
function endpointId(end: GraphLink["source"] | GraphLink["target"]): string {
  return typeof end === "string" ? end : (end as { id: string }).id;
}

/** A canvas 2D context used only to `measureText` — never rendered, never
 *  attached to a texture. Reused across calls rather than allocating a new
 *  measurement canvas per label. */
let measureContext: CanvasRenderingContext2D | null | undefined;
function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) measureContext = document.createElement("canvas").getContext("2d");
  return measureContext;
}

/**
 * MEASURED PILLS: the pill/canvas is sized to the actual text width (via
 * `ctx.measureText`) plus padding, clamped to a sane range — the previous
 * version filled the full 512px canvas regardless of text length, so a
 * three-word title and a one-word title got an identically huge pill.
 * `bgColor`/`textColor` come from the theme-resolved surface tokens (Design
 * Decisions: "Pill colors from CSS vars"), not a hardcoded rgba. Returns the
 * canvas's own aspect ratio (height/width) alongside the sprite so the
 * caller can size `sprite.scale` to match — this varies per label now that
 * width is measured, so it can no longer be a shared module constant.
 */
function makeLabelSprite(
  text: string,
  font: string,
  textColor: string,
  canvasHeight: number,
  bgColor: string,
  opts: { textAlpha?: number; sizeAttenuation?: boolean } = {},
): { sprite: THREE.Sprite; aspect: number } {
  const measure = getMeasureContext();
  let textWidth = text.length * 8; // Reasonable fallback if canvas 2D is unavailable.
  if (measure) {
    measure.font = font;
    textWidth = measure.measureText(text).width;
  }
  const canvasWidth = Math.round(Math.max(LABEL_MIN_CANVAS_WIDTH, Math.min(LABEL_MAX_CANVAS_WIDTH, textWidth + LABEL_PAD_X * 2)));
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = bgColor;
    context.roundRect(4, 5, canvas.width - 8, canvas.height - 10, 12);
    context.fill();
    context.globalAlpha = opts.textAlpha ?? 1;
    context.fillStyle = textColor;
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - LABEL_PAD_X);
    context.globalAlpha = 1;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      sizeAttenuation: opts.sizeAttenuation ?? true,
    }),
  );
  return { sprite, aspect: canvas.height / canvas.width };
}

/** `userData` shape stashed on each node's top-level `THREE.Group` by
 *  `nodeThreeObject` — read back by `applyNodeAccents` via `scene().traverse()`
 *  (see that function's own doc comment for why traversal, not `graphData()`,
 *  is the read-back mechanism here). */
type NodeGroupUserData = Partial<{
  nodeId: string;
  /** Needed by the label-visibility policy (`nodePrimaryLabelVisible`),
   *  which treats "work" nodes specially — read back here rather than
   *  re-deriving it from `graphData` (no exposed `graphData()`, see this
   *  file's other traversal-based read-backs). */
  nodeType: NodeType;
  baseRadius: number;
  /** Each label sprite's own measured canvas aspect ratio (height/width) —
   *  varies per node now that the canvas is sized to the actual text
   *  (MEASURED PILLS), so it can no longer be a single shared constant. */
  primaryAspect: number;
  secondaryAspect: number;
  sphere: THREE.Mesh;
  primarySprite: THREE.Sprite;
  secondarySprite: THREE.Sprite;
  /** Next-up/pinned accent ring (Phase 22.8, recolored gold and doubled up
   *  for "pinned" in Graph P3): created for EVERY node so it exists in the
   *  scene from the start, kept invisible except by `applyNodeAccents`'s
   *  mutation pass — same "create once, mutate visibility" pattern as every
   *  other per-node accent here, so toggling which node is next-up/pinned
   *  never triggers the D-21-5 full-rebuild class of cost. */
  ring: THREE.Mesh;
  /** Graph P3: the "work: sphere + thin gold equatorial ring" type accent —
   *  created ONLY for work-type nodes (always visible, no per-frame
   *  visibility toggle needed since a node's TYPE never changes without a
   *  full `graphData` rebuild) but still scaled alongside the shape mesh. */
  equatorialRing?: THREE.Mesh;
  /** Graph P3: the "reading" state's progress arc — created for every node
   *  (its sweep angle is baked in from `masteryScore` at creation time,
   *  never animated), visibility toggled by `applyNodeAccents` to exactly
   *  the nodes currently in the "reading" state. */
  progressArc?: THREE.Mesh;
  /** Graph P3: the credibility ring's 0-4 lit segments, toggled by
   *  `applyNodeAccents` per `credibilitySegmentCount(node.credibilityScore)`. */
  credibilitySegments?: THREE.Mesh[];
  /** Graph P3: up to `READER_LEVELS.length` orbital beads, one per reader
   *  level, toggled visible only for levels the node's role data actually
   *  applies at, only within `READER_LEVEL_BEAD_VISIBLE_DISTANCE`, and only
   *  in explore mode (roadmap mode's fixed stage-column layout hides them —
   *  Graph P4 pulled forward here since the gate is trivial to add at
   *  creation-adjacent mutation time). */
  readerLevelBeads?: THREE.Mesh[];
  /** Graph P4 (choreography): a distinct ring shown only on a hovered
   *  node's one-hop NEIGHBORS (never on the hovered node itself, which gets
   *  the emissive lift instead, nor via selection) — "hover dim + emissive
   *  lift on node + one-hop ring". */
  hoverNeighborRing?: THREE.Mesh;
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
 * `linkThreeObject` are memoized with STABLE dependencies only — theme-
 * resolved palette values (`typeColors`, and now `labelColors` for the
 * label pill background/text) that only ever change on a rare, expected,
 * whole-scene-worth-rebuilding `data-theme` flip — never `selectedNodeId`,
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
 * `applyNodeAccents` itself, by contrast, legitimately reacts to
 * `hoverNode`/`highlightNodeIds` now too (label-visibility policy below) —
 * that is the intended lightweight mutation path this whole architecture
 * exists to make cheap, not the expensive rebuild it protects against.
 */
export function KnowledgeGraph3D({
  data,
  onNodeClick,
  onLinkClick,
  pinnedWorkIds = [],
  selectedNodeId,
  emphasis = EMPTY_FOCUS_EMPHASIS,
  resetSignal = 0,
  isFullscreen = false,
  layoutMode = "explore",
  nextUpNodeId = null,
  onStageHeaderClick,
  showReadingThread = false,
  exportRef,
}: {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  onLinkClick?: (link: GraphLink) => void;
  pinnedWorkIds?: readonly string[];
  selectedNodeId?: string | null;
  /** Phase 21.6 (D-21-2): the selection-focus decision, computed ONCE by
   *  `GraphView` from the shared filtered `GraphData` + `selectedNodeId` +
   *  the active focus mode (`graphFocus.ts`'s `computeFocusEmphasis`) — not
   *  recomputed here, so the 3D scene and the accessible table can never
   *  disagree about which nodes are "in focus." This component only unions
   *  it with its own local `hoverNode` state below (hover ADDS emphasis on
   *  top, it never replaces the selection-driven set). */
  emphasis?: FocusEmphasis;
  /** Incremented by the stage control; keeps reset independent from selection. */
  resetSignal?: number;
  isFullscreen?: boolean;
  /** Phase 22.8 (feature plan §2.1/§2.3): "roadmap" applies the fixed
   *  stage-column layout (`assignStagePositions`) and skips the force
   *  simulation; "explore" (the default) is byte-identical to this
   *  component's pre-22.8 behavior — nothing below changes for it. */
  layoutMode?: "roadmap" | "explore";
  /** The first not-yet-known node in reading sequence (`nextUp()`,
   *  `GraphView` computes it once over the shared displayed dataset) — gets
   *  a distinct selection-independent ring, never a color-only cue. */
  nextUpNodeId?: string | null;
  /** Fires when a 3D-anchored stage column header is clicked (roadmap mode
   *  only) — `GraphView` sets/toggles the same `stage` filter its own
   *  DOM stage-header buttons already drive, so the two controls can never
   *  disagree about what "clicking a stage" means. */
  onStageHeaderClick?: (stage: CurriculumStage) => void;
  /** Off by default (feature plan §2.4's "rejected as decoration" list keeps
   *  this OPT-IN): a single static (non-animated) polyline through the
   *  reading sequence, safe under reduced motion because it never animates
   *  in the first place. */
  showReadingThread?: boolean;
  /** Graph P3: `GraphView`'s "Export PNG" button needs the bloom composer
   *  re-rendered IMMEDIATELY before reading pixels — a WebGL canvas without
   *  `preserveDrawingBuffer` can otherwise hand back a stale/cleared buffer
   *  to `toDataURL()` when called from an unrelated click handler rather
   *  than from inside the library's own animation-frame render. Populated
   *  with a callback once the composer/bloom pass exist (see the dedicated
   *  effect below); `GraphView` calls it right before `canvas.toDataURL()`. */
  exportRef?: { current: (() => void) | null };
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Typed loosely: the library's own generic ref shape (wrapping NodeType in
  // NodeObject<...>/LinkObject<...>) doesn't line up cleanly with our plain
  // GraphNode/GraphLink types when passed through JSX inference — cast at
  // the two call sites below instead of fighting the generics here.
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 800, h: 520 });
  // Graph P4: the performance degradation ladder (`graphSceneScaling.ts`) —
  // ONE classification every visual system in this component reads, rather
  // than several independently-drifting node-count checks. Declared early
  // (a pure derivation of `data.nodes.length`, no WebGL readiness needed)
  // since the bloom-setup effect below needs it too.
  const graphEffects = useMemo(() => graphEffectsForNodeCount(data.nodes.length), [data.nodes.length]);
  const [colors, setColors] = useState<Record<NodeState, string>>();
  const [typeColors, setTypeColors] = useState<Record<NodeType, string>>();
  const [linkColors, setLinkColors] = useState<Record<EdgeFamily, string>>();
  // Label pill background/text — resolved from the same `--color-surface-
  // strong`/`--color-surface-strong-fg` pairing the rest of the app already
  // uses for pills/badges (e.g. `RoadmapConstellation.tsx`), replacing the
  // previous hardcoded dark rgba pill + white text (which does not adapt to
  // theme, and could actually lose contrast against a light-theme resolution
  // of a themed pill if only the background changed and not the text).
  const [labelColors, setLabelColors] = useState<{ bg: string; fg: string }>();
  // Graph P3: the astronomical-plate backdrop + the new gold/wireframe/
  // ring-lit node accent tokens (globals.css) — resolved by the SAME
  // MutationObserver machinery as every other themed color above, so a
  // theme flip re-resolves these too.
  const [graphTokens, setGraphTokens] = useState<{ backdrop: string; gold: string; wireframe: string; ringLit: string }>();
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [motionAllowed, setMotionAllowed] = useState(true);
  // D-21-3: camera-to-origin distance, sampled on a THROTTLED interval
  // (never a per-frame/unthrottled setState) and quantized so a setState
  // only fires when the distance actually moves enough to matter.
  const [cameraDistance, setCameraDistance] = useState(REFERENCE_CAMERA_DISTANCE);
  const cameraDistanceRef = useRef(REFERENCE_CAMERA_DISTANCE);
  // Graph P3: the opposition-edge dashed overlay group — see the dedicated
  // rebuild effect further below and `linkThreeObject`'s own doc comment
  // for why this lives as a fully separate scene-level object rather than
  // being routed through the library's own link-object pipeline.
  const dashOverlayGroupRef = useRef<THREE.Group | null>(null);

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
      setLabelColors({
        bg: cs.getPropertyValue("--color-surface-strong").trim() || "rgba(20,18,15,0.78)",
        fg: cs.getPropertyValue("--color-surface-strong-fg").trim() || "#ffffff",
      });
      setGraphTokens({
        backdrop: cs.getPropertyValue("--color-graph-backdrop").trim() || "#0d1420",
        gold: cs.getPropertyValue("--color-graph-node-gold").trim() || "#e8b968",
        wireframe: cs.getPropertyValue("--color-graph-node-wireframe").trim() || "#a37e7e",
        ringLit: cs.getPropertyValue("--color-graph-node-ring-lit").trim() || "#f2ead9",
      });
    };
    resolve();
    const obs = new MutationObserver(resolve);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Graph P3 (bloom): added to the library's OWN composer exactly once —
  // `postProcessingComposer()` already exists and already renders every
  // frame (three-render-objects creates it unconditionally with a base
  // RenderPass), so adding this ONE extra pass is all that's needed; no
  // separate render loop to wire up. Deliberately NOT gated on
  // `motionAllowed` — bloom is a static per-frame luminance filter with no
  // animation of its own, so it stays on under reduced motion exactly as
  // the plan requires (only particles/camera transitions are motion-gated).
  // Immediate + next-frame retry (same pattern as every other `fgRef`-
  // dependent effect here) since the composer only exists once
  // `<ForceGraph3D>` itself has mounted.
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const BLOOM_STRENGTH = 0.9;
  // Graph P4: the performance ladder's "half"/"off" bloom tiers are applied
  // in this SAME effect (rather than a second one keyed only on
  // `graphEffects.bloom`) specifically to avoid a startup race — a large
  // graph loaded from the very first render would otherwise need the pass
  // to already exist before a separate tier-effect's single run could find
  // it, and `bloomPassRef.current` isn't guaranteed set until the retry-rAF
  // below actually lands. Folding tier application into the SAME
  // create-or-update effect (re-run whenever `graphEffects.bloom` changes
  // too) means there is no window where the pass exists but hasn't had the
  // current tier applied.
  useEffect(() => {
    const setup = () => {
      const graph = fgRef.current;
      if (!graph) return;
      let pass = bloomPassRef.current;
      if (!pass) {
        const composer = graph.postProcessingComposer();
        pass = new UnrealBloomPass(new THREE.Vector2(Math.max(size.w, 1), Math.max(size.h, 1)), BLOOM_STRENGTH, 0.35, 0.55);
        composer.addPass(pass);
        bloomPassRef.current = pass;
      }
      pass.enabled = graphEffects.bloom !== "off";
      pass.strength = graphEffects.bloom === "half" ? BLOOM_STRENGTH / 2 : BLOOM_STRENGTH;
    };
    setup();
    const raf = requestAnimationFrame(setup);
    return () => cancelAnimationFrame(raf);
  }, [colors, typeColors, linkColors, labelColors, size.w, size.h, graphEffects.bloom]);

  // Graph P3: hands `GraphView` a way to force a fresh composer render
  // right before it reads pixels for "Export PNG" — see `exportRef`'s own
  // doc comment above for why this is necessary at all.
  useEffect(() => {
    if (!exportRef) return;
    exportRef.current = () => {
      const graph = fgRef.current;
      if (!graph) return;
      graph.postProcessingComposer().render();
    };
    return () => {
      if (exportRef) exportRef.current = null;
    };
  }, [exportRef]);

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

  // D-21-3, migrated in Graph P4: camera-distance sampling now fires off the
  // OrbitControls' own "change" event (dispatched on every real camera
  // transform — drag, zoom, damping-driven inertia frames, and the
  // programmatic `cameraPosition()` transitions this file already uses for
  // reset/fly-to) rather than blindly polling every 180ms regardless of
  // whether the camera actually moved. An rAF coalesces bursts of "change"
  // events within the same frame into one sample, and the EXISTING
  // quantization (`> 3` world units) still guards the eventual `setState`
  // exactly as before — event-driven is a strictly closer-to-real-time
  // replacement for the poll, not a loosening of the throttle discipline.
  // Direct-manipulation zoom feedback (not ambient/decorative animation), so
  // this runs regardless of `motionAllowed` — same distinction this file
  // already draws for billboarding always facing the camera. Immediate +
  // next-frame retry (same pattern as every other `fgRef`-dependent effect
  // here) since `controls()` only exists once `<ForceGraph3D>` has mounted.
  useEffect(() => {
    let rafPending = false;
    let cleanupControls: (() => void) | undefined;
    const sampleDistance = () => {
      const graph = fgRef.current;
      const camera = graph?.camera();
      if (!camera) return;
      const distance = camera.position.length();
      if (Math.abs(distance - cameraDistanceRef.current) > 3) {
        cameraDistanceRef.current = distance;
        setCameraDistance(distance);
      }
    };
    const onChange = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        sampleDistance();
      });
    };
    const setup = () => {
      const graph = fgRef.current;
      if (!graph) {
        raf = requestAnimationFrame(setup);
        return;
      }
      sampleDistance();
      const controls = graph.controls() as Partial<{
        addEventListener: (event: string, listener: () => void) => void;
        removeEventListener: (event: string, listener: () => void) => void;
      }>;
      if (controls.addEventListener) {
        controls.addEventListener("change", onChange);
        cleanupControls = () => controls.removeEventListener?.("change", onChange);
      }
    };
    let raf = requestAnimationFrame(setup);
    return () => {
      cancelAnimationFrame(raf);
      cleanupControls?.();
    };
  }, []);

  // Graph P4: the opposition-edge dashed overlay's LIVE endpoint positions
  // are a NODE-content concern, not a camera concern (unlike the distance
  // sampling above) — nodes only move during the force simulation's own
  // settling window (`enableNodeDrag={false}`, so there is no other source
  // of node motion), so this is a bounded-duration interval that starts
  // whenever `graphData` changes and stops itself once `onEngineStop` fires
  // (below) or a generous safety timeout elapses, rather than running
  // forever or riding the (unrelated) camera-change event above.
  const dashOverlaySettledRef = useRef(false);
  useEffect(() => {
    dashOverlaySettledRef.current = false;
    const reposition = () => {
      const graph = fgRef.current;
      const overlay = dashOverlayGroupRef.current;
      if (!graph || !overlay || overlay.children.length === 0) return;
      const positions = new Map<string, THREE.Vector3>();
      graph.scene().traverse((object) => {
        const stash = object.userData as NodeGroupUserData;
        if (stash.nodeId) positions.set(stash.nodeId, object.position);
      });
      for (const child of overlay.children) {
        const line = child as THREE.Line;
        const { sourceId, targetId } = line.userData as { sourceId?: string; targetId?: string };
        const start = sourceId ? positions.get(sourceId) : undefined;
        const end = targetId ? positions.get(targetId) : undefined;
        if (!start || !end) continue;
        line.geometry.setFromPoints([start, end]);
        line.computeLineDistances();
      }
    };
    reposition();
    const id = setInterval(() => {
      reposition();
      if (dashOverlaySettledRef.current) clearInterval(id);
    }, 150);
    const safetyTimeout = setTimeout(() => clearInterval(id), 8000);
    return () => {
      clearInterval(id);
      clearTimeout(safetyTimeout);
    };
    // Depends on the same inputs `graphData`'s own useMemo below does
    // (data/pinnedWorkIds/layoutMode) rather than `graphData` itself, which
    // is declared further down this component — this effect only needs to
    // know WHEN a new settling window starts, never the value itself
    // (positions are read live via scene traversal inside `reposition`).
  }, [data, pinnedWorkIds, layoutMode]);

  const nodeSceneScale = useMemo(() => nodeScaleForDistance(cameraDistance), [cameraDistance]);

  // Clone so the library can annotate nodes with x/y/z without mutating props.
  // Phase 22.8: roadmap mode overrides the pin-ring formula entirely — EVERY
  // node gets a deterministic stage-column position from `assignStagePositions`
  // (feature plan §2.1's "fixed positions eliminate both the hairball and the
  // force-simulation cost"), so pinning has no separate ring geometry to
  // fight with in this mode. Explore mode is completely untouched (byte-
  // identical to the pre-22.8 pin-ring behavior).
  const graphData = useMemo(() => {
    if (layoutMode === "roadmap") {
      const positions = assignStagePositions(data.nodes);
      return {
        nodes: data.nodes.map((node) => ({ ...node, ...(positions.get(node.id) ?? { fx: 0, fy: 0, fz: 0 }) })),
        links: data.links.map((link) => ({ ...link })),
      };
    }
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
  }, [data, pinnedWorkIds, layoutMode]);

  // FORCES: a looser, less "hairball" explore-mode layout — longer link
  // distance and stronger repulsion give nodes room to be individually
  // legible, plus a collision force (new: `d3-force-3d`'s `forceCollide`,
  // a transitive dep of `three-forcegraph` already, added as an explicit
  // `apps/web` dependency so this direct import resolves) so nodes can
  // never render fully overlapping regardless of the layout's own spacing.
  // One-time per `graphData` change (not per-frame/per-render) — `d3Force`
  // just reconfigures the SAME simulation instance react-force-graph-3d
  // already owns, it doesn't create a new one. Radius uses the DOUBLED
  // `NODE_SIZE` (owner report fix above) plus a fixed margin; roadmap mode's
  // own `layoutSizeFactor` is irrelevant here since collision only ever
  // does anything in explore mode — roadmap mode's nodes are fixed via
  // `fx/fy/fz` with the simulation cooldown at 0, so nothing is left to
  // collide regardless of what the forces are configured to.
  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;
    graph.d3Force("link")?.distance(70);
    graph.d3Force("charge")?.strength(-160);
    graph.d3Force(
      "collide",
      forceCollide((n: object) => NODE_SIZE[(n as GraphNode).type] * 2 + 12),
    );
  }, [graphData]);

  // Graph P4 (concept clustering): a mild EXTRA attraction between a
  // resource and any concept node it directly cites/discusses/etc — pure
  // pair derivation in `graphForces.ts`, registered via `d3-force-3d`'s own
  // `forceLink` (a second, independent link force alongside the base "link"
  // force above, not a replacement for it) rather than hand-rolled force
  // math. Explore mode ONLY: roadmap mode's nodes are fixed via fx/fy/fz
  // with cooldown at 0 (same reasoning the collision-force comment above
  // already gives), so an attraction force would have nothing to act on
  // there regardless. `null` removes a previously-registered force outright
  // (documented d3-force API), so a graph with no qualifying pairs — or a
  // switch back to roadmap mode — cleanly clears any earlier registration.
  //
  // Registered in its OWN effect, deferred one animation frame AND wrapped
  // in try/catch, rather than synchronously alongside the base forces
  // above — found by a real test failure during this phase's own
  // verification: `Simulation.force(name, forceFn)` calls
  // `forceFn.initialize()` IMMEDIATELY against whatever node array the
  // underlying (non-React) simulation already has registered, but
  // `three-forcegraph`'s own internal sync of a freshly changed `graphData`
  // prop is NOT guaranteed to have completed by the time this SIBLING React
  // effect fires (a one-frame defer measurably reduces how often this races
  // but does not eliminate it — reproduced still throwing even after adding
  // the defer, during this same investigation). A same-tick-or-still-stale
  // registration initializes `forceLink` against the PREVIOUS node set,
  // throwing "node not found" for any id only present in the new one.
  // Reproduced live: filtering the Kind select to "reference" (dropping a
  // concept node) then clicking "Clear all filters" crashed the whole graph
  // pane into its error boundary. The try/catch is the actual fix — same
  // defensive posture every OTHER `scene().traverse()`-based mutation in
  // this file already takes toward "the library's internal state might
  // briefly lag the React props" (guard-and-skip, never assume perfect
  // sync) — a caught failure here just means the next real `graphData`
  // change (which will come regardless, since the underlying data did
  // change) retries the registration; the rAF defer is kept alongside it
  // purely to reduce how often the catch path is actually exercised.
  useEffect(() => {
    const registerConceptAttraction = () => {
      const graph = fgRef.current;
      if (!graph) return;
      try {
        if (layoutMode !== "explore") {
          graph.d3Force("conceptAttraction", null);
          return;
        }
        const pairs = computeConceptAttractionPairs(data.nodes, data.links);
        graph.d3Force(
          "conceptAttraction",
          pairs.length > 0
            ? forceLink<object, ConceptAttractionPair>(pairs)
                .id((n: object) => (n as GraphNode).id)
                .strength(CONCEPT_ATTRACTION_STRENGTH)
                .distance(40)
            : null,
        );
      } catch {
        // The underlying simulation's node registration was still stale —
        // skip this attempt; the next real data/layout change retries.
      }
    };
    const raf = requestAnimationFrame(registerConceptAttraction);
    return () => cancelAnimationFrame(raf);
  }, [graphData, layoutMode, data.nodes, data.links]);

  // Neighbor adjacency, built once per data change rather than per hover
  // event — shared with `graphFocus.ts`'s selection-focus computation
  // rather than a second, locally-reimplemented adjacency map.
  const neighborsByNode = useMemo(() => buildNodeAdjacency(data.links), [data.links]);

  // D-21-2: `emphasis` (the SELECTION-driven focus, computed by the parent
  // from shared props — never force-layout internals) is the base; hover
  // only ever ADDS to it, never replaces it, so a selection's fade persists
  // exactly as-is when the pointer moves away from the selected node. When
  // nothing is selected (`emphasis` is empty), this degrades to the
  // pre-existing hover-only behavior. `null` (not an empty Set) is the
  // "no highlight active at all" signal `nodeColor`/`linkColor` below key
  // off, preserving their existing contract unchanged.
  const hasSelectionFocus = emphasis.emphasizedNodeIds.size > 0;
  const highlightNodeIds = useMemo(() => {
    if (!hasSelectionFocus && !hoverNode) return null;
    const ids = new Set(hasSelectionFocus ? emphasis.emphasizedNodeIds : []);
    if (hoverNode) {
      ids.add(hoverNode.id);
      for (const neighbor of neighborsByNode.get(hoverNode.id) ?? []) ids.add(neighbor);
    }
    return ids;
  }, [hasSelectionFocus, emphasis, hoverNode, neighborsByNode]);
  const highlightLinkIds = useMemo(() => {
    if (!hasSelectionFocus && !hoverNode) return null;
    const ids = new Set(hasSelectionFocus ? emphasis.emphasizedLinkIds : []);
    if (hoverNode) {
      for (const l of data.links) {
        if (endpointId(l.source) === hoverNode.id || endpointId(l.target) === hoverNode.id) ids.add(l.id);
      }
    }
    return ids;
  }, [hasSelectionFocus, emphasis, hoverNode, data.links]);
  const effectsEnabled = motionAllowed && graphEffects.particles;

  // D-21-5: depends only on theme-resolved `typeColors`/`labelColors` —
  // never `selectedNodeId`/`pinnedWorkIds`, which used to force a full
  // rebuild of every node's sphere + label sprites on every single click
  // anywhere in the graph. Selection/pin/label-visibility accents are
  // applied afterward by `applyNodeAccents` mutating the objects tagged
  // here via `userData`.
  const nodeThreeObject = useCallback((value: object) => {
    const node = value as GraphNode;
    const baseRadius = NODE_SIZE[node.type];
    const color = typeColors?.[node.type] ?? "#888";
    const labelBg = labelColors?.bg ?? "rgba(20,18,15,0.78)";
    const labelFg = labelColors?.fg ?? "#ffffff";
    const gold = graphTokens?.gold ?? "#e8b968";
    const wireframeColor = graphTokens?.wireframe ?? "#a37e7e";
    const ringLit = graphTokens?.ringLit ?? "#f2ead9";
    // Phase 22.8: "known" is part of the per-node PAYLOAD (baked in by the
    // server-side roadmap projection), read directly from `node` at creation
    // time exactly like `node.label`/`node.type` above it — never part of
    // this callback's dependency array, so it costs nothing extra under
    // D-21-5's caching rule (it only changes when `graphData` itself does,
    // i.e. a real re-fetch, the same trigger that already rebuilds every
    // node's sphere/label regardless).
    const known = node.roadmap?.known === true;
    const isMissing = node.state === "missing";
    const group = new THREE.Group();

    // Graph P3: node GEOMETRY now varies by type/concept-kind (see
    // `nodeShapeGeometry`'s own doc comment) rather than a universal sphere,
    // and the material carries an `emissive`/`emissiveIntensity` pair for
    // the credibility halo + selective-emphasis glow `applyNodeAccents`
    // drives every frame — MUTATED, never recreated, same D-21-5 discipline
    // as everything else here. "missing" (referenced-but-not-acquired)
    // renders as a wireframe stroke in the dedicated wireframe token color
    // rather than the type hue, so the state reads consistently across
    // every node type/geometry, not just as a dimmer fill.
    const shapeGeometry = nodeShapeGeometry(node, baseRadius, graphEffects.sphereSegments, graphEffects.geometryVariety);
    const shapeMaterial = new THREE.MeshLambertMaterial({
      color: isMissing ? wireframeColor : color,
      wireframe: isMissing,
      transparent: true,
      // Reduced opacity for a known/already-read roadmap item on top of the
      // state-driven baseline — color/wireframe is never the sole signal,
      // the check glyph in the secondary label text below carries the same
      // meaning for anyone who can't distinguish opacity.
      opacity: known ? Math.min(STATE_OPACITY[node.state], 0.5) : STATE_OPACITY[node.state],
      emissive: new THREE.Color(isMissing ? wireframeColor : color),
      emissiveIntensity: 0, // set every frame by applyNodeAccents (authority halo + selective emphasis)
    });
    const sphere = new THREE.Mesh(shapeGeometry, shapeMaterial);
    group.add(sphere);

    // "work: sphere + thin gold equatorial ring" — created ONLY for
    // work-type nodes (every work node IS an uploaded work per the data
    // contract, so this doubles as the "uploaded" accent with no separate
    // condition needed), lying flat like a planetary ring rather than
    // facing the camera like the credibility/next-up rings below.
    let equatorialRing: THREE.Mesh | undefined;
    if (node.type === "work") {
      equatorialRing = new THREE.Mesh(
        new THREE.TorusGeometry(baseRadius * 1.15, Math.max(0.3, baseRadius * 0.06), 8, 32),
        new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.85 }),
      );
      equatorialRing.rotation.x = Math.PI / 2;
      group.add(equatorialRing);
    }

    // "reading + progress arc": a partial ring swept to `masteryScore` when
    // a real one is recorded (concept/person nodes), or a fixed schematic
    // fraction otherwise — never a fabricated PERCENTAGE for a work/
    // reference node the app has no numeric reading-progress data for, just
    // a bounded "in progress" glyph distinguishing it from unread/read.
    // Sweep angle is baked in at creation (never animated), so only
    // visibility needs mutating per frame.
    const progressFraction = node.masteryScore != null ? Math.max(0, Math.min(1, node.masteryScore / 100)) : 0.55;
    const progressArc = new THREE.Mesh(
      new THREE.TorusGeometry(baseRadius * 1.35, Math.max(0.3, baseRadius * 0.08), 6, 24, Math.max(0.05, progressFraction) * Math.PI * 2),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    progressArc.visible = false;
    group.add(progressArc);

    // Credibility ring: 0-4 lit segments (`credibilitySegmentCount`),
    // evenly spaced with a gap between each so the count reads as discrete
    // steps rather than one continuous arc.
    const credibilitySegments: THREE.Mesh[] = [];
    for (let i = 0; i < 4; i++) {
      const segment = new THREE.Mesh(
        new THREE.TorusGeometry(baseRadius * 1.55, Math.max(0.25, baseRadius * 0.05), 6, 8, ((Math.PI * 2) / 4) * 0.78),
        new THREE.MeshBasicMaterial({ color: ringLit, transparent: true, opacity: 0.92 }),
      );
      segment.rotation.z = (i * Math.PI * 2) / 4;
      segment.visible = false;
      group.add(segment);
      credibilitySegments.push(segment);
    }

    // Reader-level orbital beads: one per `READER_LEVELS` entry, fixed
    // position per level index so a given level always sits at the same
    // "clock position" across every node — only the visible subset differs.
    // Graph P4: skipped entirely (not just hidden) once the performance
    // ladder's `beads` flag is off — creation cost, not just a visibility
    // toggle, is what the ladder exists to save at higher node counts.
    const readerLevelBeads: THREE.Mesh[] = [];
    if (graphEffects.beads) {
      const beadGeometry = new THREE.SphereGeometry(Math.max(0.6, baseRadius * 0.18), 8, 6);
      for (let i = 0; i < READER_LEVELS.length; i++) {
        const bead = new THREE.Mesh(beadGeometry, new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.9 }));
        const angle = (i / READER_LEVELS.length) * Math.PI * 2;
        bead.position.set(Math.cos(angle) * baseRadius * 1.9, Math.sin(angle) * baseRadius * 1.9, 0);
        bead.visible = false;
        group.add(bead);
        readerLevelBeads.push(bead);
      }
    }

    // Hover one-hop neighbor ring (Graph P4 choreography): a distinct,
    // muted ring shown ONLY on the hovered node's direct neighbors — sized
    // between the equatorial/progress rings and the credibility ring so it
    // never visually collides with either.
    const hoverNeighborRing = new THREE.Mesh(
      new THREE.TorusGeometry(baseRadius * 1.45, Math.max(0.25, baseRadius * 0.05), 8, 28),
      new THREE.MeshBasicMaterial({ color: ringLit, transparent: true, opacity: 0.55 }),
    );
    hoverNeighborRing.visible = false;
    group.add(hoverNeighborRing);

    // Two SEPARATE canvas sprites (title, type/state) rather than one
    // combined texture, so the secondary line can be hidden independently
    // of the primary one without redrawing anything. Both always face the
    // camera by construction (THREE.Sprite billboarding) — unchanged from
    // before. SCREEN-SPACE (`sizeAttenuation: false`): a fixed, always-
    // legible on-screen pixel size regardless of camera distance, sized via
    // `applyNodeAccents` below (creation-time scale here is only a
    // placeholder — both sprites start invisible, see `LabelVisibility`
    // constants' own doc comments). Both start `.visible = false` — the
    // label-density fix (owner report: 200-400 always-visible pills at
    // production scale): only a few bounded, meaningful signals ever reveal
    // them (`applyNodeAccents`'s `nodePrimaryLabelVisible`/
    // `nodeSecondaryLabelVisible` calls).
    const title = node.label.length > 42 ? `${node.label.slice(0, 39)}…` : node.label;
    const { sprite: primarySprite, aspect: primaryAspect } = makeLabelSprite(
      title,
      `600 28px ${LABEL_FONT_SERIF}`,
      labelFg,
      PRIMARY_LABEL_CANVAS_HEIGHT,
      labelBg,
      { sizeAttenuation: false },
    );
    // Reader-level chip in the secondary label (plan's "level chip in
    // secondary label" requirement) — a short slash-joined abbreviation,
    // absent entirely when the node carries no role-scoping data at all
    // (never punish/misrepresent missing data as "applies nowhere").
    const levelChip = node.readerLevels && node.readerLevels.length > 0
      ? ` · ${node.readerLevels.map((level) => level.slice(0, 3)).join("/")}`
      : "";
    const secondaryText = `${node.type.replace(/_/g, " ")} · ${STATE_META[node.state].label}${known ? " · ✓ read" : ""}${levelChip}`;
    const { sprite: secondarySprite, aspect: secondaryAspect } = makeLabelSprite(
      secondaryText,
      `20px ${LABEL_FONT_SERIF}`,
      labelFg,
      SECONDARY_LABEL_CANVAS_HEIGHT,
      labelBg,
      { textAlpha: 0.78, sizeAttenuation: false },
    );

    const placeholderPrimaryScale = screenSpaceLabelScale(PRIMARY_LABEL_PX, PLACEHOLDER_FOV_DEGREES, PLACEHOLDER_VIEWPORT_HEIGHT);
    const placeholderSecondaryScale = screenSpaceLabelScale(SECONDARY_LABEL_PX, PLACEHOLDER_FOV_DEGREES, PLACEHOLDER_VIEWPORT_HEIGHT);
    primarySprite.scale.set(placeholderPrimaryScale / primaryAspect, placeholderPrimaryScale, 1);
    secondarySprite.scale.set(placeholderSecondaryScale / secondaryAspect, placeholderSecondaryScale, 1);
    const primaryOffset = baseRadius * 1.4;
    primarySprite.position.set(0, primaryOffset, 0);
    secondarySprite.position.set(0, primaryOffset + baseRadius * 0.5, 0);
    primarySprite.visible = false;
    secondarySprite.visible = false;
    primarySprite.renderOrder = 1;
    secondarySprite.renderOrder = 1;
    group.add(primarySprite, secondarySprite);

    // Next-up/pinned accent ring (Phase 22.8, gold per Graph P3): created
    // for EVERY node, hidden by default — `applyNodeAccents` toggles
    // `.visible` for whichever node is currently next-up OR pinned, the
    // same create-once/mutate-visibility pattern D-21-5 already established.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(baseRadius * 1.7, Math.max(0.4, baseRadius * 0.14), 8, 28),
      new THREE.MeshBasicMaterial({ color: gold, transparent: true, opacity: 0.85 }),
    );
    ring.visible = false;
    group.add(ring);

    const nodeUserData: NodeGroupUserData = {
      nodeId: node.id,
      nodeType: node.type,
      baseRadius,
      primaryAspect,
      secondaryAspect,
      sphere,
      primarySprite,
      secondarySprite,
      ring,
      equatorialRing,
      progressArc,
      credibilitySegments,
      readerLevelBeads,
      hoverNeighborRing,
    };
    group.userData = nodeUserData;
    return group;
  }, [typeColors, labelColors, graphTokens, graphEffects]);

  // D-21-4: the edge-relation label sprite. Depends only on the theme-
  // resolved `labelColors` (same accepted rebuild class as `typeColors`
  // above — a rare, whole-scene-worth-rebuilding theme flip, never hover/
  // selection/distance). Its text is fixed per edge, and it starts
  // invisible, revealed by `applyLinkAccents` below. Combined with
  // `linkThreeObjectExtend` (constant `true`, see the JSX), the library
  // keeps managing the default line/cylinder object exactly as before;
  // this sprite is purely an additional child. MUST stay a bare Sprite
  // (never wrapped in an extra Group here) — `applyLinkAccents` below finds
  // the library's own default line mesh via `sprite.parent.children[0]`,
  // which relies on `sprite.parent` being the library's OWN wrapping group
  // (`linkThreeObjectExtend`'s `new Group(); .add(defaultObj); .add(customObj)`).
  // The opposition-edge dashed overlay (Graph P3, `edgeIsDashed`) is
  // therefore NOT routed through this function at all — see the dedicated
  // `dashOverlayGroupRef` effect below, which owns it as a fully separate
  // scene-level object precisely to avoid that coupling.
  const linkThreeObject = useCallback((value: object) => {
    const link = value as GraphLink;
    const text = edgeRelationLabel(link.edgeType, link.category);
    const clipped = text.length > 30 ? `${text.slice(0, 27)}…` : text;
    const { sprite, aspect } = makeLabelSprite(
      clipped,
      `600 20px ${LABEL_FONT_SERIF}`,
      labelColors?.fg ?? "#ffffff",
      EDGE_LABEL_CANVAS_HEIGHT,
      labelColors?.bg ?? "rgba(20,18,15,0.78)",
    );
    const baseScale = { x: 16, y: 16 * aspect };
    sprite.scale.set(baseScale.x, baseScale.y, 1);
    sprite.visible = false;
    sprite.renderOrder = 2;
    const linkUserData: LinkSpriteUserData = { linkId: link.id, baseScale, sourceId: endpointId(link.source), targetId: endpointId(link.target) };
    sprite.userData = linkUserData;
    return sprite;
  }, [labelColors]);

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

  // Curvature per edge family (link-language table) — structural edges stay
  // straight, opposition bows the most (and renders dashed, above). Graph
  // P4: collapsed to the coarser 2-tier scheme at higher node counts per
  // the performance ladder.
  const linkCurvature = useCallback((l: object) => {
    const link = l as GraphLink;
    return collapseCurvature(edgeCurvature(link.edgeType, link.category), graphEffects.curvatureTiers);
  }, [graphEffects.curvatureTiers]);

  // Particle COUNT scales with the edge's own confidence (1-3) once
  // particles are the chosen direction cue at all — `edgeDirectionCue`
  // still decides particles-vs-arrow-vs-none exactly as before.
  const linkDirectionalParticles = useCallback((l: object) => {
    const link = l as GraphLink;
    return edgeDirectionCue(link.edgeType, effectsEnabled) === "particles" ? particleCountForConfidence(link.confidence) : 0;
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
  // SELECTIVE LABELS + SCREEN-SPACE LABELS: `nodeLabelCtx` is the one shared
  // input to both label-visibility calls below (`nodePrimaryLabelVisible`/
  // `nodeSecondaryLabelVisible`, `graphSceneScaling.ts`) so the two can never
  // read a stale/inconsistent snapshot of selection+hover+highlight state.
  const nodeLabelCtx = useMemo<NodeLabelVisibilityContext>(
    () => ({
      selectedNodeId: selectedNodeId ?? null,
      hoverNodeId: hoverNode?.id ?? null,
      nextUpNodeId: nextUpNodeId ?? null,
      highlightNodeIds,
    }),
    [selectedNodeId, hoverNode, nextUpNodeId, highlightNodeIds],
  );
  // NODE/LINK SIZING: roadmap mode's fixed stage-column grid reads
  // comfortably bigger than explore mode's naturally clustered force layout
  // — an ADDITIONAL multiplier on top of the zoom-driven `nodeScaleFactor`.
  const layoutSizeFactor = useMemo(() => nodeSizeFactorForLayout(layoutMode), [layoutMode]);

  // Graph P3: node-data lookup for the mutation pass below (credibility,
  // reader levels, mastery, state) — `applyNodeAccents` only has the
  // `userData` stash's nodeId/nodeType (tagged at creation) to work from
  // otherwise, same "no exposed graphData()" constraint documented above.
  // Stable per fetch, so this costs nothing extra beyond a `data.nodes`
  // change (which already retriggers the effects that call this function).
  const nodesById = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);

  // Graph P4 (choreography): "select keeps ... a 300ms emissive swell" — a
  // transient extra emissiveIntensity bump on the newly-selected node that
  // decays linearly back to baseline over 300ms, skipped under reduced
  // motion/hidden-tab/large-graph (`effectsEnabled`) exactly like the
  // fly-to transition's own duration already is. `applyNodeAccents` reads
  // this ref directly (never React state) so the swell doesn't cause its
  // own re-renders; the short-lived rAF loop driving it is registered in a
  // dedicated effect further below, keyed on `selectedNodeId`.
  const selectionSwellRef = useRef<{ nodeId: string; startTime: number } | null>(null);
  const SELECTION_SWELL_MS = 300;

  const applyNodeAccents = useCallback(() => {
    const graph = fgRef.current;
    if (!graph) return;
    const camera = graph.camera();
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : PLACEHOLDER_FOV_DEGREES;
    const primaryScaleY = screenSpaceLabelScale(PRIMARY_LABEL_PX, fov, size.h);
    const secondaryScaleY = screenSpaceLabelScale(SECONDARY_LABEL_PX, fov, size.h);
    const beadsAllowed = layoutMode === "explore" && readerLevelBeadsVisible(cameraDistance);
    graph.scene().traverse((object) => {
      const stash = object.userData as NodeGroupUserData;
      if (!stash.nodeId || !stash.nodeType || !stash.sphere || !stash.primarySprite || !stash.secondarySprite || stash.baseRadius == null) return;
      const node = nodesById.get(stash.nodeId);
      const isSelected = selectedNodeId === stash.nodeId;
      const isPinned = pinnedWorkIds.includes(stash.nodeId);
      const nodeFactor = (nodeSceneScale.nodeScaleFactor + (isPinned ? PIN_SCALE_BUMP : 0) + (isSelected ? SELECTED_SCALE_BUMP : 0)) * layoutSizeFactor;
      stash.sphere.scale.setScalar(nodeFactor);
      const radiusWorld = stash.baseRadius * nodeFactor;

      // Graph P3: selective emphasis + credibility halo, both applied via
      // `material.emissiveIntensity` (never THREE layers) — the mutation
      // this file's whole D-21-5 architecture exists to make cheap. Bloom
      // (mounted once, see the composer effect below) then picks up
      // whichever nodes render above its luminance threshold. When nothing
      // is highlighted at all, every node keeps its full authority-driven
      // halo plus a small baseline lift so the plate isn't inert; once a
      // selection/hover focus IS active, emphasized nodes get an additional
      // boost and everything else is suppressed toward near-zero — the same
      // emphasize/dim split `nodeColor` below already applies to color.
      const shapeMaterial = stash.sphere.material as THREE.MeshLambertMaterial;
      if (shapeMaterial && node) {
        const authorityGlow = authorityEmissiveIntensity(node.authority, node.credibility?.score ?? node.credibilityScore ?? null);
        const isEmphasized = !highlightNodeIds || highlightNodeIds.has(stash.nodeId);
        // Graph P4: the transient selection swell — linear decay to 0 over
        // `SELECTION_SWELL_MS`, added on top of the P3 baseline below.
        const swell = selectionSwellRef.current && selectionSwellRef.current.nodeId === stash.nodeId
          ? Math.max(0, 1 - (performance.now() - selectionSwellRef.current.startTime) / SELECTION_SWELL_MS) * 0.6
          : 0;
        shapeMaterial.emissiveIntensity = (highlightNodeIds && !isEmphasized ? Math.min(authorityGlow, 0.05) : authorityGlow + (highlightNodeIds ? 0.35 : 0.15)) + swell;
      }
      // Graph P4 (choreography): "hover dim + emissive lift on node +
      // one-hop ring" — the emissive lift is the boost above (hoverNode is
      // already unioned into `highlightNodeIds`/`highlightNodeIds` via the
      // existing hover state); this ring is the remaining piece, shown ONLY
      // on the hovered node's direct neighbors, never on the hovered node
      // itself (selection uses the swell above instead of this ring).
      if (stash.hoverNeighborRing) {
        const isHoverNeighbor = hoverNode != null && stash.nodeId !== hoverNode.id && (neighborsByNode.get(hoverNode.id)?.has(stash.nodeId) ?? false);
        stash.hoverNeighborRing.visible = isHoverNeighbor;
        stash.hoverNeighborRing.scale.setScalar(nodeFactor);
      }

      // SELECTIVE LABELS: a bounded set of signals decides visibility —
      // never every node at once (label-density owner report).
      const primaryVisible = nodePrimaryLabelVisible({ id: stash.nodeId, type: stash.nodeType }, nodeLabelCtx);
      const secondaryVisible = primaryVisible && nodeSecondaryLabelVisible({ id: stash.nodeId }, nodeLabelCtx);
      stash.primarySprite.visible = primaryVisible;
      stash.secondarySprite.visible = secondaryVisible;

      // SCREEN-SPACE LABELS: fixed on-screen pixel height (via the live
      // camera fov + measured container height), independent of the node's
      // own zoom-driven scale factor — a label stays legible at any
      // distance rather than saturating a world-space clamp.
      if (primaryVisible) {
        const aspect = stash.primaryAspect ?? PRIMARY_LABEL_ASPECT_FALLBACK;
        stash.primarySprite.scale.set(primaryScaleY / aspect, primaryScaleY, 1);
      }
      if (secondaryVisible) {
        const aspect = stash.secondaryAspect ?? SECONDARY_LABEL_ASPECT_FALLBACK;
        stash.secondarySprite.scale.set(secondaryScaleY / aspect, secondaryScaleY, 1);
      }
      // Position stays WORLD-space (tied to the node's own visual radius)
      // even though size is now screen-space — the two are independent
      // concerns (where the label sits vs. how big it reads on screen).
      const primaryOffset = radiusWorld * 1.4;
      stash.primarySprite.position.set(0, primaryOffset, 0);
      stash.secondarySprite.position.set(0, primaryOffset + radiusWorld * 0.5, 0);
      // Phase 22.8/Graph P3: the accent ring is selection-independent and
      // now doubles for "pinned" (gold ring/scale/gold torus) as well as
      // next-up — a node can be selected, pinned, AND next-up at once, or
      // any combination, all distinct signals.
      if (stash.ring) {
        stash.ring.visible = (nextUpNodeId != null && stash.nodeId === nextUpNodeId) || isPinned;
        stash.ring.scale.setScalar(nodeFactor);
      }
      if (stash.equatorialRing) stash.equatorialRing.scale.setScalar(nodeFactor);
      if (stash.progressArc) {
        stash.progressArc.visible = node?.state === "reading";
        stash.progressArc.scale.setScalar(nodeFactor);
      }
      if (stash.credibilitySegments) {
        const lit = credibilitySegmentCount(node?.credibility?.score ?? node?.credibilityScore ?? null);
        stash.credibilitySegments.forEach((segment, index) => {
          segment.visible = index < lit;
          segment.scale.setScalar(nodeFactor);
        });
      }
      if (stash.readerLevelBeads) {
        const levels = node?.readerLevels ?? [];
        stash.readerLevelBeads.forEach((bead, index) => {
          const level = READER_LEVELS[index] as ReaderLevel | undefined;
          bead.visible = beadsAllowed && level != null && levels.includes(level);
          bead.scale.setScalar(nodeFactor);
        });
      }
    });
  }, [selectedNodeId, pinnedWorkIds, nodeSceneScale, nextUpNodeId, layoutSizeFactor, nodeLabelCtx, size.h, nodesById, highlightNodeIds, layoutMode, cameraDistance, hoverNode, neighborsByNode]);

  // D-21-4/D-21-5 (edge side): selection-and-hover-connected width emphasis
  // and edge-label reveal/scale, both applied by mutating the already-
  // created line mesh + label sprite rather than through any accessor's
  // dependency surface. Same `scene().traverse()` read-back as
  // `applyNodeAccents` above, for the same reason (no exposed
  // `graphData()`); `linkId` was captured into the sprite's own `userData`
  // at creation time so this needs no link-array lookup, just a Set check
  // against `highlightLinkIds` (D-21-2's selection+hover union — see above).
  const applyLinkAccents = useCallback(() => {
    const graph = fgRef.current;
    if (!graph) return;
    graph.scene().traverse((object) => {
      const stash = object.userData as LinkSpriteUserData;
      if (!stash.linkId || !stash.baseScale) return;
      const sprite = object as THREE.Sprite;
      const lineMesh = sprite.parent?.children?.[0] as THREE.Mesh | undefined;
      const connected = highlightLinkIds ? highlightLinkIds.has(stash.linkId) : false;
      const widthFactor = (connected ? LINK_HOVER_WIDTH_FACTOR : 1) * nodeSceneScale.nodeScaleFactor;
      if (lineMesh?.scale) lineMesh.scale.set(widthFactor, widthFactor, lineMesh.scale.z);
      // Graph P4: edge-label sprites are visibility-gated off entirely past
      // the performance ladder's "minimal" tier — the sprite object itself
      // still exists (needed for the linkId tag + lineMesh width-highlight
      // lookup above, a genuinely different feature this must not break),
      // it simply never becomes visible at that scale.
      const visible = graphEffects.edgeLabelSprites && edgeLabelVisible(cameraDistance, connected);
      sprite.visible = visible;
      if (visible) {
        const factor = nodeSceneScale.labelScaleFactor;
        sprite.scale.set(stash.baseScale.x * factor, stash.baseScale.y * factor, 1);
      }
    });
  }, [highlightLinkIds, nodeSceneScale, cameraDistance, graphEffects.edgeLabelSprites]);

  // Both accent passes run once immediately (in case objects already exist)
  // and once more next frame (to catch objects the library hasn't finished
  // creating yet after a `graphData`/filter change) — never on a per-frame
  // loop of their own.
  useEffect(() => {
    applyNodeAccents();
    const raf = requestAnimationFrame(applyNodeAccents);
    return () => cancelAnimationFrame(raf);
  }, [applyNodeAccents, graphData]);

  // Graph P4: drives the 300ms selection emissive swell — a short, bounded
  // rAF loop (never an ongoing per-frame loop) that re-runs the mutation
  // pass every frame ONLY for the swell's own duration after a genuinely
  // new selection, skipped entirely under reduced motion/hidden-tab/large
  // graphs (`effectsEnabled`, the same gate the fly-to transition's
  // duration already uses).
  useEffect(() => {
    if (!selectedNodeId || !effectsEnabled) return;
    selectionSwellRef.current = { nodeId: selectedNodeId, startTime: performance.now() };
    let raf = 0;
    const tick = () => {
      applyNodeAccents();
      const elapsed = performance.now() - (selectionSwellRef.current?.startTime ?? 0);
      if (elapsed < SELECTION_SWELL_MS) raf = requestAnimationFrame(tick);
      else selectionSwellRef.current = null;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `applyNodeAccents` deliberately excluded: it changes identity on nearly every render (camera distance, hover, etc.), and re-running this effect for those reasons would restart the swell's own 300ms clock instead of letting the CURRENT swell finish; only a genuinely NEW selection (or a motion-preference change) should restart it.
  }, [selectedNodeId, effectsEnabled]);

  useEffect(() => {
    applyLinkAccents();
    const raf = requestAnimationFrame(applyLinkAccents);
    return () => cancelAnimationFrame(raf);
  }, [applyLinkAccents, graphData]);

  // D-23-52 (owner report: Visualization "does not have the requested 3D
  // effects" / "impossible to navigate"): react-force-graph-3d's own
  // auto-camera (`onUpdate` in node_modules/3d-force-graph) re-aims the
  // camera using ONLY the node COUNT — `Math.cbrt(nodeCount) * 170` — never
  // the nodes' actual spatial extent. That assumption holds in explore mode
  // (the force simulation naturally clusters nodes near the origin) but not
  // in roadmap mode, whose fixed stage-column layout (`roadmapLayout.ts`,
  // COLUMN_GAP=260) routinely spans hundreds of world units even for a
  // handful of nodes. A camera aimed by node count alone can end up framing
  // empty space next to the graph — reproduced locally: the roadmap default
  // view rendered a genuinely blank canvas with real seeded data.
  //
  // The library's own built-in `zoomToFit` was tried first and rejected: its
  // internal distance formula (`three-render-objects`' `fitToBbox`, plugging
  // a small-angle quantity into `Math.atan` where a `Math.tan`-based
  // half-angle triangle is what actually frames a box) reliably over-zooms
  // by roughly 2.5x, AND it always aims at world origin rather than the
  // box's own centroid — measured directly against this bug: a 4-node
  // roadmap graph whose real bbox needed distance ~840 for a tight fit
  // instead got framed at distance ~2190. `fitCameraToBbox`
  // (`graphSceneScaling.ts`, unit-tested) is a correct, from-scratch
  // replacement: real trigonometry, aimed at the bbox's actual center.
  const fitCameraToGraph = useCallback(
    (durationMs: number) => {
      const graph = fgRef.current as ForceGraphMethods | undefined;
      if (!graph) return;
      const bbox = graph.getGraphBbox();
      const aspect = size.h > 0 ? size.w / size.h : 1;
      const fit = fitCameraToBbox(bbox, aspect);
      // Bearing (viewing direction) is taken from the camera's current
      // position relative to WORLD ORIGIN, the same convention
      // `focusCameraOnSelection` below already uses — only the distance and
      // look-at target are corrected here. Falls back to a fixed +z bearing
      // when the camera sits exactly at the origin (never true after the
      // library's own initial (0,0,1000) default, but guarded rather than
      // normalizing a zero-length vector).
      const camera = graph.camera();
      const direction =
        camera.position.lengthSq() > 0 ? camera.position.clone().normalize() : new THREE.Vector3(0, 0, 1);
      graph.cameraPosition(
        {
          x: fit.target.x + direction.x * fit.distance,
          y: fit.target.y + direction.y * fit.distance,
          z: fit.target.z + direction.z * fit.distance,
        },
        fit.target,
        durationMs,
      );
    },
    [size],
  );

  // Fires once the simulation settles for the CURRENT `graphData` — for
  // roadmap mode (`cooldownTicks: 0`) this is essentially the next tick
  // after real node/link objects exist; for explore mode it's after the
  // force layout actually converges. Either way it is the library's own
  // documented signal that node positions are final and worth framing —
  // more reliable than guessing a fixed retry-frame count (measured
  // directly: an immediate-plus-one-more-frame retry still ran before real
  // node objects existed and framed an empty scene).
  const onEngineStop = useCallback(() => {
    // Graph P4: the simulation has converged — node positions are final
    // (no drag is possible, `enableNodeDrag={false}`), so the bounded
    // dash-overlay reposition interval above can stop itself.
    dashOverlaySettledRef.current = true;
    fitCameraToGraph(0);
  }, [fitCameraToGraph]);

  useEffect(() => {
    if (!resetSignal) return;
    fitCameraToGraph(effectsEnabled ? 450 : 0);
  }, [effectsEnabled, resetSignal, fitCameraToGraph]);

  // D-21-2 (requirement 1): camera framing is centralized HERE, keyed on
  // the `selectedNodeId` PROP rather than the scene's own click event — a
  // selection made via the accessible table, keyboard prev/next, or a
  // restored `?selected=` URL param frames the camera exactly like a direct
  // 3D click, and only ONE damped transition ever fires per actual
  // selection change (the click handler below no longer computes its own
  // camera position at all, so there is never a duplicate transition for a
  // scene click specifically). Reads the node's live simulated position via
  // the same `scene().traverse()` read-back `applyNodeAccents` already uses
  // (no exposed `graphData()` — see that function's own doc comment) rather
  // than the click event's own `x/y/z`, which a non-click selection source
  // never has.
  const focusCameraOnSelection = useCallback(() => {
    const graph = fgRef.current;
    if (!graph || !selectedNodeId) return false;
    // `target` is intentionally read back with an explicit cast rather than
    // relying on TypeScript to narrow it after the `!target` check below —
    // it's reassigned inside `traverse`'s nested callback, which TS's
    // control-flow analysis can't see through, and narrows the "found" case
    // to `never` instead of the actual object type without the cast.
    let target: { x: number; y: number; z: number } | null = null;
    graph.scene().traverse((object) => {
      if (target) return;
      const stash = object.userData as NodeGroupUserData;
      if (stash.nodeId === selectedNodeId) target = { x: object.position.x, y: object.position.y, z: object.position.z };
    });
    if (!target) return false;
    const position = target as { x: number; y: number; z: number };
    const distance = 120;
    const ratio = position.x === 0 && position.y === 0 && position.z === 0 ? 1 : 1 + distance / Math.hypot(position.x, position.y, position.z || 1);
    graph.cameraPosition({ x: position.x * ratio, y: position.y * ratio, z: position.z * ratio }, position, effectsEnabled ? 700 : 0);
    return true;
  }, [selectedNodeId, effectsEnabled]);

  useEffect(() => {
    if (!selectedNodeId) return;
    // The selected node's 3D object may not exist in the scene yet on the
    // very first render after a selection (e.g. a restored `?selected=` id
    // resolving before the library has finished mounting objects for the
    // current `graphData`) — same immediate-plus-next-frame retry as
    // `applyNodeAccents`/`applyLinkAccents` above, never a per-frame loop.
    if (focusCameraOnSelection()) return;
    const raf = requestAnimationFrame(focusCameraOnSelection);
    return () => cancelAnimationFrame(raf);
  }, [selectedNodeId, focusCameraOnSelection]);

  // Phase 22.8: 3D-anchored stage column headers (roadmap mode only) — a
  // small group of label sprites added DIRECTLY to the scene (not part of
  // `graphData`, so they're outside react-force-graph-3d's own node/link
  // management entirely), one per `STAGE_ORDER` stage, positioned by the
  // same pure `stageHeaderPositions` helper the progress strip's column math
  // ultimately derives from too. Rebuilt whenever the roadmap node set or
  // the resolved palette changes; removed outright in explore mode.
  const headerGroupRef = useRef<THREE.Group | null>(null);
  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;
    const scene = graph.scene();
    if (headerGroupRef.current) {
      scene.remove(headerGroupRef.current);
      headerGroupRef.current = null;
    }
    if (layoutMode !== "roadmap" || !typeColors || !labelColors) return;
    const group = new THREE.Group();
    for (const header of stageHeaderPositions(data.nodes)) {
      const { sprite, aspect } = makeLabelSprite(
        STAGE_LABEL[header.stage],
        "600 26px system-ui, sans-serif",
        labelColors.fg,
        PRIMARY_LABEL_CANVAS_HEIGHT,
        labelColors.bg,
      );
      sprite.scale.set(52, 52 * aspect, 1);
      sprite.position.set(header.fx, header.fy, 0);
      sprite.renderOrder = 1;
      const headerUserData: { stageHeader: CurriculumStage } = { stageHeader: header.stage };
      sprite.userData = headerUserData;
      group.add(sprite);
    }
    scene.add(group);
    headerGroupRef.current = group;
  }, [layoutMode, data.nodes, typeColors, labelColors]);

  // Clickable stage headers (feature plan §2.4): a raycast against ONLY the
  // header group's own sprites (a small, bounded set), never against the
  // library's own node/link objects — this listener is additive on the
  // container and never interferes with react-force-graph-3d's own
  // click/drag handling on the canvas itself.
  const onCanvasClick = useCallback(
    (event: MouseEvent) => {
      const graph = fgRef.current;
      const container = containerRef.current;
      if (!graph || !container || !headerGroupRef.current || !onStageHeaderClick) return;
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, graph.camera());
      const hit = raycaster.intersectObjects(headerGroupRef.current.children, false)[0];
      const stage = (hit?.object.userData as { stageHeader?: CurriculumStage } | undefined)?.stageHeader;
      if (stage) onStageHeaderClick(stage);
    },
    [onStageHeaderClick],
  );
  useEffect(() => {
    const container = containerRef.current;
    if (!container || layoutMode !== "roadmap") return;
    container.addEventListener("click", onCanvasClick);
    return () => container.removeEventListener("click", onCanvasClick);
  }, [layoutMode, onCanvasClick]);

  // Graph P3 (link language): rebuilds the opposition-edge dashed overlay
  // group whenever the opposition-family link SET changes (a straight chord
  // per edge — a deliberate, honestly-restrained simplification rather than
  // tracing the tube mesh's own bezier curvature, see `linkThreeObject`'s
  // own doc comment for why it can't safely mutate that shared-material mesh
  // directly). Endpoint POSITIONS are kept live separately, on the D-21-3
  // throttled interval above — this effect only recreates the line objects
  // themselves when which edges are dashed actually changes.
  useEffect(() => {
    const graph = fgRef.current;
    if (!graph || !linkColors) return;
    const scene = graph.scene();
    if (dashOverlayGroupRef.current) {
      scene.remove(dashOverlayGroupRef.current);
      for (const child of dashOverlayGroupRef.current.children) {
        const line = child as THREE.Line;
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      dashOverlayGroupRef.current = null;
    }
    const oppositionLinks = data.links.filter((l) => edgeIsDashed(l.edgeType, l.category));
    if (oppositionLinks.length === 0) return;
    const group = new THREE.Group();
    for (const link of oppositionLinks) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const material = new THREE.LineDashedMaterial({
        color: linkColors.opposition,
        dashSize: 3,
        gapSize: 2.4,
        transparent: true,
        opacity: 0.85,
      });
      const line = new THREE.Line(geometry, material);
      line.userData = { sourceId: endpointId(link.source), targetId: endpointId(link.target) };
      group.add(line);
    }
    scene.add(group);
    dashOverlayGroupRef.current = group;
  }, [data.links, linkColors]);

  // Optional static reading-thread polyline (feature plan §2.4's rejected-
  // decoration list keeps this OPT-IN and non-animated): a single line
  // through the reading-sequence order, safe under reduced motion because it
  // never moves once drawn.
  const threadRef = useRef<THREE.Line | null>(null);
  useEffect(() => {
    const graph = fgRef.current;
    if (!graph) return;
    const scene = graph.scene();
    if (threadRef.current) {
      scene.remove(threadRef.current);
      threadRef.current = null;
    }
    if (layoutMode !== "roadmap" || !showReadingThread) return;
    const positions = assignStagePositions(data.nodes);
    const ordered = [...data.nodes]
      .filter((node) => node.roadmap != null)
      .sort((a, b) => a.roadmap!.sequence - b.roadmap!.sequence);
    if (ordered.length < 2) return;
    const points = ordered.flatMap((node) => {
      const pos = positions.get(node.id);
      return pos ? [new THREE.Vector3(pos.fx, pos.fy, pos.fz)] : [];
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.35 }));
    scene.add(line);
    threadRef.current = line;
  }, [layoutMode, showReadingThread, data.nodes]);

  return (
    // Graph P4: `data-graph-effects` now reports the ACTIVE PERFORMANCE
    // TIER ("full"/"reduced"/"minimal"/"bare") rather than a bare
    // active/paused flag — except the pre-existing "paused" value under
    // reduced motion/hidden-tab (`!motionAllowed`), kept EXACTLY as before
    // since `graph.spec.ts:351` and `roadmap-graph.spec.ts:235` assert that
    // literal string and this phase's own instructions require those specs
    // to keep passing unmodified.
    <div ref={containerRef} className={`${isFullscreen ? "h-full min-h-0" : "h-[60vh] min-h-[420px] max-h-[720px]"} w-full overflow-hidden rounded-lg border border-[var(--color-border)]`} data-graph-canvas data-graph-effects={!motionAllowed ? "paused" : graphEffects.tier}>
      {colors && typeColors && linkColors && labelColors && (
        <ForceGraph3D
          ref={fgRef as never}
          graphData={graphData}
          width={size.w}
          height={size.h}
          // Graph P3: the canvas's own dark "astronomical plate" backdrop
          // (globals.css `--color-graph-backdrop`) — a deliberately
          // different surface from the app card framing it, so bloom/
          // emissive-intensity encodings read against real dark luminance
          // rather than the app's bone-white/dark-mode background.
          backgroundColor={graphTokens?.backdrop ?? "#0d1420"}
          // CONTROLS: orbit locks the camera's up-vector, so drag-to-rotate
          // can never introduce free roll (the default 'trackball' control
          // allows the whole scene to tilt/spin off-axis) — still no
          // auto-rotation, still the existing Reset view/fitCameraToBbox.
          controlType="orbit"
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
            if (!highlightLinkIds) return linkColors[family];
            return highlightLinkIds.has(link.id) ? linkColors[family] : "rgba(120,110,90,0.08)";
          }}
          linkOpacity={0.5}
          linkWidth={linkWidth}
          linkCurvature={linkCurvature}
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
          // Phase 22.8: every node already carries a fixed fx/fy/fz in
          // roadmap mode (`assignStagePositions`, above) — the simulation
          // has nothing left to converge on, so it's skipped outright
          // rather than merely shortened. Explore-mode budgets bumped
          // (35->55, 80->130) — the looser FORCES config above (longer link
          // distance, stronger repulsion, a new collision force) needs a
          // few more ticks to actually settle into its final layout than
          // the old, tighter-clustered default did.
          cooldownTicks={layoutMode === "roadmap" ? 0 : data.nodes.length > 140 ? 55 : 130}
          showNavInfo={false}
          showPointerCursor={() => true}
          onNodeHover={(n: object | null) => setHoverNode(n as GraphNode | null)}
          onNodeClick={(n: object) => onNodeClick(n as GraphNode)}
          onLinkClick={(link: object) => onLinkClick?.(link as GraphLink)}
          onEngineStop={onEngineStop}
        />
      )}
    </div>
  );
}
