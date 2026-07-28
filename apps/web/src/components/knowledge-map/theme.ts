/**
 * Knowledge Map visual constants — charter §10 ("Exact 3D scene
 * specification"). Every color/geometry rule here is taken directly from
 * the charter's tables, not invented; where the charter leaves a genuine
 * gap (the credibility segmented ring's per-segment palette, the
 * lower-saturation treatment for structural/display-only nodes, the
 * reading-state progress arc), the choice is a documented judgment call,
 * called out inline rather than left implicit.
 *
 * Ported from `prototypes/graph-bakeoff/src/protoA/theme.ts` per spec
 * §1.1, re-keyed from the bakeoff's standalone `DisplayKind` union to the
 * real `DisplayKind<NodeType>` (`@ice/graph-display` generic instantiated
 * against `../graph/types`'s `NodeType`), and extended with the
 * charter §10 treatments the bakeoff itself did not need to model
 * (credibility ring, reading-state arc, structural/display-only
 * desaturation) — see this step's report for the full list of what's new
 * here vs. what's a direct port.
 */
import type { DisplayEdgeFamily, DisplayKind, Layer } from "@ice/graph-display";
import { LAYER_ORDER } from "@ice/graph-display";
import type { NodeType } from "../graph/types";

export const BACKDROP_COLOR = "#0B1020";
export const GRID_COLOR = "#263A4F";
export const GRID_OPACITY = 0.08; // charter: "no more than 8% opacity"

export const PALETTE = {
  ivory: "#FDF8EE",
  gold: "#F0C47C",
  rose: "#C99B9B",
  green: "#8FC4A8",
  umber: "#D3AB86",
  slate: "#A7B6C2",
  blue: "#8DB3C4",
  burgundy: "#E0A3AC",
} as const;

/**
 * Layer-reference planes/legend (charter §8: "Provide restrained
 * layer-reference labels or planes at no more than 6% opacity when the
 * layer guide is enabled. They must make the band structure legible
 * without becoming decorative scenery"). Off by default — a toolbar
 * secondary-menu toggle (`KnowledgeMapToolbar.tsx`'s "More" menu), never
 * shown automatically.
 */
export const LAYER_GUIDE_OPACITY = 0.06; // charter: "no more than 6% opacity"
/** A neutral reference tone (the same slate used for structural/display-only
 *  desaturation below), deliberately never a kind/edge color, so the guide
 *  never reads as "another data layer" of its own. */
export const LAYER_GUIDE_PLANE_COLOR = PALETTE.slate;

/** Stable, ordered reading of the six charter §8 band names — reused by
 *  both the 3D reference planes and the on-screen legend so the two never
 *  drift out of sync with each other. */
export const LAYER_LABEL: Readonly<Record<Layer, string>> = {
  evidence: "Evidence",
  intellectual: "Intellectual",
  claim: "Claims",
  debate: "Debates",
  learning: "Learning",
  research: "Research",
};

export const LAYER_GUIDE_ORDER: readonly Layer[] = LAYER_ORDER;

/**
 * At most six base silhouettes (charter §10). Every `DisplayKind` maps to
 * exactly one of these; color/material/accessory geometry differentiate
 * within a silhouette.
 */
export type Silhouette = "sphere" | "icosahedron" | "capsule" | "slab" | "octahedron" | "hexPrism";

export interface KindVisual {
  silhouette: Silhouette;
  /** Base color for the node's primary mesh. */
  color: string;
  /** Relative radius multiplier vs. the shared base unit (e.g. the smaller
   * hollow reference sphere per charter §10). */
  relativeRadius: number;
  /** Accessory decoration required by the charter's table, if any. */
  accessory?: "equatorial-ring" | "double-band" | "single-band" | "orbital-ring";
  accessoryColor?: string;
  /** Reference work default rendering is a hollow/wireframe shell. */
  wireframeByDefault?: boolean;
  /** True for the `DisplayKind` values the charter's §10 node-geometry
   * table doesn't name a row for directly — the additive display-only
   * kinds `@ice/graph-display` defines beyond the canonical `NodeType` set
   * (`learning_step`/`writing_project`/`aggregate`, none of which the
   * charter's own table lists explicitly). Each reuses the nearest
   * existing silhouette/family rather than inventing a 7th shape, and is
   * called out here rather than silently folded in. */
  isExtension?: boolean;
}

/**
 * Every `DisplayKind<NodeType>` value — the 9 canonical `NodeType`s plus
 * the 9 additive `DisplayOnlyKind`s `@ice/graph-display/kinds.ts` defines —
 * maps to exactly one visual. `theme.test.ts` proves this table is total
 * over both unions (charter §10's own "every current node type/state has a
 * visual mapping" requirement).
 */
export const KIND_VISUALS: Record<DisplayKind<NodeType>, KindVisual> = {
  work: { silhouette: "sphere", color: PALETTE.ivory, relativeRadius: 1, accessory: "equatorial-ring", accessoryColor: PALETTE.gold },
  reference: { silhouette: "sphere", color: PALETTE.rose, relativeRadius: 0.72, wireframeByDefault: false },
  peer_reviewed_source: { silhouette: "sphere", color: PALETTE.green, relativeRadius: 0.9, accessory: "double-band", accessoryColor: PALETTE.green },
  online_source: { silhouette: "sphere", color: PALETTE.umber, relativeRadius: 0.9, accessory: "single-band", accessoryColor: PALETTE.umber },
  concept: { silhouette: "icosahedron", color: PALETTE.green, relativeRadius: 1 },
  person: { silhouette: "capsule", color: PALETTE.umber, relativeRadius: 1 },
  section: { silhouette: "slab", color: PALETTE.ivory, relativeRadius: 0.85 },
  passage: { silhouette: "slab", color: PALETTE.ivory, relativeRadius: 0.85 },
  evidence: { silhouette: "slab", color: PALETTE.slate, relativeRadius: 0.85 },
  claim: { silhouette: "octahedron", color: PALETTE.blue, relativeRadius: 1 },
  debate: { silhouette: "hexPrism", color: PALETTE.burgundy, relativeRadius: 1, accessory: "orbital-ring", accessoryColor: PALETTE.burgundy },
  question: { silhouette: "hexPrism", color: PALETTE.burgundy, relativeRadius: 1, accessory: "orbital-ring", accessoryColor: PALETTE.burgundy },
  position: { silhouette: "hexPrism", color: PALETTE.burgundy, relativeRadius: 1, accessory: "orbital-ring", accessoryColor: PALETTE.burgundy },
  hypothesis: { silhouette: "hexPrism", color: PALETTE.burgundy, relativeRadius: 1, accessory: "orbital-ring", accessoryColor: PALETTE.burgundy },
  gap: { silhouette: "hexPrism", color: PALETTE.burgundy, relativeRadius: 1, accessory: "orbital-ring", accessoryColor: PALETTE.burgundy },
  // --- Extensions beyond the charter's explicit table (see doc comment) ---
  learning_step: { silhouette: "hexPrism", color: PALETTE.burgundy, relativeRadius: 0.8, isExtension: true },
  writing_project: { silhouette: "slab", color: PALETTE.ivory, relativeRadius: 0.85, isExtension: true },
  aggregate: { silhouette: "slab", color: PALETTE.slate, relativeRadius: 0.85, isExtension: true },
};

export interface EdgeVisual {
  color: string;
  /** Screen-space hierarchy target only (charter §10) — not literally the
   * WebGL line width, which most browsers clamp to ~1px regardless. */
  widthPx: number;
  arrow: boolean;
}

/**
 * Charter §10 edge-grammar table. Exact dash/dot-dash patterns are a
 * documented gap here (same tradeoff Prototype A made in the bakeoff, per
 * the charter's own carve-out: "where the chosen renderer cannot provide
 * portable subpixel patterns without violating the performance gate,
 * preserve the distinction through color, opacity, endpoint glyph,
 * legend, and accessible label" — `react-force-graph-3d`'s per-link
 * rendering doesn't expose a per-family dash pattern cleanly, so the
 * distinction is preserved via color/opacity/arrow/legend/accessible-text
 * here, exactly as the charter allows).
 */
export const EDGE_VISUALS: Record<DisplayEdgeFamily, EdgeVisual> = {
  reference: { color: "#A9B3BC", widthPx: 0.7, arrow: false },
  prerequisite: { color: "#F0C47C", widthPx: 1.4, arrow: true },
  influence: { color: "#8FC4A8", widthPx: 1.2, arrow: false },
  opposition: { color: "#E0A3AC", widthPx: 1.4, arrow: false },
  qualification: { color: "#D3AB86", widthPx: 1.1, arrow: false },
  structural: { color: "#718096", widthPx: 0.8, arrow: false },
};

export const DEFAULT_LINK_OPACITY = 0.25;
export const SELECTED_NEIGHBORHOOD_LINK_OPACITY = 0.85;
export const UNRELATED_WHILE_SELECTED_LINK_OPACITY = 0.12;

export const UNAVAILABLE_WIREFRAME_COLOR = PALETTE.rose;

// ---------------------------------------------------------------------
// New for the production scene (not present in the bakeoff — charter §10
// "State"/"Credibility" rows the bakeoff didn't need to model since its
// fixtures carried no reading-state/credibility data).
// ---------------------------------------------------------------------

/** Selection ring colors — bone inner + gold outer (charter §10 "Selection:
 *  static bone inner ring plus gold outer ring"). Same values the bakeoff
 *  already used inline in `nodeVisuals.ts`; named here so theme.ts stays
 *  the single place every node-visual color is looked up. */
export const SELECTION_INNER_RING_COLOR = PALETTE.ivory;
export const SELECTION_OUTER_RING_COLOR = PALETTE.gold;
/** Hover/focus: "one thin bone ring" (charter §10). */
export const HOVER_RING_COLOR = PALETTE.ivory;

/**
 * Reading-state progress arc (charter §10 "Reading state: a small lower
 * progress arc"). Judgment call, recorded here: the canonical `GraphNode`
 * contract carries a `reading` STATE (an enum value) but no numeric
 * reading-percentage field for works/references — only `masteryScore`
 * (concept/person mastery, 0-100) exists, and that is a different fact
 * (understanding, not progress-through-the-text). Rather than inventing a
 * percentage the data doesn't support, the arc is a fixed, non-proportional
 * "currently reading" indicator — present or absent, not partially filled
 * — shown whenever a node's canonical state is `"reading"`. If a future
 * step adds real chapter/section-level progress to the graph contract,
 * this arc can become proportional without any change to where it's drawn.
 */
export const READING_STATE_ARC_COLOR = PALETTE.gold;
export const READING_STATE_ARC_SWEEP_DEG = 90; // a fixed quarter-turn arc, not proportional (see doc comment)

/**
 * Credibility segmented ring (charter §10 "Show the six separate
 * credibility dimensions as a segmented ring only for selection/close
 * focus and in the inspector... Missing credibility data is 'not
 * assessed,' never zero"). The charter specifies WHEN this ring shows and
 * WHAT it must never claim (never a single collapsed score, never zero for
 * missing data) but not its exact palette — this is a documented judgment
 * call: six equal arc segments, one per `CREDIBILITY_DIMENSIONS`
 * (`../graph/types`), lit at a brightness proportional to that
 * dimension's own 0-1 score when known, and rendered as a distinct,
 * visibly-unlit neutral segment (never simply omitted, and never
 * indistinguishable from "confirmed zero") when that dimension has no
 * assessment at all.
 */
export const CREDIBILITY_RING_SEGMENT_COUNT = 6;
export const CREDIBILITY_RING_LIT_COLOR = PALETTE.gold;
export const CREDIBILITY_RING_NOT_ASSESSED_COLOR = "#3A4658"; // a muted, clearly-inert slate — never the same as "zero" (burgundy/critical)

/**
 * Structural/display-only lower-saturation treatment (charter §10 "State:
 * Structural/display-only node: lower-saturation material and explicit
 * label"). Judgment call, recorded here: applies to a node whose
 * `sourceEntity` is `null` (no single real backing row — an aggregate
 * summary, or any future no-backing-row synthesized kind) OR whose
 * `displayKind` is the canonical `"section"` kind (the one canonical
 * `NodeType` the existing contract's own `STATE_META` already labels
 * "Section" under the `structural` `NodeState` — `../graph/types.ts`).
 * `desaturate()` blends a hex color toward this palette's own neutral
 * slate rather than toward pure grey, so the desaturated treatment still
 * reads as part of the same "scholarly atlas" palette instead of looking
 * like a rendering error.
 */
const DESATURATION_TARGET = PALETTE.slate;
const DESATURATION_AMOUNT = 0.55; // 0 = original color, 1 = fully DESATURATION_TARGET

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

/** Blends `hex` toward `DESATURATION_TARGET` by `DESATURATION_AMOUNT` —
 *  used for the structural/display-only node treatment above. Pure,
 *  deterministic, and independently unit-tested (`theme.test.ts`). */
export function desaturate(hex: string): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(DESATURATION_TARGET);
  const t = DESATURATION_AMOUNT;
  return rgbToHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

/** Whether a node gets the structural/display-only lower-saturation
 *  treatment — see the doc comment above `DESATURATION_TARGET` for the
 *  exact rule and its rationale. */
export function isStructuralOrDisplayOnly(node: { displayKind: DisplayKind<NodeType>; sourceEntity: unknown }): boolean {
  return node.sourceEntity === null || node.displayKind === "section";
}
