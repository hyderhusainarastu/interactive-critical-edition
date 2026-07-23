// Relative import, not the `@/*` alias: this module is invoked directly via
// bare `tsx` for its unit test (no Next.js/webpack path-alias resolution
// available there — see `graphSceneScaling.test.ts`'s own doc comment).
import { CATEGORY_META, type RelationshipCategory } from "../shared/annotationMeta";
import { edgeTypeLabel, isDirectedEdgeType } from "./types";

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
