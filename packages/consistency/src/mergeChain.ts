/**
 * Shared helper: resolve a `work_identity` id through any ACTIVE (not
 * reverted) Phase 20.6 merges to its current winner. Several checks need this
 * exact resolution (a `learning_resource`/`work` row can still point at a
 * loser identity if it was created or last touched before a merge ran, or if
 * a merge happened after the row's own last write) — kept in one place so
 * every check applies identically the same "what is the CURRENT canonical
 * identity for this id" rule that `apps/worker/src/identity/merge.ts` itself
 * enforces when applying a merge.
 */

export interface MergeEdge {
  loserIdentityId: string;
  winnerIdentityId: string;
  /** Only active (non-reverted) merges should be passed in here at all —
   *  callers filter by `revertedAt === null` before building the map, but a
   *  defensive re-check is harmless. */
  revertedAt?: string | Date | null;
}

/**
 * Resolves `id` to the identity it currently displays as. Follows chained
 * merges (a loser can itself later be re-merged elsewhere is not possible
 * today — a loser is locked while its merge is active — but the resolver
 * still walks the chain defensively and guards against a cycle rather than
 * looping forever on corrupt data).
 */
export function resolveCanonicalIdentityId(id: string, merges: readonly MergeEdge[]): string {
  const byLoser = new Map<string, string>();
  for (const m of merges) {
    if (m.revertedAt) continue;
    byLoser.set(m.loserIdentityId, m.winnerIdentityId);
  }
  const seen = new Set<string>();
  let current = id;
  while (byLoser.has(current) && !seen.has(current)) {
    seen.add(current);
    current = byLoser.get(current)!;
  }
  return current;
}

/** True when `id` is currently a merged-away loser (has an active merge pointing away from it). */
export function isActiveLoser(id: string, merges: readonly MergeEdge[]): boolean {
  return merges.some((m) => m.loserIdentityId === id && !m.revertedAt);
}
