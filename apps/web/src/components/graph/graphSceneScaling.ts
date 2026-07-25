// Relative import, not the `@/*` alias: this module is invoked directly via
// bare `tsx` for its unit test (no Next.js/webpack path-alias resolution
// available there — see `graphSceneScaling.test.ts`'s own doc comment).
import { CATEGORY_META, type RelationshipCategory } from "../shared/annotationMeta";
import { edgeFamilyFor, edgeTypeLabel, isDirectedEdgeType, type EdgeFamily, type NodeType } from "./types";

/**
 * Phase 21.4/21.5 (D-21-3, D-21-4, D-21-9's UI half, and the direction-cue
 * gap): pure, deterministic camera-distance/edge-type decisions for the 3D
 * scene, kept OUT of `KnowledgeGraph3D.tsx` so they're unit-testable without
 * a WebGL context or a browser (`graphSceneScaling.test.ts`, run the same
 * bare-`tsx` way as `edgeTypeForRelationshipCategory.test.ts`).
 *
 * The component samples camera distance on a throttled interval (never a
 * per-frame/unthrottled `setState`) and applies the resulting factors by
 * MUTATING already-created Three.js objects' `.scale`/`.visible` — never by
 * feeding distance into `nodeThreeObject`/`linkThreeObject`'s own dependency
 * array, which would rebuild the whole scene on every sample (D-21-5's
 * caching lesson, applied preventively to the new distance-aware code too).
 *
 * The distance signal is ONE global camera-to-origin sample, not a
 * per-node/per-edge distance — a deliberate, restrained simplification
 * (matches this file's existing "no forced auto-rotation, no runaway
 * per-frame work" posture) rather than an O(nodes) per-tick calculation.
 */

/** Camera distance (world units) at which every factor below is exactly
 *  1 — matches the default reset camera position (`cameraPosition({ z: 260
 *  })` in `KnowledgeGraph3D.tsx`). */
export const REFERENCE_CAMERA_DISTANCE = 260;

const LABEL_SCALE_MIN = 0.55;
const LABEL_SCALE_MAX = 1.8;
const NODE_SCALE_MIN = 0.75;
const NODE_SCALE_MAX = 1.5;

/**
 * Below this camera distance, the secondary (type/state) label line hides
 * so the primary title keeps its space — the plan's "hide secondary label
 * text before shrinking the primary" requirement. Deliberately LESS than
 * the distance at which `LABEL_SCALE_MAX` saturates (`LABEL_SCALE_MAX *
 * REFERENCE_CAMERA_DISTANCE` = 468), so the secondary line hides WHILE the
 * primary label is still being helped by the compensation factor below, not
 * only after compensation has already given up and legibility is lost.
 */
export const SECONDARY_LABEL_HIDE_DISTANCE = 420;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface NodeSceneScale {
  /** Multiplier applied to the label sprites' own (string-length-derived)
   *  base scale — grows on zoom-in, clamped at a comfortable maximum. */
  labelScaleFactor: number;
  /** Multiplier applied to the node sphere mesh's base radius via
   *  `mesh.scale.setScalar(...)` — never by rebuilding `SphereGeometry`. */
  nodeScaleFactor: number;
  /** Whether the secondary (type/state) label line should render. */
  secondaryLabelVisible: boolean;
}

/**
 * `distance` non-finite or <= 0 (camera not ready yet, or a test harness
 * with no real WebGL camera) degrades to the reference/neutral scale rather
 * than producing `NaN`/negative scales.
 */
export function nodeScaleForDistance(distance: number): NodeSceneScale {
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : REFERENCE_CAMERA_DISTANCE;
  const raw = safeDistance / REFERENCE_CAMERA_DISTANCE;
  return {
    labelScaleFactor: clamp(raw, LABEL_SCALE_MIN, LABEL_SCALE_MAX),
    nodeScaleFactor: clamp(raw, NODE_SCALE_MIN, NODE_SCALE_MAX),
    secondaryLabelVisible: safeDistance < SECONDARY_LABEL_HIDE_DISTANCE,
  };
}

/**
 * On-scene edge labels use the restrained "hover/focus reveal" policy 21.5
 * allows (rather than always-on, which would clutter any graph with more
 * than a handful of edges): visible only when the edge is connected to the
 * currently highlighted node AND the camera is close enough for the label
 * to be legible/worth drawing at all — density- and zoom-aware at once,
 * never every edge's label rendered simultaneously.
 */
export function edgeLabelVisible(distance: number, isHighlighted: boolean): boolean {
  if (!isHighlighted) return false;
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : REFERENCE_CAMERA_DISTANCE;
  return safeDistance < SECONDARY_LABEL_HIDE_DISTANCE;
}

export interface SceneBbox {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export interface CameraFit {
  target: { x: number; y: number; z: number };
  distance: number;
}

/** Camera never sits closer than this, even for a single-node or
 *  zero-extent bounding box — avoids a degenerate near-zero/negative
 *  distance for a graph with (effectively) one point. */
const MIN_FIT_DISTANCE = 90;
/** Extra breathing room beyond the tight geometric fit, so a node's own
 *  label sprite (drawn just outside its sphere) isn't clipped right at the
 *  frame edge. */
const FIT_PADDING_FACTOR = 1.2;

/**
 * D-23-52 (owner report: Visualization "does not have the requested 3D
 * effects" / "impossible to navigate"): react-force-graph-3d ships its own
 * `zoomToFit`, but its internal distance formula
 * (`maxBoxSide / Math.atan(paddedFovDegrees * Math.PI / 180)`, in
 * three-render-objects' `fitToBbox`) is not a standard FOV-fit computation —
 * it feeds a small-angle quantity into `atan` where a `tan`-based
 * half-angle triangle is what actually frames a box, so it reliably
 * over-zooms (frames the graph ~2.5x farther away, and therefore smaller
 * and harder to read, than the FOV can actually support). This is the
 * geometrically correct replacement: a standard "fit a box within a
 * perspective camera's frustum" computation from the box's OWN measured
 * center/extents (as reported by `getGraphBbox()`, so it already reflects
 * real rendered geometry — spheres, label sprites, rings — not just raw
 * node coordinates), aiming the camera at the box's actual centroid rather
 * than always the world origin. Pure and unit-tested
 * (`graphSceneScaling.test.ts`) with plain numbers, no THREE/WebGL
 * involved — the caller (`KnowledgeGraph3D`) only reads the bbox and
 * applies the resulting `cameraPosition`.
 */
export function fitCameraToBbox(bbox: SceneBbox, aspect: number, fovDegrees = 50): CameraFit {
  const target = {
    x: (bbox.x[0] + bbox.x[1]) / 2,
    y: (bbox.y[0] + bbox.y[1]) / 2,
    z: (bbox.z[0] + bbox.z[1]) / 2,
  };
  const halfWidth = (bbox.x[1] - bbox.x[0]) / 2;
  const halfHeight = (bbox.y[1] - bbox.y[0]) / 2;
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const vFov = (fovDegrees * Math.PI) / 180 / 2;
  const hFov = Math.atan(Math.tan(vFov) * safeAspect);
  const distanceForHeight = halfHeight / Math.tan(vFov);
  const distanceForWidth = halfWidth / Math.tan(hFov);
  const distance = Math.max(distanceForHeight, distanceForWidth, 0) * FIT_PADDING_FACTOR;
  return { target, distance: Math.max(distance, MIN_FIT_DISTANCE) };
}

export type EdgeDirectionCue = "particles" | "arrow" | "none";

/**
 * Direction-cue gap (audit §5): directional particles are the animated cue
 * when motion is allowed; a static arrowhead (`linkDirectionalArrowLength`)
 * is the fallback the INSTANT particles are disabled (reduced motion, a
 * hidden tab, or a graph large enough to trip `effectsEnabled`'s >140-node
 * cutoff) — so direction is never illegible, and the two cues are never
 * drawn at once for the same edge. Genuinely symmetric relation types
 * (`isDirectedEdgeType() === false`, e.g. `is_comparable_to`/
 * `parallel_comparison`) get NEITHER cue: an arrow or a one-way particle
 * stream on a relation with no "which end does what" meaning would itself
 * be a false, invented directional claim the data doesn't support.
 */
export function edgeDirectionCue(edgeType: string, effectsEnabled: boolean): EdgeDirectionCue {
  if (!isDirectedEdgeType(edgeType)) return "none";
  return effectsEnabled ? "particles" : "arrow";
}

/**
 * D-21-9 (UI half): a short on-scene edge label reuses the shared
 * `CATEGORY_META` glyph+label whenever the edge's `category` maps to one of
 * the 10 relationship categories (see `apps/web/src/lib/graphEdgeCategory.ts`
 * for how citation/concept edges now get one at read time, per D-21-9's
 * server-side fix). Every edge that genuinely carries no category —
 * `discovered_source`, the `edition_relation` work-form/`${workRole}_of`
 * strings, `source_provenance` relations, `cross_library` judgments,
 * `outline_section` — falls back to the plain, honest human-readable
 * edge_type string instead of a fabricated category glyph.
 */
export function edgeRelationLabel(edgeType: string, category: string | null | undefined): string {
  const meta = category && Object.prototype.hasOwnProperty.call(CATEGORY_META, category)
    ? CATEGORY_META[category as RelationshipCategory]
    : undefined;
  return meta ? `${meta.glyph} ${meta.label}` : edgeTypeLabel(edgeType);
}

/**
 * Label-density fix (owner report: every node carries two always-visible
 * label sprites — ~200-400 pills at production scale, unreadable). A
 * node's PRIMARY (title) label is shown only for a few bounded, meaningful
 * signals — never unconditionally for every node in the scene.
 */
export interface NodeLabelVisibilityContext {
  selectedNodeId: string | null;
  hoverNodeId: string | null;
  nextUpNodeId: string | null;
  /** Selection-focus ∪ hover ∪ hover-neighbors (`KnowledgeGraph3D`'s own
   *  `highlightNodeIds`) — `null` means no highlight/focus is active at all. */
  highlightNodeIds: ReadonlySet<string> | null;
}

export function nodePrimaryLabelVisible(node: { id: string; type: NodeType }, ctx: NodeLabelVisibilityContext): boolean {
  if (node.type === "work") return true;
  if (ctx.selectedNodeId === node.id) return true;
  if (ctx.nextUpNodeId === node.id) return true;
  if (ctx.highlightNodeIds?.has(node.id)) return true;
  return false;
}

/**
 * The SECONDARY (type/state) label line is reserved for the one or two
 * nodes actually being inspected right now — selected or hovered — a
 * strictly narrower set than `nodePrimaryLabelVisible` allows (never the
 * wider highlighted/neighbor/work-type set).
 */
export function nodeSecondaryLabelVisible(
  node: { id: string },
  ctx: Pick<NodeLabelVisibilityContext, "selectedNodeId" | "hoverNodeId">,
): boolean {
  return ctx.selectedNodeId === node.id || ctx.hoverNodeId === node.id;
}

/**
 * Roadmap layout mode (Phase 22.8) uses a fixed stage-column grid with far
 * more empty space between nodes than explore mode's naturally clustered
 * force layout, so its nodes read as comfortably bigger — an ADDITIONAL
 * multiplier on top of the zoom-driven `nodeScaleFactor`, applied by
 * `applyNodeAccents`'s mutation pass (never by rebuilding node geometry).
 */
export function nodeSizeFactorForLayout(layoutMode: "roadmap" | "explore"): number {
  return layoutMode === "roadmap" ? 2 : 1;
}

/**
 * SCREEN-SPACE LABELS: with `SpriteMaterial.sizeAttenuation` set to
 * `false`, a sprite's apparent on-screen size no longer shrinks with camera
 * distance — but its `scale` must still be set to a specific value that
 * resolves to the desired pixel height once three.js's own attenuation-
 * cancelling shader math (`scale *= -mvPosition.z` for a perspective
 * camera) runs. Standard perspective-camera geometry: the NDC-space half-
 * height a `scale.y` world value produces is `scale.y / (2 * tan(vFov/2))`
 * once distance cancels out; solving for the `scale.y` that yields a given
 * PIXEL height on a viewport of `viewportHeightPx` gives the formula below.
 * Pure and unit-tested so the pixel target is verifiable without a WebGL
 * context.
 */
export function screenSpaceLabelScale(pixelHeight: number, fovDegrees: number, viewportHeightPx: number): number {
  const safeViewport = Number.isFinite(viewportHeightPx) && viewportHeightPx > 0 ? viewportHeightPx : 1;
  const safeFov = Number.isFinite(fovDegrees) && fovDegrees > 0 ? fovDegrees : 50;
  const vFov = (safeFov * Math.PI) / 180 / 2;
  return (2 * pixelHeight * Math.tan(vFov)) / safeViewport;
}

// ---------------------------------------------------------------------------
// Graph P3 (scene redesign core): pure, unit-tested decisions for the new
// node/link visual language, kept out of `KnowledgeGraph3D.tsx` for the same
// reason as everything else in this file — WebGL internals aren't
// E2E-assertable, so the DECISION a mesh mutation applies lives here as a
// plain function of data, proven by `graphSceneScaling.test.ts`.
// ---------------------------------------------------------------------------

/** Authority band (A best .. E worst) -> halo emissive intensity. A node
 *  with neither an authority band nor a raw credibility score has never been
 *  assessed at all — returns 0 (no halo), never a fabricated baseline glow,
 *  matching the contract's "absent means no data" rule for credibility. */
const AUTHORITY_INTENSITY: Record<string, number> = { A: 1, B: 0.75, C: 0.5, D: 0.3, E: 0.15 };

export function authorityEmissiveIntensity(authority: string | null | undefined, credibilityScore: number | null | undefined): number {
  if (authority && Object.prototype.hasOwnProperty.call(AUTHORITY_INTENSITY, authority)) return AUTHORITY_INTENSITY[authority];
  if (credibilityScore != null && Number.isFinite(credibilityScore)) return 0.15 + Math.max(0, Math.min(1, credibilityScore)) * 0.85;
  return 0;
}

/** 0-4 lit segments on the credibility ring — `null`/absent stays 0 (an
 *  unlit ring), never a fabricated middling band for a node nobody has
 *  actually assessed. A present score always lights at least 1 segment
 *  (even a low score is a real assessment, distinct from "no data"). */
export function credibilitySegmentCount(score: number | null | undefined): number {
  if (score == null || !Number.isFinite(score)) return 0;
  return Math.max(1, Math.min(4, Math.ceil(Math.max(0, Math.min(1, score)) * 4)));
}

/** Curvature per edge family (plan's link-language table): structural edges
 *  (a work's own outline, editions/translations of itself) stay perfectly
 *  straight; reference/influence/prerequisite bow increasingly; opposition
 *  bows the most AND renders dashed (`edgeIsDashed` below) so a disagreement
 *  reads as visually distinct from every other relation, not just a
 *  different curve amount. Prerequisite curves the OPPOSITE direction
 *  (negative) so a prerequisite chain doesn't visually blend with a
 *  same-signed reference/influence bow running the other way through a
 *  dense scene. */
const EDGE_FAMILY_CURVATURE: Record<EdgeFamily, number> = {
  structural: 0,
  reference: 0.12,
  influence: 0.2,
  prerequisite: -0.2,
  opposition: 0.3,
};

export function edgeCurvature(edgeType: string, category?: string | null): number {
  return EDGE_FAMILY_CURVATURE[edgeFamilyFor(edgeType, category)];
}

export function edgeIsDashed(edgeType: string, category?: string | null): boolean {
  return edgeFamilyFor(edgeType, category) === "opposition";
}

/** Directional-particle COUNT scales with the edge's own confidence
 *  (1 low .. 3 high) — a separate decision from `edgeDirectionCue`'s
 *  particles-vs-arrow-vs-none choice above (which governs WHETHER a moving
 *  cue is used at all); this only governs how many particles ride it once
 *  particles are the chosen cue. Confidence is stored 0-1 (`GraphLink.confidence`). */
export function particleCountForConfidence(confidence: number): number {
  const safe = Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
  return Math.max(1, Math.min(3, Math.round(safe * 3)));
}

/** Reader-level orbital beads (1-4, one per `READER_LEVELS` value the node's
 *  role data applies at) are a CLOSE-distance-only accent — legible detail
 *  that would just be visual noise once the camera pulls back far enough
 *  that the node itself is barely more than a labeled dot. Deliberately
 *  tighter than `SECONDARY_LABEL_HIDE_DISTANCE`: the secondary text line is
 *  still readable at that distance, but four tiny orbiting spheres are not. */
export const READER_LEVEL_BEAD_VISIBLE_DISTANCE = 200;

export function readerLevelBeadsVisible(distance: number): boolean {
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : REFERENCE_CAMERA_DISTANCE;
  return safeDistance < READER_LEVEL_BEAD_VISIBLE_DISTANCE;
}
