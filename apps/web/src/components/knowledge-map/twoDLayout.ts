/**
 * Pure, deterministic layer-column 2D projection (charter §10 "2D and
 * List"; spec §1.1's `KnowledgeMap2DView.tsx` row). Column = the node's
 * layer's index in `LAYER_ORDER` — the SAME six-band ordering the 3D
 * scene's Z-depth bands use (`bands.ts`), so the 2D view agrees with the 3D
 * scene about what's "near" (evidence) vs. "far" (research) rather than
 * inventing a second, disagreeing notion of depth. Row = a stable index
 * within that layer's column, derived purely from label+id so the same
 * node set always produces the same layout across renders/remounts
 * (charter §14's "deterministic layout seed" requirement, extended here to
 * the 2D projection the same way `layout.ts`'s golden-angle seed satisfies
 * it for the 3D scene).
 */
import { LAYER_ORDER, type Layer } from "@ice/graph-display";
import type { KnowledgeMapDisplayNode } from "./adapter";

export interface TwoDPosition {
  x: number;
  y: number;
}

export const LAYER_COLUMN_GAP = 220;
export const ROW_GAP = 64;
export const COLUMN_TOP_PADDING = 40;

export function computeLayerColumnPositions(nodes: readonly KnowledgeMapDisplayNode[]): Map<string, TwoDPosition> {
  const byLayer = new Map<Layer, KnowledgeMapDisplayNode[]>();
  for (const node of nodes) {
    const list = byLayer.get(node.layer) ?? [];
    list.push(node);
    byLayer.set(node.layer, list);
  }

  const positions = new Map<string, TwoDPosition>();
  LAYER_ORDER.forEach((layer, columnIndex) => {
    const list = (byLayer.get(layer) ?? [])
      .slice()
      .sort((a, b) => a.label.localeCompare(b.label) || String(a.id).localeCompare(String(b.id)));
    list.forEach((node, rowIndex) => {
      positions.set(String(node.id), {
        x: columnIndex * LAYER_COLUMN_GAP,
        y: COLUMN_TOP_PADDING + rowIndex * ROW_GAP,
      });
    });
  });
  return positions;
}

/** The bounding extent of a position map, padded — used to size the SVG
 *  `viewBox` so every node/label fits without clipping. Returns a minimum
 *  1x1-column extent for an empty map rather than a degenerate 0-size box. */
export function computePositionExtent(positions: ReadonlyMap<string, TwoDPosition>): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;
  for (const pos of positions.values()) {
    if (pos.x > maxX) maxX = pos.x;
    if (pos.y > maxY) maxY = pos.y;
  }
  const padding = 120;
  return { width: maxX + LAYER_COLUMN_GAP + padding, height: maxY + ROW_GAP + padding };
}
