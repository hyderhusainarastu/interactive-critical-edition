/**
 * Pure data-shaping for `KnowledgeMapListView.tsx` (charter §10 "2D and
 * List... grouped by layer + relationship distance, search/sort/select,
 * pagination"). Kept separate from the component so the grouping/sort/
 * pagination logic is unit-testable without React/DOM, matching this
 * directory's own `adapter.ts`/`layout.ts`/`sizing.ts` precedent.
 *
 * Deliberately does NOT implement its own search/filter step: the List
 * view consumes the SAME filtered `visibleNodeIds` set the 3D scene and
 * FilterRail already compute (spec §2's data-flow diagram — "Neither view
 * is a second independently filtered data source"). The caller passes
 * already-filtered `nodes`; this module only groups/sorts/paginates what
 * it's given.
 */
import { LAYER_ORDER, type Layer } from "@ice/graph-display";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";
import { computeRelationshipDistances } from "./relationshipDistance";
// Reused, not re-declared: `FilterRail.tsx` already exports the canonical
// layer-name labels (its own filter chips need them too) — a second,
// independently-worded copy here would be exactly the kind of drift this
// codebase's own "single source of truth" discipline warns against.
export { LAYER_LABEL } from "./FilterRail";

export interface ListRow {
  node: KnowledgeMapDisplayNode;
  layer: Layer;
  /** Hops from the current context root, or `null` when unknown/unreachable
   *  (never fabricated as 0/Infinity — see `relationshipDistance.ts`). */
  distance: number | null;
}

/** Flattens the given nodes into rows carrying their layer + BFS distance
 *  from `rootId`, grouped by `LAYER_ORDER` (the same six-band order the 3D
 *  scene's Z-depth uses, so the two views agree on "near vs. far"). Empty
 *  layers are simply absent from the caller's grouping step, not emitted
 *  as an empty group. */
export function buildListRows(
  nodes: readonly KnowledgeMapDisplayNode[],
  rootId: string | null,
  links: readonly KnowledgeMapDisplayLink[],
): ListRow[] {
  const distances = computeRelationshipDistances(rootId, nodes, links);
  return nodes.map((node) => ({
    node,
    layer: node.layer,
    distance: distances.get(String(node.id)) ?? null,
  }));
}

export type ListSortKey = "distance" | "label";

/** Sorts `rows` in-layer-group order first (LAYER_ORDER), then by the
 *  requested key within each layer — so the returned flat array's layer
 *  boundaries are always contiguous, letting the component insert a group
 *  header purely by watching for a layer change as it walks the array
 *  (no separate grouping data structure needs to survive pagination). Rows
 *  with an unknown distance sort after every row with a known one,
 *  regardless of direction — "unknown" is not "far" or "near", it is a
 *  fact the sort must never fabricate a position for. */
export function sortListRows(rows: readonly ListRow[], sortKey: ListSortKey, ascending: boolean): ListRow[] {
  const direction = ascending ? 1 : -1;
  const byLayerIndex = new Map(LAYER_ORDER.map((layer, index) => [layer, index] as const));

  return [...rows].sort((a, b) => {
    const layerDelta = (byLayerIndex.get(a.layer) ?? 0) - (byLayerIndex.get(b.layer) ?? 0);
    if (layerDelta !== 0) return layerDelta;

    if (sortKey === "distance") {
      if (a.distance == null && b.distance == null) return direction * a.node.label.localeCompare(b.node.label);
      if (a.distance == null) return 1;
      if (b.distance == null) return -1;
      if (a.distance !== b.distance) return direction * (a.distance - b.distance);
      return direction * a.node.label.localeCompare(b.node.label);
    }
    return direction * a.node.label.localeCompare(b.node.label);
  });
}

export const LIST_PAGE_SIZE = 50;

export interface PaginatedRows {
  pageRows: ListRow[];
  pageCount: number;
  /** The actually-applied page — clamped into `[1, pageCount]`, so a caller
   *  that requested page 99 of a 3-page list gets page 3 back, never an
   *  empty page it then has to notice and correct for itself. */
  page: number;
  totalRows: number;
}

export function paginateListRows(rows: readonly ListRow[], requestedPage: number, pageSize: number = LIST_PAGE_SIZE): PaginatedRows {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  const start = (page - 1) * pageSize;
  return { pageRows: rows.slice(start, start + pageSize), pageCount, page, totalRows: rows.length };
}
