import { claimRelationships, db, debateClusterMembers, debateClusterRelationships, debateClusters, evidenceChambers, researchClaims, researchProjects, works } from "@ice/db";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { getOwnedResearchProject } from "./projects";

/**
 * Owner-scoped reads over `debate_cluster` (Phase 27.1) — the debates
 * cluster view the "Synthesize chamber" action lives on. Mirrors
 * `lib/research/claims.ts`'s ownership discipline: every read here proves
 * project ownership through `research_project.user_id`, never trusts a bare
 * `projectId`/`clusterId` string.
 */

export interface DebateClusterListRow {
  id: string;
  name: string;
  researchQuestion: string | null;
  status: string;
  edgeCount: number;
  counts: unknown;
  verificationStatus: string;
  /** Most recent `evidence_chamber` id for this cluster, active status only
   *  — null when no chamber has been synthesized yet. */
  latestChamberId: string | null;
  createdAt: Date;
}

export async function listDebateClustersForProject(userId: string, projectId: string): Promise<DebateClusterListRow[]> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return [];

  const clusters = await db
    .select({
      id: debateClusters.id,
      name: debateClusters.name,
      researchQuestion: debateClusters.researchQuestion,
      status: debateClusters.status,
      edgeCount: debateClusters.edgeCount,
      counts: debateClusters.counts,
      verificationStatus: debateClusters.verificationStatus,
      createdAt: debateClusters.createdAt,
    })
    .from(debateClusters)
    .where(and(eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId)))
    .orderBy(desc(debateClusters.createdAt));
  if (clusters.length === 0) return [];

  const chamberRows = await db
    .select({ id: evidenceChambers.id, clusterId: evidenceChambers.clusterId, createdAt: evidenceChambers.createdAt })
    .from(evidenceChambers)
    .where(and(eq(evidenceChambers.userId, userId), eq(evidenceChambers.projectId, projectId), eq(evidenceChambers.status, "active")))
    .orderBy(desc(evidenceChambers.createdAt));
  const latestChamberByCluster = new Map<string, string>();
  for (const row of chamberRows) {
    if (!latestChamberByCluster.has(row.clusterId)) latestChamberByCluster.set(row.clusterId, row.id);
  }

  return clusters.map((c) => ({ ...c, latestChamberId: latestChamberByCluster.get(c.id) ?? null }));
}

export interface DebateClusterMemberClaimRow {
  id: string;
  workId: string | null;
  workTitle: string | null;
  claimText: string;
  claimNature: string;
}

/** One judged edge connecting this cluster's members (`debate_cluster_relationship`
 *  → `claim_relationship`) — the same shape `ResearchHypothesesView.tsx`'s
 *  "Cited conflicts" list already reads, reused here so the cluster page
 *  that actually shows the relationship can offer its own correction
 *  controls directly rather than only reachable indirectly via a hypothesis
 *  that happens to cite it (Stage 5 verification Finding 2). */
export interface DebateClusterRelationshipRow {
  id: string;
  valence: string;
  category: string;
  verificationStatus: string;
  hidden: boolean;
}

export interface DebateClusterDetail {
  id: string;
  projectId: string;
  /** For the breadcrumb strip's project-name crumb (Item 2, fix lane) — no
   *  other field on this row already carries it. */
  projectTitle: string;
  name: string;
  researchQuestion: string | null;
  description: string | null;
  status: string;
  edgeCount: number;
  counts: unknown;
  verificationStatus: string;
  /** The Phase 29.2 review workflow's hide/restore state. */
  hidden: boolean;
  createdAt: Date;
  members: DebateClusterMemberClaimRow[];
  relationships: DebateClusterRelationshipRow[];
  latestChamberId: string | null;
}

/** A cluster is directly owner-scoped (`debate_cluster.user_id`) plus the
 *  project id in the URL — both checked, matching `getResearchClaimDetail`'s
 *  "no distinguishable 403" posture: a cluster that exists but isn't the
 *  caller's own (or isn't in the named project) resolves to `null`, same as
 *  one that doesn't exist at all. */
export async function getDebateClusterDetail(userId: string, projectId: string, clusterId: string): Promise<DebateClusterDetail | null> {
  const [cluster] = await db
    .select({
      id: debateClusters.id,
      projectId: debateClusters.projectId,
      projectTitle: researchProjects.title,
      name: debateClusters.name,
      researchQuestion: debateClusters.researchQuestion,
      description: debateClusters.description,
      status: debateClusters.status,
      edgeCount: debateClusters.edgeCount,
      counts: debateClusters.counts,
      verificationStatus: debateClusters.verificationStatus,
      hidden: debateClusters.hidden,
      createdAt: debateClusters.createdAt,
    })
    .from(debateClusters)
    .innerJoin(researchProjects, eq(researchProjects.id, debateClusters.projectId))
    .where(and(eq(debateClusters.id, clusterId), eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId)))
    .limit(1);
  if (!cluster) return null;

  const [members, relationships, latestChamber] = await Promise.all([
    db
      .select({
        id: researchClaims.id,
        workId: researchClaims.workId,
        workTitle: works.title,
        claimText: researchClaims.claimText,
        claimNature: researchClaims.claimNature,
      })
      .from(debateClusterMembers)
      .innerJoin(researchClaims, eq(researchClaims.id, debateClusterMembers.claimId))
      .leftJoin(works, eq(works.id, researchClaims.workId))
      .where(eq(debateClusterMembers.clusterId, clusterId))
      .orderBy(asc(researchClaims.createdAt)),
    db
      .select({
        id: claimRelationships.id,
        valence: claimRelationships.valence,
        category: claimRelationships.category,
        verificationStatus: claimRelationships.verificationStatus,
        hidden: claimRelationships.hidden,
      })
      .from(debateClusterRelationships)
      .innerJoin(claimRelationships, eq(claimRelationships.id, debateClusterRelationships.claimRelationshipId))
      .where(eq(debateClusterRelationships.clusterId, clusterId))
      .orderBy(asc(claimRelationships.createdAt)),
    db
      .select({ id: evidenceChambers.id })
      .from(evidenceChambers)
      .where(and(eq(evidenceChambers.userId, userId), eq(evidenceChambers.clusterId, clusterId), eq(evidenceChambers.status, "active")))
      .orderBy(desc(evidenceChambers.createdAt))
      .limit(1),
  ]);

  return { ...cluster, members, relationships, latestChamberId: latestChamber[0]?.id ?? null };
}

/**
 * Cross-project recent debates (Knowledge Map rebuild, spec §2.1/§2.3's
 * second genuinely-additive endpoint — `GET /api/research/debates`).
 * `debate_cluster.user_id` is a direct column (see `listDebateClustersForProject`
 * above and the table's own schema comment), so a cross-project scan proves
 * ownership with no join through `research_project` at all — the same
 * "directly owner-scoped, no project traversal needed" shape
 * `getResearchClaimDetail`/`listRecentResearchClaims` (`claims.ts`) already
 * use for claims.
 */
export interface RecentDebateClusterRow {
  id: string;
  projectId: string;
  projectTitle: string;
  name: string;
  researchQuestion: string | null;
  memberCount: number;
  updatedAt: Date;
}

export async function listRecentDebateClusters(userId: string, limit = 20): Promise<RecentDebateClusterRow[]> {
  const cappedLimit = Math.min(50, Math.max(1, limit));
  const clusters = await db
    .select({
      id: debateClusters.id,
      projectId: debateClusters.projectId,
      projectTitle: researchProjects.title,
      name: debateClusters.name,
      researchQuestion: debateClusters.researchQuestion,
      updatedAt: debateClusters.updatedAt,
    })
    .from(debateClusters)
    .innerJoin(researchProjects, eq(researchProjects.id, debateClusters.projectId))
    .where(eq(debateClusters.userId, userId))
    .orderBy(desc(debateClusters.updatedAt))
    .limit(cappedLimit);
  if (clusters.length === 0) return [];

  const memberCounts = await db
    .select({ clusterId: debateClusterMembers.clusterId, value: count() })
    .from(debateClusterMembers)
    .where(
      inArray(
        debateClusterMembers.clusterId,
        clusters.map((c) => c.id),
      ),
    )
    .groupBy(debateClusterMembers.clusterId);
  const countByCluster = new Map(memberCounts.map((row) => [row.clusterId, row.value]));

  return clusters.map((c) => ({ ...c, memberCount: countByCluster.get(c.id) ?? 0 }));
}

/** By-id lookup for a single debate cluster (Knowledge Map deep-link/URL-
 *  reconstruction resolution — a context id read back from the URL, not
 *  necessarily still inside the "recent" window `listRecentDebateClusters`
 *  caps at). Directly owner-scoped, same as the list above; returns `null`
 *  (never a distinguishable 403) for anything the caller doesn't own. */
export async function getDebateClusterById(userId: string, clusterId: string): Promise<RecentDebateClusterRow | null> {
  const [cluster] = await db
    .select({
      id: debateClusters.id,
      projectId: debateClusters.projectId,
      projectTitle: researchProjects.title,
      name: debateClusters.name,
      researchQuestion: debateClusters.researchQuestion,
      updatedAt: debateClusters.updatedAt,
    })
    .from(debateClusters)
    .innerJoin(researchProjects, eq(researchProjects.id, debateClusters.projectId))
    .where(and(eq(debateClusters.id, clusterId), eq(debateClusters.userId, userId)))
    .limit(1);
  if (!cluster) return null;
  const [memberCount] = await db
    .select({ value: count() })
    .from(debateClusterMembers)
    .where(eq(debateClusterMembers.clusterId, clusterId));
  return { ...cluster, memberCount: memberCount?.value ?? 0 };
}
