import { claimRelationships, db, debateClusters, evidenceChambers, researchClaims, researchHypotheses, researchProjectMembers } from "@ice/db";
import { and, eq, inArray } from "drizzle-orm";
import { getOwnedResearchProject } from "./projects";

/**
 * Real, owner-scoped counts backing the project overview's pipeline
 * sequence stepper (Item 2 of the Research-workspace fix lane's
 * owner-reported scope addition: "Extract claims → Detect relationships →
 * Cluster debates → Chambers / Hypotheses", each step's state drawn from
 * real numbers, never a guess). Same zero-LLM, computed-on-demand precedent
 * as `getResearchInsightFeed()` right above it in this package — no
 * persisted snapshot to drift.
 */

export interface ResearchPipelineOverview {
  /** Active claims across every work member of this project. */
  claimCount: number;
  /** Distinct WORK members that have at least one active claim — the
   *  cross-work signal `ResearchProjectOverview`'s stepper needs, since
   *  relationship detection only has something to compare once 2+ works
   *  each contributed claims (corpus-item-sourced claims don't count here —
   *  relationship detection compares claims FROM works, per plan §Pipeline). */
  workCountWithClaims: number;
  /** Total work members in the project, extracted or not — lets the
   *  stepper distinguish "no works added yet" from "works added, none
   *  extracted yet". */
  totalMemberWorkCount: number;
  relationshipCount: number;
  /** `active`-status debate clusters only — a `superseded` cluster is
   *  reprocess history, not current pipeline output (the `evidence_chamber`
   *  precedent below, and `debateClusters.status`'s own doc comment). */
  clusterCount: number;
  chamberCount: number;
  hypothesesCount: number;
}

const EMPTY_OVERVIEW: ResearchPipelineOverview = {
  claimCount: 0,
  workCountWithClaims: 0,
  totalMemberWorkCount: 0,
  relationshipCount: 0,
  clusterCount: 0,
  chamberCount: 0,
  hypothesesCount: 0,
};

export async function getResearchPipelineOverview(userId: string, projectId: string): Promise<ResearchPipelineOverview> {
  const project = await getOwnedResearchProject(userId, projectId, true);
  if (!project) return EMPTY_OVERVIEW;

  const memberWorkIds = (
    await db
      .select({ workId: researchProjectMembers.workId })
      .from(researchProjectMembers)
      .where(and(eq(researchProjectMembers.projectId, projectId), eq(researchProjectMembers.memberType, "work")))
  )
    .map((r) => r.workId)
    .filter((id): id is string => id != null);

  const [claimRows, relationshipRows, clusterRows, chamberRows, hypothesesRows] = await Promise.all([
    memberWorkIds.length === 0
      ? Promise.resolve([])
      : db
          .select({ workId: researchClaims.workId })
          .from(researchClaims)
          .where(and(eq(researchClaims.userId, userId), eq(researchClaims.status, "active"), inArray(researchClaims.workId, memberWorkIds))),
    db
      .select({ id: claimRelationships.id })
      .from(claimRelationships)
      .where(and(eq(claimRelationships.userId, userId), eq(claimRelationships.projectId, projectId), eq(claimRelationships.status, "active"))),
    db
      .select({ id: debateClusters.id })
      .from(debateClusters)
      .where(and(eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId), eq(debateClusters.status, "active"))),
    db
      .select({ id: evidenceChambers.id })
      .from(evidenceChambers)
      .where(and(eq(evidenceChambers.userId, userId), eq(evidenceChambers.projectId, projectId), eq(evidenceChambers.status, "active"))),
    db
      .select({ id: researchHypotheses.id })
      .from(researchHypotheses)
      .where(and(eq(researchHypotheses.userId, userId), eq(researchHypotheses.projectId, projectId), eq(researchHypotheses.status, "active"), eq(researchHypotheses.hidden, false))),
  ]);

  const workCountWithClaims = new Set(claimRows.map((r) => r.workId).filter((id): id is string => id != null)).size;

  return {
    claimCount: claimRows.length,
    workCountWithClaims,
    totalMemberWorkCount: memberWorkIds.length,
    relationshipCount: relationshipRows.length,
    clusterCount: clusterRows.length,
    chamberCount: chamberRows.length,
    hypothesesCount: hypothesesRows.length,
  };
}
