/**
 * Prototype A (clean `react-force-graph-3d`) visual constants — charter §10
 * ("Exact 3D scene specification"). Every color/geometry rule here is taken
 * directly from the charter's tables, not invented. Kept in one file so the
 * mapping from charter prose to code is auditable at a glance.
 */
import type { DisplayEdgeFamily, DisplayKind } from "../fixtures/types";

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
  /** True for the extensions this bakeoff's `DisplayKind` union needs beyond
   * the charter's explicit table (learning_step/writing_project/aggregate) —
   * each reuses the nearest existing silhouette/family rather than inventing
   * a 7th shape, and is called out here rather than silently folded in. */
  isExtension?: boolean;
}

/**
 * Charter §10 node-geometry table, plus three documented extensions for
 * `DisplayKind` values the charter's table doesn't explicitly name
 * (`learning_step`, `writing_project`, `aggregate`) — the fixture generator
 * (charter §13) emits all of these, so the renderer must handle them without
 * silently defaulting or crashing. Each extension reuses one of the six
 * silhouettes and is documented at the call site.
 */
export const KIND_VISUALS: Record<DisplayKind, KindVisual> = {
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

/** Charter §10 edge-grammar table. Exact dash/dot-dash patterns are the one
 * documented gap for this prototype (see GraphScene.tsx's top comment) — the
 * charter explicitly permits preserving the distinction via color/opacity
 * instead where "the chosen renderer cannot provide portable subpixel
 * patterns without violating the performance gate". */
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
