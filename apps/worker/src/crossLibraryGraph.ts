import { classifyRelationship, estimateCostUsd, type RelationshipCategory } from "@ice/ai-adapters";
import {
  aiUsageLogs,
  db,
  documents,
  graphExpansionRequests,
  workClaims,
  workRelationshipCandidates,
  workRelationshipJudgments,
  works,
} from "@ice/db";
import { bm25Shortlist, canAfford, charge, makeBudget, mergeCandidateIds, type WorkSignalForRetrieval } from "@ice/research";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { reportEvent } from "@ice/observability";

const AUTOMATIC_MAX_CANDIDATES = 20;
const AUTOMATIC_MAX_COST_USD = 0.25;
const JOB_HARD_CAP_USD = 5;
const MANUAL_MAX_CANDIDATES = 100;
// A deliberately conservative per-pair reservation. Actual provider usage is
// metered after every judgement; this reservation prevents a long sequence of
// calls from ever beginning past the documented hard limit.
const RESERVED_PAIR_COST_USD = 0.0125;

const CATEGORY_TO_EDGE: Record<RelationshipCategory, "cites" | "is_recommended_by" | "provides_context_for" | "is_prerequisite_for" | "influences" | "disagrees_with" | "interprets" | "is_comparable_to"> = {
  explicit_reference: "cites",
  secondary_scholarly_recommendation: "is_recommended_by",
  historical_context: "provides_context_for",
  prerequisite: "is_prerequisite_for",
  conceptual_influence: "influences",
  disagreement_polemical_target: "disagrees_with",
  interpretive_aid: "interprets",
  parallel_comparison: "is_comparable_to",
  optional_extension: "is_recommended_by",
  ai_inferred: "provides_context_for",
};

type ClaimAnchor = { claimId: string; textBlockId: string | null; claim: string; excerpt: string; confidence: number };

function evidenceHash(source: ClaimAnchor[], target: ClaimAnchor[]): string {
  return createHash("sha256")
    .update(JSON.stringify({ source, target }))
    .digest("hex");
}

function evidenceText(source: ClaimAnchor[], target: ClaimAnchor[]): string {
  return [
    "Source-work grounded claims:",
    ...source.map((claim) => `- ${claim.claim}\n  Evidence: ${claim.excerpt}`),
    "Target-work grounded claims:",
    ...target.map((claim) => `- ${claim.claim}\n  Evidence: ${claim.excerpt}`),
  ].join("\n").slice(0, 12_000);
}

/** The server uses the same conservative preflight estimate in preview and execution. */
export function estimateGraphExpansionCostUsd(candidateCount: number): number {
  return Math.min(JOB_HARD_CAP_USD, Math.max(0, candidateCount) * RESERVED_PAIR_COST_USD);
}

/**
 * Evaluate an expansion request exactly once. Only unjudged basis hashes can
 * call a provider; cached evidence is returned by the graph with no new model
 * work. A missing key produces an honestly marked heuristic judgment, never a
 * fabricated authority claim.
 */
export async function expandCrossLibraryGraph(expansionRequestId: string): Promise<void> {
  const [request] = await db
    .select()
    .from(graphExpansionRequests)
    .where(eq(graphExpansionRequests.id, expansionRequestId))
    .limit(1);
  if (!request || request.status === "complete") return;

  const automatic = request.mode === "automatic";
  const candidateLimit = automatic
    ? Math.min(AUTOMATIC_MAX_CANDIDATES, request.requestedCandidates)
    : Math.min(MANUAL_MAX_CANDIDATES, request.requestedCandidates);
  const estimate = estimateGraphExpansionCostUsd(candidateLimit);
  if (
    candidateLimit <= 0 ||
    Number(request.hardCapUsd) > JOB_HARD_CAP_USD ||
    estimate > Number(request.hardCapUsd) ||
    (automatic && estimate > AUTOMATIC_MAX_COST_USD) ||
    (!automatic && estimate > 1 && !request.confirmedAt)
  ) {
    await db
      .update(graphExpansionRequests)
      .set({ status: "failed", error: "Expansion failed its cost or confirmation guardrail.", updatedAt: new Date() })
      .where(eq(graphExpansionRequests.id, expansionRequestId));
    return;
  }

  await db
    .update(graphExpansionRequests)
    .set({ status: "running", error: null, updatedAt: new Date() })
    .where(eq(graphExpansionRequests.id, expansionRequestId));

  try {
    reportEvent("graph_expansion_started", {
      expansionRequestId: request.id,
      mode: request.mode,
      candidateLimit,
      estimatedCostUsd: estimate,
      hardCapUsd: request.hardCapUsd,
    });
    const ownedWorks = await db
      .select({ id: works.id, title: works.title, authorName: works.authorName })
      .from(works)
      .where(and(eq(works.userId, request.userId), isNull(works.deletedAt)));
    const workIds = ownedWorks.map((work) => work.id);
    const sourceWork = ownedWorks.find((work) => work.id === request.sourceWorkId);
    if (!sourceWork || workIds.length < 2) {
      await db.update(graphExpansionRequests).set({ status: "complete", updatedAt: new Date() }).where(eq(graphExpansionRequests.id, expansionRequestId));
      return;
    }

    const claims = await db
      .select({
        id: workClaims.id,
        workId: workClaims.workId,
        textBlockId: workClaims.textBlockId,
        claim: workClaims.claim,
        supportingExcerpt: workClaims.supportingExcerpt,
        confidence: workClaims.confidence,
      })
      .from(workClaims)
      .where(inArray(workClaims.workId, workIds));
    const claimsByWork = new Map<string, ClaimAnchor[]>();
    for (const claim of claims) {
      const entries = claimsByWork.get(claim.workId) ?? [];
      entries.push({
        claimId: claim.id,
        textBlockId: claim.textBlockId,
        claim: claim.claim,
        excerpt: claim.supportingExcerpt,
        confidence: claim.confidence,
      });
      claimsByWork.set(claim.workId, entries);
    }
    const compactClaims = (workId: string) => (claimsByWork.get(workId) ?? [])
      .sort((left, right) => right.confidence - left.confidence || left.claimId.localeCompare(right.claimId))
      .slice(0, 3);
    const signals: WorkSignalForRetrieval[] = ownedWorks.map((work) => ({
      workId: work.id,
      text: [work.title, work.authorName, ...compactClaims(work.id).flatMap((claim) => [claim.claim, claim.excerpt])].filter(Boolean).join("\n"),
    }));
    const sourceSignal = signals.find((signal) => signal.workId === sourceWork.id)!;
    const lexical = bm25Shortlist(sourceSignal, signals, candidateLimit);
    const storedVectors = await db
      .select({ targetWorkId: workRelationshipCandidates.targetWorkId, score: workRelationshipCandidates.score })
      .from(workRelationshipCandidates)
      .where(and(eq(workRelationshipCandidates.sourceWorkId, sourceWork.id), eq(workRelationshipCandidates.method, "embedding-v4")));
    const candidateIds = mergeCandidateIds(lexical, storedVectors, candidateLimit);

    for (const candidate of lexical) {
      await db
        .insert(workRelationshipCandidates)
        .values({
          sourceWorkId: sourceWork.id,
          targetWorkId: candidate.targetWorkId,
          method: "bm25-v4",
          score: candidate.score,
          basis: { sharedTerms: candidate.sharedTerms },
        })
        .onConflictDoUpdate({
          target: [workRelationshipCandidates.sourceWorkId, workRelationshipCandidates.targetWorkId, workRelationshipCandidates.method],
          set: { score: candidate.score, basis: { sharedTerms: candidate.sharedTerms }, createdAt: new Date() },
        });
    }

    const budget = makeBudget(Math.min(1, Number(request.hardCapUsd)), Math.min(JOB_HARD_CAP_USD, Number(request.hardCapUsd)));
    const sourceClaims = compactClaims(sourceWork.id);
    const sourceDocument = await db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.workId, sourceWork.id))
      .limit(1);

    let actualCostUsd = 0;
    let newJudgments = 0;
    for (const targetWorkId of candidateIds) {
      if (!canAfford(budget, RESERVED_PAIR_COST_USD)) break;
      const targetWork = ownedWorks.find((work) => work.id === targetWorkId);
      const targetClaims = compactClaims(targetWorkId);
      if (!targetWork || sourceClaims.length === 0 || targetClaims.length === 0) continue;
      const basisHash = evidenceHash(sourceClaims, targetClaims);
      const [cached] = await db
        .select({ id: workRelationshipJudgments.id })
        .from(workRelationshipJudgments)
        .where(and(
          eq(workRelationshipJudgments.userId, request.userId),
          eq(workRelationshipJudgments.sourceWorkId, sourceWork.id),
          eq(workRelationshipJudgments.targetWorkId, targetWork.id),
          eq(workRelationshipJudgments.basisHash, basisHash),
        ))
        .limit(1);
      if (cached) continue;

      // Reserve before the call. The actual returned cost is charged below,
      // and classification itself has a bounded 400-token JSON response.
      charge(budget, RESERVED_PAIR_COST_USD);
      const judgement = await classifyRelationship({
        primaryTitle: sourceWork.title,
        primaryAuthor: sourceWork.authorName,
        candidateTitle: targetWork.title,
        candidateAuthor: targetWork.authorName,
        sourceText: evidenceText(sourceClaims, targetClaims),
        resolved: false,
      });
      const actualCost = estimateCostUsd(judgement.model, judgement.promptTokens, judgement.completionTokens);
      actualCostUsd += actualCost;
      const explanation = `${judgement.explanation} Direction: “${sourceWork.title}” → “${targetWork.title}”.`;
      const evidence = { sourceClaims, targetClaims, basisHash };
      await db
        .insert(workRelationshipJudgments)
        .values({
          userId: request.userId,
          sourceWorkId: sourceWork.id,
          targetWorkId: targetWork.id,
          basisHash,
          relationshipType: CATEGORY_TO_EDGE[judgement.category],
          confidence: judgement.confidence,
          explanation,
          evidence,
          provider: judgement.provider,
          model: judgement.model,
          estimatedCostUsd: actualCost,
        })
        .onConflictDoNothing({ target: [workRelationshipJudgments.userId, workRelationshipJudgments.sourceWorkId, workRelationshipJudgments.targetWorkId, workRelationshipJudgments.basisHash] });
      newJudgments += 1;
      if (sourceDocument[0]) {
        await db.insert(aiUsageLogs).values({
          documentId: sourceDocument[0].id,
          task: "cross_work_relationship_judgment",
          stage: "cross-library-graph",
          provider: judgement.provider,
          model: judgement.model,
          promptTokens: judgement.promptTokens,
          completionTokens: judgement.completionTokens,
          estimatedCostUsd: actualCost,
        });
      }
    }

    await db.update(graphExpansionRequests).set({ status: "complete", updatedAt: new Date() }).where(eq(graphExpansionRequests.id, expansionRequestId));
    reportEvent("graph_expansion_completed", {
      expansionRequestId: request.id,
      mode: request.mode,
      candidates: candidateIds.length,
      newJudgments,
      actualCostUsd,
      hardCapUsd: request.hardCapUsd,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(graphExpansionRequests).set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() }).where(eq(graphExpansionRequests.id, expansionRequestId));
    reportEvent("graph_expansion_failed", { expansionRequestId: request.id, mode: request.mode, error: message.slice(0, 160) });
    throw error;
  }
}
