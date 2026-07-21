import { db, workClaims, workRelationshipCandidates, works } from "@ice/db";
import { bm25Shortlist, mergeCandidateIds, type WorkSignalForRetrieval } from "@ice/research";
import { and, eq, isNull } from "drizzle-orm";

export const AUTOMATIC_GRAPH_CANDIDATE_CAP = 20;
export const AUTOMATIC_GRAPH_COST_CAP_USD = 0.25;
export const MANUAL_GRAPH_CANDIDATE_CAP = 400;
export const GRAPH_JOB_HARD_CAP_USD = 5;
export const GRAPH_PAIR_RESERVED_COST_USD = 0.0125;

export function estimateGraphExpansionCostUsd(candidateCount: number): number {
  return Math.min(GRAPH_JOB_HARD_CAP_USD, Math.max(0, candidateCount) * GRAPH_PAIR_RESERVED_COST_USD);
}

/** Read-only preview. It intentionally does not write candidates or queue a job. */
export async function getGraphExpansionPreview(userId: string, sourceWorkId: string, requestedCandidates = AUTOMATIC_GRAPH_CANDIDATE_CAP) {
  const ownedWorks = await db
    .select({ id: works.id, title: works.title, authorName: works.authorName })
    .from(works)
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)));
  const sourceWork = ownedWorks.find((work) => work.id === sourceWorkId);
  if (!sourceWork) return null;
  const claims = await db
    .select({ workId: workClaims.workId, claim: workClaims.claim, supportingExcerpt: workClaims.supportingExcerpt, confidence: workClaims.confidence })
    .from(workClaims)
    .innerJoin(works, eq(workClaims.workId, works.id))
    .where(and(eq(works.userId, userId), isNull(works.deletedAt)));
  const claimsByWork = new Map<string, { claim: string; excerpt: string; confidence: number }[]>();
  for (const claim of claims) {
    const rows = claimsByWork.get(claim.workId) ?? [];
    rows.push({ claim: claim.claim, excerpt: claim.supportingExcerpt, confidence: claim.confidence });
    claimsByWork.set(claim.workId, rows);
  }
  const signalFor = (work: typeof sourceWork): WorkSignalForRetrieval => ({
    workId: work.id,
    text: [work.title, work.authorName, ...(claimsByWork.get(work.id) ?? [])
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, 3)
      .flatMap((claim) => [claim.claim, claim.excerpt])]
      .filter(Boolean)
      .join("\n"),
  });
  const signals = ownedWorks.map(signalFor);
  const lexical = bm25Shortlist(signalFor(sourceWork), signals, MANUAL_GRAPH_CANDIDATE_CAP);
  const vectors = await db
    .select({ targetWorkId: workRelationshipCandidates.targetWorkId, score: workRelationshipCandidates.score })
    .from(workRelationshipCandidates)
    .where(and(eq(workRelationshipCandidates.sourceWorkId, sourceWorkId), eq(workRelationshipCandidates.method, "embedding-v4")));
  const availableCandidates = mergeCandidateIds(lexical, vectors, MANUAL_GRAPH_CANDIDATE_CAP).length;
  const candidateCount = Math.min(Math.max(0, requestedCandidates), availableCandidates, MANUAL_GRAPH_CANDIDATE_CAP);
  const estimate = estimateGraphExpansionCostUsd(candidateCount);
  return {
    sourceWork: { id: sourceWork.id, title: sourceWork.title },
    availableCandidates,
    automatic: {
      candidateCount: Math.min(AUTOMATIC_GRAPH_CANDIDATE_CAP, availableCandidates),
      estimatedCostUsd: estimateGraphExpansionCostUsd(Math.min(AUTOMATIC_GRAPH_CANDIDATE_CAP, availableCandidates)),
      hardCapUsd: AUTOMATIC_GRAPH_COST_CAP_USD,
    },
    manual: {
      candidateCount,
      estimatedCostUsd: estimate,
      requiresConfirmation: estimate > 1,
      hardCapUsd: GRAPH_JOB_HARD_CAP_USD,
    },
    hasGroundedClaims: (claimsByWork.get(sourceWorkId) ?? []).length > 0,
  };
}
