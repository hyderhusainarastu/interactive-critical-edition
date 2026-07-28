import { TIER_ORDER, type PriorityTier } from "@ice/roadmap";

/**
 * Pure, no-DOM layout for the 2D stage-column Roadmap visualization (Stage 4
 * read spec §6.3/§6.5) — mirrors the existing
 * `apps/web/src/components/graph/roadmapLayout.ts` precedent for the 3D
 * graph's own "Roadmap" layout mode: every geometry decision lives here as
 * a plain function, unit-tested without React/DOM/Canvas.
 *
 * The DAG is column = tier, edge = root -> item (spec §6.2: no
 * item-to-item edges exist in the data, and inventing them would
 * misrepresent a priority/dependency-*tier* assignment as a fully reasoned
 * prerequisite graph, which this dataset does not contain). Root work is a
 * fixed node at column 0; every populated tier becomes one column, in
 * `TIER_ORDER`'s existing dependency-priority order (essential first);
 * within a column, items stack top-to-bottom by their given order (the
 * caller's own sequence — this function does not re-sort).
 */

export interface RoadmapStageLayoutItem {
  bibId: string;
  tier: PriorityTier;
}

export interface RoadmapStageNodePosition {
  bibId: string;
  tier: PriorityTier;
  /** 0 is the root's own column; 1..N are the populated tiers in
   *  `TIER_ORDER` order. */
  column: number;
  /** 0-based position within its column. */
  row: number;
  x: number;
  y: number;
}

export interface RoadmapStageLayoutResult {
  root: { x: number; y: number };
  nodes: RoadmapStageNodePosition[];
  /** Populated tiers only, in `TIER_ORDER` order — an empty tier gets no
   *  column at all (spec §6.3's "simple flow layout", not a fixed 7-column
   *  grid with empty columns). */
  columns: PriorityTier[];
  width: number;
  height: number;
}

export interface RoadmapStageLayoutOptions {
  columnWidth?: number;
  rowHeight?: number;
  paddingX?: number;
  paddingY?: number;
}

const DEFAULT_COLUMN_WIDTH = 220;
const DEFAULT_ROW_HEIGHT = 56;
const DEFAULT_PADDING_X = 24;
const DEFAULT_PADDING_Y = 24;

export function layoutRoadmapStageColumns(
  items: RoadmapStageLayoutItem[],
  options: RoadmapStageLayoutOptions = {},
): RoadmapStageLayoutResult {
  const columnWidth = options.columnWidth ?? DEFAULT_COLUMN_WIDTH;
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const paddingX = options.paddingX ?? DEFAULT_PADDING_X;
  const paddingY = options.paddingY ?? DEFAULT_PADDING_Y;

  const byTier = new Map<PriorityTier, RoadmapStageLayoutItem[]>();
  for (const item of items) {
    const list = byTier.get(item.tier) ?? [];
    list.push(item);
    byTier.set(item.tier, list);
  }

  const columns = TIER_ORDER.filter((tier) => (byTier.get(tier)?.length ?? 0) > 0);

  const nodes: RoadmapStageNodePosition[] = [];
  let maxRows = 0;
  columns.forEach((tier, columnIndex) => {
    const tierItems = byTier.get(tier) ?? [];
    maxRows = Math.max(maxRows, tierItems.length);
    tierItems.forEach((item, row) => {
      nodes.push({
        bibId: item.bibId,
        tier,
        column: columnIndex + 1,
        row,
        x: paddingX + (columnIndex + 1) * columnWidth,
        y: paddingY + row * rowHeight,
      });
    });
  });

  const tallestColumnRows = Math.max(maxRows, 1);
  const root = {
    x: paddingX,
    y: paddingY + ((tallestColumnRows - 1) / 2) * rowHeight,
  };

  return {
    root,
    nodes,
    columns,
    width: paddingX + (columns.length + 1) * columnWidth,
    height: paddingY * 2 + tallestColumnRows * rowHeight,
  };
}
