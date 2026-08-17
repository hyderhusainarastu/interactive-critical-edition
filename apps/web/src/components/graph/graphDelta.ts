import type { GraphData, GraphLink, GraphNode } from "./types";

/**
 * Debate layer (Phase 28.4): the additive delta `GET
 * /api/graph/debate/[clusterId]/expand` returns — a debate cluster's claim
 * nodes plus their `claim_relationship`/`asserts_claim` edges. Deliberately
 * NOT a full `GraphPayload` (no `stats`) — it is only ever merged into an
 * already-loaded `GraphData` via `mergeGraphDelta` below, never rendered on
 * its own.
 */
export interface GraphExpansionDelta {
  nodes: GraphNode[];
  links: GraphLink[];
}

/**
 * Client-side merge for an expansion delta (Phase 28.4, the `graphExpansion`
 * request/response precedent — `apps/web/src/lib/graphExpansion.ts`/
 * `GraphExpansionControls` — but merged in place rather than requiring a
 * full page reload, since this delta is a $0 synchronous DB read, not a
 * queued paid job). Idempotent: re-merging an already-merged delta (a
 * second click on the same "Expand debate" control) adds nothing new,
 * since every id is deduplicated against what `data` already has. Never
 * mutates `data` — same "returns a new object" discipline as
 * `filterGraphData`/`roadmapSubset` above.
 */
export function mergeGraphDelta(data: GraphData, delta: GraphExpansionDelta): GraphData {
  const existingNodeIds = new Set(data.nodes.map((n) => n.id));
  const newNodes = delta.nodes.filter((n) => !existingNodeIds.has(n.id));
  const existingLinkIds = new Set(data.links.map((l) => l.id));
  const newLinks = delta.links.filter((l) => !existingLinkIds.has(l.id));
  if (newNodes.length === 0 && newLinks.length === 0) return data;
  return { ...data, nodes: [...data.nodes, ...newNodes], links: [...data.links, ...newLinks] };
}
