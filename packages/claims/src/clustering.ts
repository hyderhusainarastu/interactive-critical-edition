import { createHash } from "node:crypto";
import type { ClaimRelationValence } from "./taxonomy";

/**
 * One judged relationship between two claims — the edge the clustering BFS
 * walks. Ports the connected-components approach ScholarLens's
 * `detect_clusters` uses over its `relationships` table.
 */
export interface ClaimRelationEdge {
  claimLo: string;
  claimHi: string;
  valence: ClaimRelationValence;
}

export type TensionValence = Exclude<ClaimRelationValence, "unrelated">;

export interface ClaimCluster {
  memberIds: string[];
  /** Deterministic identity for this cluster's membership — sha256 of the
   *  sorted member ids, so the same set of claims always hashes the same
   *  way regardless of discovery order. */
  memberHash: string;
  edgeCount: number;
  counts: Record<TensionValence, number>;
}

/** sha256 of the sorted, joined member ids. Exposed standalone so a caller
 *  can recompute the same hash for a candidate membership without re-running
 *  the whole clustering pass. */
export function memberHash(ids: string[]): string {
  const sorted = [...ids].sort();
  return createHash("sha256").update(sorted.join(" ")).digest("hex");
}

/**
 * BFS connected components over claim-relationship edges, excluding
 * "unrelated" edges (ScholarLens's `detect_clusters`: "Only non-unrelated
 * relationships build clusters" — an unrelated verdict is a claim about the
 * ABSENCE of a relationship, so it must never link two claims into the same
 * cluster). Components of size 1 (a claim with no surviving tension edge to
 * anything) are dropped — a cluster needs at least 2 members to represent a
 * shared debate.
 */
export function findClaimClusters(edges: ClaimRelationEdge[]): ClaimCluster[] {
  const relevant = edges.filter((e) => e.valence !== "unrelated");

  const adjacency = new Map<string, ClaimRelationEdge[]>();
  for (const e of relevant) {
    for (const id of [e.claimLo, e.claimHi]) {
      if (!adjacency.has(id)) adjacency.set(id, []);
    }
    adjacency.get(e.claimLo)!.push(e);
    adjacency.get(e.claimHi)!.push(e);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const queue: string[] = [start];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (visited.has(node)) continue;
      visited.add(node);
      component.push(node);
      for (const edge of adjacency.get(node) ?? []) {
        const other = edge.claimLo === node ? edge.claimHi : edge.claimLo;
        if (!visited.has(other)) queue.push(other);
      }
    }
    if (component.length >= 2) components.push(component);
  }

  return components.map((memberIds) => {
    const memberSet = new Set(memberIds);
    const compEdges = relevant.filter((e) => memberSet.has(e.claimLo) && memberSet.has(e.claimHi));
    const counts: Record<TensionValence, number> = { contradiction: 0, support: 0, nuance: 0 };
    for (const e of compEdges) counts[e.valence as TensionValence] += 1;
    return {
      memberIds,
      memberHash: memberHash(memberIds),
      edgeCount: compEdges.length,
      counts,
    };
  });
}
