import {
  db,
  debateClusterMembers,
  debateClusters,
  evidenceChamberPositionClaims,
  evidenceChamberPositions,
  evidenceChambers,
  researchClaims,
  works,
} from "@ice/db";
import { and, asc, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// synthesize_chamber (Phase 27.1).
// ---------------------------------------------------------------------------

export interface DebateClusterRow {
  id: string;
  name: string;
  status: string;
}

/** Owner-scoped cluster lookup — the predicate that keeps chamber synthesis
 *  inside the requesting user's own project/cluster. */
export async function loadDebateClusterForUser(userId: string, projectId: string, clusterId: string): Promise<DebateClusterRow | null> {
  const [row] = await db
    .select({ id: debateClusters.id, name: debateClusters.name, status: debateClusters.status })
    .from(debateClusters)
    .where(and(eq(debateClusters.id, clusterId), eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId)))
    .limit(1);
  return row ?? null;
}

export interface ChamberSourceClaimRow {
  id: string;
  workId: string;
  workTitle: string;
  claimText: string;
  supportingExcerpt: string;
}

/** Every ACTIVE, non-hidden claim in a cluster's current membership — the
 *  chamber prompt's entire input population, and the CLAIM_N label
 *  assignment order `buildEvidenceChamberPrompt` uses (`@ice/claims`'s
 *  `evidenceChamber.ts`). Ordered by `debate_cluster_member.created_at`
 *  (tiebroken by claim id) so that assignment is STABLE run to run — this
 *  didn't matter under the old title-matching contract (a position's claims
 *  were found by matching `workTitle` text, order-independent), but does now
 *  that a claim's label depends on its position in this list. A claim a
 *  user has since hidden, or one superseded by a reprocess, is silently
 *  excluded (the `loadScopedClaimsForRelationshipDetection` precedent)
 *  rather than fed to a synthesis prompt as if it still stood. */
export async function loadClusterMemberClaims(clusterId: string): Promise<ChamberSourceClaimRow[]> {
  const rows = await db
    .select({
      id: researchClaims.id,
      workId: researchClaims.workId,
      workTitle: works.title,
      claimText: researchClaims.claimText,
      supportingExcerpt: researchClaims.supportingExcerpt,
    })
    .from(debateClusterMembers)
    .innerJoin(researchClaims, eq(researchClaims.id, debateClusterMembers.claimId))
    .innerJoin(works, eq(works.id, researchClaims.workId))
    .where(and(eq(debateClusterMembers.clusterId, clusterId), eq(researchClaims.status, "active"), eq(researchClaims.hidden, false)))
    .orderBy(asc(debateClusterMembers.createdAt), asc(researchClaims.id));
  return rows.filter((r): r is ChamberSourceClaimRow => r.workId !== null).map((r) => ({ ...r, workId: r.workId as string }));
}

/** The idempotency check ($0 skip): does an active chamber already exist
 *  for this EXACT basis hash? Checked BEFORE any model call is made — the
 *  chamber's own `onConflictDoNothing` (in `insertEvidenceChamber` below) is
 *  a defensive backstop for a concurrent duplicate run, not the primary
 *  cost-avoidance path. */
export async function findExistingChamberByBasisHash(userId: string, clusterId: string, basisHash: string): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: evidenceChambers.id })
    .from(evidenceChambers)
    .where(and(eq(evidenceChambers.userId, userId), eq(evidenceChambers.clusterId, clusterId), eq(evidenceChambers.basisHash, basisHash)))
    .limit(1);
  return row ?? null;
}

export interface NewChamberPositionClaim {
  claimId: string;
  /** A literal snapshot of the claim's `supporting_excerpt` at synthesis time. */
  excerpt: string;
}

export interface NewChamberPosition {
  ordinal: number;
  label: string;
  summary: string;
  method: string;
  scope: string;
  stanceConfidenceLabel: "high" | "medium" | "low";
  stanceConfidence: number;
  /** MUST be non-empty — enforced again inside `insertEvidenceChamber`'s
   *  transaction, not just trusted from the caller's own
   *  `matchChamberPositionClaims` null-check upstream (defense in depth: the
   *  DB write is the last place this invariant can be caught before an
   *  ungrounded position would otherwise persist). */
  claims: NewChamberPositionClaim[];
}

export interface NewEvidenceChamber {
  clusterId: string;
  question: string;
  sharedGround: string;
  pointOfDivergence: string;
  possibleReconciliation: string;
  unresolvedQuestion: string;
  missingEvidence: string;
  nextAction: string;
  basisHash: string;
  promptVersion: string;
  provider: string;
  model: string;
  positions: NewChamberPosition[];
}

/**
 * Persists a chamber + its positions + their grounding claims in ONE
 * transaction (plan §Build "every position >=1 claim enforced in the write
 * transaction"): if any position carries zero claims, the whole insert
 * throws and rolls back — nothing partial is ever left behind. Respects the
 * `(user_id, cluster_id, basis_hash)` unique — a concurrent duplicate
 * synthesis (two overlapping runs producing the SAME basis hash) is a no-op
 * here, not a duplicate row; the caller re-selects on a dedup hit exactly
 * like `insertDebateCluster`/`upsertResearchCorpusItem`.
 */
export async function insertEvidenceChamber(userId: string, projectId: string, chamber: NewEvidenceChamber): Promise<string> {
  if (chamber.positions.length === 0) {
    throw new Error("Evidence chamber must have at least one position — refusing to persist an empty chamber.");
  }
  for (const position of chamber.positions) {
    if (position.claims.length === 0) {
      throw new Error(`Evidence chamber position "${position.label}" has zero grounding claims — refusing to persist an ungrounded position.`);
    }
  }

  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(evidenceChambers)
      .values({
        userId,
        projectId,
        clusterId: chamber.clusterId,
        question: chamber.question,
        sharedGround: chamber.sharedGround,
        pointOfDivergence: chamber.pointOfDivergence,
        possibleReconciliation: chamber.possibleReconciliation,
        unresolvedQuestion: chamber.unresolvedQuestion,
        missingEvidence: chamber.missingEvidence,
        nextAction: chamber.nextAction,
        basisHash: chamber.basisHash,
        promptVersion: chamber.promptVersion,
        provider: chamber.provider,
        model: chamber.model,
      })
      .onConflictDoNothing({ target: [evidenceChambers.userId, evidenceChambers.clusterId, evidenceChambers.basisHash] })
      .returning({ id: evidenceChambers.id });

    let chamberId = inserted?.id;
    if (!chamberId) {
      const [existing] = await tx
        .select({ id: evidenceChambers.id })
        .from(evidenceChambers)
        .where(and(eq(evidenceChambers.userId, userId), eq(evidenceChambers.clusterId, chamber.clusterId), eq(evidenceChambers.basisHash, chamber.basisHash)))
        .limit(1);
      if (!existing) {
        throw new Error(`Evidence chamber insert conflicted on basisHash ${chamber.basisHash} but no existing row was found.`);
      }
      return existing.id;
    }

    for (const position of chamber.positions) {
      const [positionRow] = await tx
        .insert(evidenceChamberPositions)
        .values({
          chamberId,
          ordinal: position.ordinal,
          label: position.label,
          summary: position.summary,
          method: position.method,
          scope: position.scope,
          stanceConfidenceLabel: position.stanceConfidenceLabel,
          stanceConfidence: position.stanceConfidence,
        })
        .returning({ id: evidenceChamberPositions.id });

      await tx.insert(evidenceChamberPositionClaims).values(
        position.claims.map((c, index) => ({
          positionId: positionRow.id,
          claimId: c.claimId,
          ordinal: index,
          excerpt: c.excerpt,
        })),
      );
    }

    return chamberId;
  });
}
