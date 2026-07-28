/**
 * Pure BFS distance-from-root over the current disclosed topology (charter
 * §10 "2D and List... grouped by layer + relationship distance"). Distance
 * is measured over UNDIRECTED adjacency (source/target treated
 * symmetrically) — relationship distance is a topological "how many hops
 * away from the context root" fact, not a claim about argumentative
 * direction, matching how `disclosurePipeline.ts`'s own neighbor-candidate
 * lookup already treats links (both directions considered when finding
 * what's reachable from a frontier).
 *
 * A node with no entry in the returned map is either the same node the
 * caller already excluded, or genuinely unreachable from the root within
 * the current topology (a disconnected component, or a synthesized
 * aggregate node with no real links at all) — callers must treat "absent"
 * as "unknown distance", never as 0 or Infinity, matching this codebase's
 * "never punish/fabricate missing data" convention used throughout
 * `graph/types.ts`.
 */
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

export function computeRelationshipDistances(
  rootId: string | null,
  nodes: readonly KnowledgeMapDisplayNode[],
  links: readonly KnowledgeMapDisplayLink[],
): Map<string, number> {
  const distances = new Map<string, number>();
  if (!rootId) return distances;

  const nodeIds = new Set(nodes.map((n) => String(n.id)));
  if (!nodeIds.has(rootId)) return distances;

  const adjacency = new Map<string, Set<string>>();
  for (const id of nodeIds) adjacency.set(id, new Set());
  for (const link of links) {
    const source = String(link.source);
    const target = String(link.target);
    if (source === target) continue; // self-link — no meaningful distance contribution
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue; // dangling — already excluded upstream, never trusted twice
    adjacency.get(source)?.add(target);
    adjacency.get(target)?.add(source);
  }

  distances.set(rootId, 0);
  const queue: string[] = [rootId];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const currentDistance = distances.get(current) ?? 0;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, currentDistance + 1);
      queue.push(neighbor);
    }
  }
  return distances;
}
