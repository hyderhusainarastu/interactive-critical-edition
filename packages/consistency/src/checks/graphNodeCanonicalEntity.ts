import { isActiveLoser, resolveCanonicalIdentityId } from "../mergeChain";
import type { ConsistencyMismatch } from "../types";
import type { ConsistencySnapshot } from "../snapshot";

/**
 * Check 3 — graph node → canonical entity (plan §20.7 bullet 3).
 *
 * The current graph_edge contract (`sourceType`/`targetType` ∈ {"work",
 * "bibliographic_record", "concept"}, see `apps/worker/src/analyze.ts`)
 * references a `work` row directly, not a `work_identity` row — so a graph
 * node itself never "points at" an identity, and there is nothing to
 * repoint here. What CAN drift is display: a `work` node whose own
 * `work_identity_id` is stale (merged away) will render under an outdated
 * canonical identity everywhere the graph reads that join, even though the
 * edge's endpoint id (the work row) is perfectly valid.
 *
 * This check is deliberately informational only (`repair: null` always) —
 * `library-item-canonical-work` already owns and applies the actual fix
 * (repointing `work.work_identity_id` to the merge winner); duplicating that
 * repair here would apply the same patch twice from two code paths. This
 * check exists so a report surfaces *which graph-attached works* are
 * affected, since that's what actually renders wrong to a reader of the
 * Visualization surface, without re-deciding or re-applying the fix.
 */
export function checkGraphNodeCanonicalEntity(snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  const mismatches: ConsistencyMismatch[] = [];
  const workById = new Map(snapshot.works.map((w) => [w.id, w]));
  const merges = snapshot.workIdentityMerges;

  const graphAttachedWorkIds = new Set<string>();
  for (const edge of snapshot.graphEdges) {
    if (edge.sourceType === "work") graphAttachedWorkIds.add(edge.sourceId);
    if (edge.targetType === "work") graphAttachedWorkIds.add(edge.targetId);
  }

  for (const workId of graphAttachedWorkIds) {
    const work = workById.get(workId);
    if (!work?.workIdentityId) continue;
    if (isActiveLoser(work.workIdentityId, merges)) {
      const winner = resolveCanonicalIdentityId(work.workIdentityId, merges);
      mismatches.push({
        checkId: "graph-node-canonical-entity",
        entityType: "work",
        entityId: workId,
        description: "A graph-attached work node's own work_identity_id is stale (merged away); the graph will display it under a non-canonical identity until library-item-canonical-work's repair runs.",
        severity: "info",
        evidence: { staleWorkIdentityId: work.workIdentityId, canonicalWorkIdentityId: winner },
        repair: null,
      });
    }
  }

  return mismatches;
}
