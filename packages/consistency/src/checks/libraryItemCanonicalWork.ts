import { isActiveLoser, resolveCanonicalIdentityId } from "../mergeChain";
import type { ConsistencyMismatch } from "../types";
import type { ConsistencySnapshot } from "../snapshot";

/**
 * Check 2 — Library item → canonical work (plan §20.7 bullet 2), covering
 * both `learning_resource.work_identity_id` and `work.work_identity_id` —
 * the two tables that carry this exact FK shape. A row can be left pointing
 * at a `work_identity` that Phase 20.6's merge tool has since merged away
 * (the loser row is intentionally never deleted, only displaced — see
 * `work_identity_merge`'s own doc comment) if it was created or last
 * touched around the same time as an unrelated merge elsewhere. The Phase
 * 20.6 identity layer is this project's canonical source of truth for
 * work-level facts (per this task's own instructions), so the repair here
 * is unconditional: repoint to the merge's recorded winner.
 *
 * A `work_identity_id` that resolves to no existing `work_identity` row at
 * all (genuinely dangling — the FK is `ON DELETE SET NULL`, so this should
 * never happen in practice) is reported but never repaired: there is no
 * canonical fact to repoint it to without guessing.
 */
export function checkLibraryItemCanonicalWork(snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  const mismatches: ConsistencyMismatch[] = [];
  const identityIds = new Set(snapshot.workIdentities.map((wi) => wi.id));
  const merges = snapshot.workIdentityMerges;

  for (const lr of snapshot.learningResources) {
    if (!lr.workIdentityId) continue;
    if (!identityIds.has(lr.workIdentityId)) {
      mismatches.push({
        checkId: "library-item-canonical-work",
        entityType: "learning_resource",
        entityId: lr.id,
        description: "learning_resource.work_identity_id references a work_identity row that no longer exists.",
        severity: "critical",
        evidence: { workIdentityId: lr.workIdentityId },
        repair: null,
      });
      continue;
    }
    if (isActiveLoser(lr.workIdentityId, merges)) {
      const winner = resolveCanonicalIdentityId(lr.workIdentityId, merges);
      mismatches.push({
        checkId: "library-item-canonical-work",
        entityType: "learning_resource",
        entityId: lr.id,
        description: "learning_resource.work_identity_id points at an identity merged away by Phase 20.6; the Library entry displays a stale, non-canonical identity.",
        severity: "warning",
        evidence: { staleWorkIdentityId: lr.workIdentityId, canonicalWorkIdentityId: winner },
        repair: {
          kind: "update",
          table: "learning_resource",
          id: lr.id,
          patch: { workIdentityId: winner },
          reason: `work_identity_merge repoints ${lr.workIdentityId} → ${winner}; the identity layer is the canonical source of truth for work-level facts.`,
        },
      });
    }
  }

  for (const work of snapshot.works) {
    if (!work.workIdentityId) continue;
    if (!identityIds.has(work.workIdentityId)) {
      mismatches.push({
        checkId: "library-item-canonical-work",
        entityType: "work",
        entityId: work.id,
        description: "work.work_identity_id references a work_identity row that no longer exists.",
        severity: "critical",
        evidence: { workIdentityId: work.workIdentityId },
        repair: null,
      });
      continue;
    }
    if (isActiveLoser(work.workIdentityId, merges)) {
      const winner = resolveCanonicalIdentityId(work.workIdentityId, merges);
      mismatches.push({
        checkId: "library-item-canonical-work",
        entityType: "work",
        entityId: work.id,
        description: "work.work_identity_id points at an identity merged away by Phase 20.6.",
        severity: "warning",
        evidence: { staleWorkIdentityId: work.workIdentityId, canonicalWorkIdentityId: winner },
        repair: {
          kind: "update",
          table: "work",
          id: work.id,
          patch: { workIdentityId: winner },
          reason: `work_identity_merge repoints ${work.workIdentityId} → ${winner}; the identity layer is the canonical source of truth for work-level facts.`,
        },
      });
    }
  }

  return mismatches;
}
