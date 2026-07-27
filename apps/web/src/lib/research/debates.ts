import { db, debateClusterMembers, debateClusters, evidenceChambers, researchClaims, researchProjects, works } from "@ice/db";
import { and, asc, desc, eq } from "drizzle-orm";
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

  const [members, latestChamber] = await Promise.all([
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
      .select({ id: evidenceChambers.id })
      .from(evidenceChambers)
      .where(and(eq(evidenceChambers.userId, userId), eq(evidenceChambers.clusterId, clusterId), eq(evidenceChambers.status, "active")))
      .orderBy(desc(evidenceChambers.createdAt))
      .limit(1),
  ]);

  return { ...cluster, members, latestChamberId: latestChamber[0]?.id ?? null };
}
