/**
 * Node/edge visual-language constants and pure mapping helpers for
 * Prototype B (charter §10 "Exact 3D scene specification").
 *
 * Node silhouettes: the charter's entity table (§10) lists 9 named entity
 * groups but only 6 *distinct base shapes* — sphere is reused (with
 * different color/ring accents) for "Uploaded work", "Cited/reference
 * work", "Peer-reviewed source", and "Online source". This module treats
 * those 6 shapes (sphere, icosahedron, capsule, slab, octahedron, hex
 * prism) as the "six base silhouettes" the charter caps InstancedMesh
 * count at (§13, "InstancedMesh per repeated silhouette (six max)").
 * Rings/bands/wireframe-outline are accent decorations layered on top via
 * a small number of additional lightweight InstancedMesh objects (torus
 * rings, a wireframe outline mesh) — not new entity silhouettes.
 *
 * The fixture's `DisplayKind` union (src/fixtures/types.ts) has 18 values,
 * three of which (`learning_step`, `writing_project`, `aggregate`) are not
 * named in the charter's entity table at all. Per charter §10's edge-
 * mapping instruction to "audit the actual emitted values and add any
 * current value omitted above before implementation" (stated for edges,
 * applied here by the same spirit for nodes): these three are mapped to
 * the "slab" silhouette with a muted, lower-saturation neutral color,
 * matching charter §10's general state rule for a "Structural/display-only
 * node: lower-saturation material and explicit label" — a documented
 * interpretive extension, not a silent default.
 */

export type SilhouetteKey = "sphere" | "icosahedron" | "capsule" | "slab" | "octahedron" | "hexPrism";

export type RingAccent = "gold" | "greenDouble" | "umberSingle" | "burgundyOrbital";

import type { DisplayEdgeFamily, DisplayKind } from "../../fixtures/types";

export interface KindVisual {
  silhouette: SilhouetteKey;
  colorHex: number;
  ring?: RingAccent;
  /** Charter §10: "Structural/display-only node: lower-saturation material
   * and explicit label." */
  structuralDisplayOnly?: boolean;
}

const IVORY = 0xfdf8ee;
const GOLD = 0xf0c47c;
const ROSE = 0xc99b9b;
const GREEN = 0x8fc4a8;
const UMBER = 0xd3ab86;
const SLATE = 0xa7b6c2;
const BLUE = 0x8db3c4;
const BURGUNDY = 0xe0a3ac;
const NEUTRAL = 0x718096;

export const RING_COLORS: Record<RingAccent, number> = {
  gold: GOLD,
  greenDouble: GREEN,
  umberSingle: UMBER,
  burgundyOrbital: BURGUNDY,
};

/** Charter §10 node geometry/color table, extended per the doc comment
 * above for the three fixture-only display kinds. */
export const KIND_VISUALS: Record<DisplayKind, KindVisual> = {
  work: { silhouette: "sphere", colorHex: IVORY, ring: "gold" },
  reference: { silhouette: "sphere", colorHex: ROSE },
  peer_reviewed_source: { silhouette: "sphere", colorHex: GREEN, ring: "greenDouble" },
  online_source: { silhouette: "sphere", colorHex: UMBER, ring: "umberSingle" },
  concept: { silhouette: "icosahedron", colorHex: GREEN },
  person: { silhouette: "capsule", colorHex: UMBER },
  section: { silhouette: "slab", colorHex: SLATE },
  passage: { silhouette: "slab", colorHex: IVORY },
  evidence: { silhouette: "slab", colorHex: IVORY },
  claim: { silhouette: "octahedron", colorHex: BLUE },
  debate: { silhouette: "hexPrism", colorHex: BURGUNDY, ring: "burgundyOrbital" },
  question: { silhouette: "hexPrism", colorHex: BURGUNDY, ring: "burgundyOrbital" },
  position: { silhouette: "hexPrism", colorHex: BURGUNDY, ring: "burgundyOrbital" },
  hypothesis: { silhouette: "hexPrism", colorHex: BURGUNDY, ring: "burgundyOrbital" },
  gap: { silhouette: "hexPrism", colorHex: BURGUNDY, ring: "burgundyOrbital" },
  learning_step: { silhouette: "slab", colorHex: NEUTRAL, structuralDisplayOnly: true },
  writing_project: { silhouette: "slab", colorHex: NEUTRAL, structuralDisplayOnly: true },
  aggregate: { silhouette: "slab", colorHex: NEUTRAL, structuralDisplayOnly: true },
};

export const SILHOUETTE_KEYS: readonly SilhouetteKey[] = [
  "sphere",
  "icosahedron",
  "capsule",
  "slab",
  "octahedron",
  "hexPrism",
];

export interface EdgeFamilyVisual {
  colorHex: number;
  /** Relative screen-space width hierarchy only (charter §10: "target
   * screen-space hierarchy, not a requirement to build expensive per-edge
   * cylinders"). Applied as a `LineBasicMaterial.linewidth` best-effort
   * hint (most browsers ignore linewidth > 1 on core WebGL lines; it is
   * still set honestly rather than silently dropped). */
  widthHint: number;
  directedArrow: boolean;
  dash: null | { size: number; gap: number };
}

/** Charter §10 edge grammar table. Dash/gap values are in world units,
 * scaled at draw time; exact ratios (6/4, dot-dash) approximated with
 * `LineDashedMaterial`'s single dashSize/gapSize pair per family. */
export const EDGE_FAMILY_VISUALS: Record<DisplayEdgeFamily, EdgeFamilyVisual> = {
  reference: { colorHex: 0xa9b3bc, widthHint: 0.7, directedArrow: false, dash: null },
  prerequisite: { colorHex: 0xf0c47c, widthHint: 1.4, directedArrow: true, dash: null },
  influence: { colorHex: 0x8fc4a8, widthHint: 1.2, directedArrow: false, dash: null },
  opposition: { colorHex: 0xe0a3ac, widthHint: 1.4, directedArrow: false, dash: { size: 6, gap: 4 } },
  qualification: { colorHex: 0xd3ab86, widthHint: 1.1, directedArrow: false, dash: { size: 3, gap: 1.5 } },
  structural: { colorHex: 0x718096, widthHint: 0.8, directedArrow: false, dash: { size: 1, gap: 2 } },
};

export const BACKGROUND_HEX = 0x0b1020;

/** Charter §10 edge opacity states. */
export const EDGE_OPACITY_DEFAULT = 0.25;
export const EDGE_OPACITY_SELECTED_PATH = 0.85;
export const EDGE_OPACITY_DIMMED = 0.12;

function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/**
 * Simulates a per-vertex "opacity" against a known solid background by
 * linearly blending the true color toward the background color — used so
 * each family's single batched `LineSegments` can still vary apparent
 * opacity per edge (via vertex-color updates) without per-edge draw calls,
 * true alpha blending, or a remount (charter §14: "No renderer remount for
 * selection ... or ordinary filter changes").
 */
export function blendTowardBackground(colorHex: number, opacity: number, backgroundHex: number = BACKGROUND_HEX): [number, number, number] {
  const [r, g, b] = hexToRgb(colorHex);
  const [br, bg, bb] = hexToRgb(backgroundHex);
  const o = Math.max(0, Math.min(1, opacity));
  return [r * o + br * (1 - o), g * o + bg * (1 - o), b * o + bb * (1 - o)];
}

// ---------------------------------------------------------------------
// Sizing (charter §10's bounded importance formula)
// ---------------------------------------------------------------------

export const NODE_SCALE_MIN = 0.8;
export const NODE_SCALE_MAX = 1.6;
export const ROOT_SCALE = 1.5;

export interface SizingInput {
  degree: number;
  isRoot: boolean;
  isAggregate: boolean;
  p95VisibleDegree: number;
}

/**
 * Charter §10:
 *   degreeComponent = sqrt(min(visibleDegree, p95VisibleDegree) / max(1, p95VisibleDegree))
 *   scale = 0.9 + 0.35 × degreeComponent, +0.05 for aggregate-summary node
 *   clamp 0.8–1.6; root is exactly 1.5.
 *
 * The charter's other stated addend — "+0.15 for a direct evidence-
 * anchored claim/evidence neighbor of the root" — is deliberately NOT
 * applied here: the bakeoff fixture contract (src/fixtures/types.ts) does
 * not carry an "evidence-anchored" flag, and fabricating one would violate
 * the bakeoff's no-fabricated-measurement discipline. This omission is
 * recorded, not silently absorbed into the base formula.
 */
export function computeNodeScale(input: SizingInput): number {
  if (input.isRoot) return ROOT_SCALE;
  const p95 = Math.max(1, input.p95VisibleDegree);
  const degreeComponent = Math.sqrt(Math.min(input.degree, p95) / p95);
  let scale = 0.9 + 0.35 * degreeComponent;
  if (input.isAggregate) scale += 0.05;
  return Math.max(NODE_SCALE_MIN, Math.min(NODE_SCALE_MAX, scale));
}

/** Nearest-rank p95 of a degree array; 0 for an empty array. */
export function p95Of(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(rank, sorted.length - 1))];
}
