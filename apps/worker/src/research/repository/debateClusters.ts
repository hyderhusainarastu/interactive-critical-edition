import { claimRelationships, db, debateClusterMembers, debateClusterRelationships, debateClusters } from "@ice/db";
import { and, eq, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// cluster_debates (Phase 26.3).
// ---------------------------------------------------------------------------

export interface JudgedRelationshipEdge {
  id: string;
  claimLoId: string;
  claimHiId: string;
  valence: string;
}

/** Every active, non-hidden `claim_relationship` for a project — the BFS
 *  clustering pass's whole edge population. `status = 'active'` excludes a
 *  future superseded judgment (there is no such write path yet, but the
 *  filter costs nothing and keeps this query correct the day one exists);
 *  `hidden = false` excludes a user-hidden relationship (the correction-
 *  workflow precedent) from contributing to cluster membership. */
export async function loadJudgedRelationshipsForProject(userId: string, projectId: string): Promise<JudgedRelationshipEdge[]> {
  return db
    .select({ id: claimRelationships.id, claimLoId: claimRelationships.claimLoId, claimHiId: claimRelationships.claimHiId, valence: claimRelationships.valence })
    .from(claimRelationships)
    .where(
      and(
        eq(claimRelationships.userId, userId),
        eq(claimRelationships.projectId, projectId),
        eq(claimRelationships.status, "active"),
        eq(claimRelationships.hidden, false),
      ),
    );
}

export interface ExistingDebateClusterRow {
  id: string;
  memberHash: string;
  status: string;
}

/** Every `debate_cluster` row (any status) for a project — the naming-
 *  idempotency lookup (`memberHash` -> row) and the stale-transition input
 *  (every currently-`active` row whose `memberHash` didn't survive this
 *  run's BFS becomes `stale`). */
export async function loadExistingDebateClustersForProject(userId: string, projectId: string): Promise<ExistingDebateClusterRow[]> {
  return db
    .select({ id: debateClusters.id, memberHash: debateClusters.memberHash, status: debateClusters.status })
    .from(debateClusters)
    .where(and(eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId)));
}

export interface NewDebateCluster {
  memberHash: string;
  name: string;
  researchQuestion: string | null;
  description: string | null;
  edgeCount: number;
  counts: Record<string, number>;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
}

/** Inserts a newly-named cluster, respecting the `(user_id, project_id,
 *  member_hash)` unique — a concurrent duplicate insert (two overlapping
 *  runs) is a no-op here, not a duplicate row; the caller re-selects on a
 *  dedup hit exactly like `upsertResearchCorpusItem`. */
export async function insertDebateCluster(userId: string, projectId: string, cluster: NewDebateCluster): Promise<string> {
  const [inserted] = await db
    .insert(debateClusters)
    .values({
      userId,
      projectId,
      name: cluster.name,
      researchQuestion: cluster.researchQuestion,
      description: cluster.description,
      memberHash: cluster.memberHash,
      edgeCount: cluster.edgeCount,
      counts: cluster.counts,
      status: "active",
      promptVersion: cluster.promptVersion,
      provider: cluster.provider,
      model: cluster.model,
    })
    .onConflictDoNothing({ target: [debateClusters.userId, debateClusters.projectId, debateClusters.memberHash] })
    .returning({ id: debateClusters.id });
  if (inserted) return inserted.id;

  const [existing] = await db
    .select({ id: debateClusters.id })
    .from(debateClusters)
    .where(and(eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId), eq(debateClusters.memberHash, cluster.memberHash)))
    .limit(1);
  if (!existing) {
    throw new Error(`Debate cluster insert conflicted on memberHash ${cluster.memberHash} but no existing row was found.`);
  }
  return existing.id;
}

/** Reactivates a cluster whose exact prior membership recurred (a `stale`
 *  row's component reappeared) — also refreshes `edgeCount`/`counts` in case
 *  the edge set changed shape (e.g. a `nuance` edge was corrected to
 *  `contradiction`) without changing WHICH claims belong, which would
 *  otherwise leave stale counts on an otherwise-correct row. */
export async function reactivateDebateCluster(clusterId: string, edgeCount: number, counts: Record<string, number>): Promise<void> {
  await db
    .update(debateClusters)
    .set({ status: "active", edgeCount, counts, updatedAt: new Date() })
    .where(eq(debateClusters.id, clusterId));
}

/** Marks every currently-`active` cluster for a project whose id is NOT in
 *  `survivingClusterIds` as `stale` — never deleted (plan §Pipeline
 *  "membership shifts mark old clusters `stale`, never delete (user
 *  verifications survive)"). Called with the FULL set of this run's
 *  surviving cluster ids, so a cluster this run didn't touch at all (because
 *  its component vanished entirely — e.g. its sole edge was hidden) is
 *  correctly marked stale too, not just ones whose membership changed shape. */
export async function markStaleDebateClusters(userId: string, projectId: string, survivingClusterIds: string[]): Promise<number> {
  const condition =
    survivingClusterIds.length > 0
      ? and(
          eq(debateClusters.userId, userId),
          eq(debateClusters.projectId, projectId),
          eq(debateClusters.status, "active"),
          sql`${debateClusters.id} NOT IN ${survivingClusterIds}`,
        )
      : and(eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId), eq(debateClusters.status, "active"));
  const rows = await db.update(debateClusters).set({ status: "stale", updatedAt: new Date() }).where(condition).returning({ id: debateClusters.id });
  return rows.length;
}

/** Replaces a cluster's member/edge join rows wholesale (delete-then-insert)
 *  — simpler and equally correct for this table's size than a diff, since
 *  the join rows carry no independent state of their own worth preserving
 *  row-for-row. */
export async function replaceDebateClusterMembership(clusterId: string, claimIds: string[], claimRelationshipIds: string[]): Promise<void> {
  await db.delete(debateClusterMembers).where(eq(debateClusterMembers.clusterId, clusterId));
  await db.delete(debateClusterRelationships).where(eq(debateClusterRelationships.clusterId, clusterId));
  if (claimIds.length > 0) {
    await db
      .insert(debateClusterMembers)
      .values(claimIds.map((claimId) => ({ clusterId, claimId })))
      .onConflictDoNothing();
  }
  if (claimRelationshipIds.length > 0) {
    await db
      .insert(debateClusterRelationships)
      .values(claimRelationshipIds.map((claimRelationshipId) => ({ clusterId, claimRelationshipId })))
      .onConflictDoNothing();
  }
}
