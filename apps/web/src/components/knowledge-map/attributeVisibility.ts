/**
 * Attribute-filter visibility over the current TOPOLOGY (spec §2's data
 * flow: "active filters ... applied via the SAME filterGraphData()-style
 * predicate"). Deliberately reuses the existing `filterGraphData`
 * predicates (`credibilityBandFor`, `matchesAnyReaderLevel`) rather than
 * re-deriving them, so a filter can never mean something subtly different
 * here than it does in the rest of the app.
 *
 * This is NOT `filterGraphData` itself — that function filters a canonical
 * `GraphNode[]`/`GraphLink[]` pair and this workspace only has canonical
 * `GraphNode` data for a "work" context (see `KnowledgeMapWorkspace.tsx`'s
 * own scope note on `canonicalNodeById`). This computes a VISIBILITY SET
 * over the already-adapted `DisplayNode[]` instead, toggling
 * `KnowledgeMapScene`'s `visibleNodeIds` prop rather than changing
 * `nodes`/`links` array identity — exactly the "ordinary filter changes
 * never touch graphData identity" contract that component's own top
 * comment documents. A node with no canonical backing (every synthesized
 * passage/question/claim/debate root, and the root is additionally always
 * exempt outright) is never hidden by a filter it has no data to match
 * against — never punish missing data, the same house rule
 * `matchesAnyReaderLevel`/D-21-10 already use elsewhere in this app.
 */
import { credibilityBandFor, type GraphFilters, type GraphNode } from "../graph/types";
import type { Layer } from "@ice/graph-display";
import type { KnowledgeMapDisplayNode } from "./adapter";

export function computeVisibleNodeIds(
  nodes: readonly KnowledgeMapDisplayNode[],
  canonicalNodeById: ReadonlyMap<string, GraphNode>,
  rootId: string,
  filters: GraphFilters,
  activeLayers: readonly Layer[],
): Set<string> {
  const normalizedSearch = filters.search.trim().toLocaleLowerCase();
  const visible = new Set<string>();

  for (const node of nodes) {
    const id = String(node.id);
    if (id === rootId) {
      visible.add(id); // the context root is always visible — the graph's one guaranteed anchor
      continue;
    }

    if (activeLayers.length > 0 && !activeLayers.includes(node.layer)) continue;

    const canonical = canonicalNodeById.get(id);

    if (normalizedSearch && !node.label.toLocaleLowerCase().includes(normalizedSearch)) continue;
    if (filters.type !== "all" && canonical && canonical.type !== filters.type) continue;
    if (filters.state !== "all" && canonical && canonical.state !== filters.state) continue;
    if (filters.authority !== "all" && canonical && (canonical.authority ?? null) !== filters.authority) continue;
    if (filters.credibilityBand !== "all" && canonical && credibilityBandFor(canonical.credibilityScore) !== filters.credibilityBand) continue;

    visible.add(id);
  }

  return visible;
}
