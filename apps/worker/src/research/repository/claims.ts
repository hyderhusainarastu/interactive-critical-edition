import { claimLoci, claimScores, db, researchClaimEmbeddings, researchClaims } from "@ice/db";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// research_claim writes.
// ---------------------------------------------------------------------------

export interface NewResearchClaim {
  userId: string;
  workId: string;
  processingRunId: string;
  textBlockId: string;
  quote: string;
  prefix: string;
  suffix: string;
  claimText: string;
  claimNature: string;
  confidence: string;
  section: string;
  sourceScope: "full_text" | "abstract" | "sampled";
  supportingExcerpt: string;
  contentHash: string;
  promptVersion: string;
}

/** Inserts one claim, respecting the partial dedup unique
 *  (`research_claim_work_dedup_unique`, `WHERE work_id IS NOT NULL`) — a
 *  re-run under an unchanged prompt version inserts nothing new for an
 *  unchanged claim. Returns the inserted row's id, or null when the insert
 *  was a no-op (the claim already existed). */
export async function insertResearchClaim(claim: NewResearchClaim): Promise<string | null> {
  const [inserted] = await db
    .insert(researchClaims)
    .values({
      userId: claim.userId,
      workId: claim.workId,
      processingRunId: claim.processingRunId,
      textBlockId: claim.textBlockId,
      quote: claim.quote,
      prefix: claim.prefix,
      suffix: claim.suffix,
      anchorState: "anchored",
      claimText: claim.claimText,
      claimNature: claim.claimNature as (typeof researchClaims.$inferInsert)["claimNature"],
      confidence: claim.confidence,
      section: claim.section,
      sourceScope: claim.sourceScope,
      supportingExcerpt: claim.supportingExcerpt,
      excerptVerified: true,
      contentHash: claim.contentHash,
      promptVersion: claim.promptVersion,
    })
    .onConflictDoNothing({
      target: [researchClaims.workId, researchClaims.contentHash, researchClaims.promptVersion],
      where: sql`${researchClaims.workId} is not null`,
    })
    .returning({ id: researchClaims.id });
  return inserted?.id ?? null;
}

export interface NewClaimScore {
  claimId: string;
  dimension: string;
  score: number;
  label: string;
  tier: string | null;
  signals: string[];
  scorerVersion: string;
}

export async function insertClaimScores(scores: NewClaimScore[]): Promise<void> {
  if (scores.length === 0) return;
  await db
    .insert(claimScores)
    .values(
      scores.map((s) => ({
        claimId: s.claimId,
        dimension: s.dimension as (typeof claimScores.$inferInsert)["dimension"],
        score: s.score,
        label: s.label as (typeof claimScores.$inferInsert)["label"],
        tier: s.tier,
        signals: s.signals,
        scorerVersion: s.scorerVersion,
      })),
    )
    .onConflictDoNothing({ target: [claimScores.claimId, claimScores.dimension, claimScores.scorerVersion] });
}

export interface NewClaimLocus {
  claimId: string;
  locusKey: string;
  origin: string;
  rawLocus: string | null;
}

export async function insertClaimLoci(loci: NewClaimLocus[]): Promise<void> {
  if (loci.length === 0) return;
  await db
    .insert(claimLoci)
    .values(
      loci.map((l) => ({
        claimId: l.claimId,
        locusKey: l.locusKey,
        origin: l.origin as (typeof claimLoci.$inferInsert)["origin"],
        rawLocus: l.rawLocus,
      })),
    )
    .onConflictDoNothing({ target: [claimLoci.claimId, claimLoci.locusKey, claimLoci.origin] });
}

export interface NewClaimEmbedding {
  claimId: string;
  model: string;
  inputHash: string;
  embedding: number[];
  dim: number;
}

export async function insertClaimEmbeddings(rows: NewClaimEmbedding[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(researchClaimEmbeddings)
    .values(rows.map((r) => ({ claimId: r.claimId, model: r.model, inputHash: r.inputHash, embedding: r.embedding, dim: r.dim })))
    .onConflictDoNothing({ target: [researchClaimEmbeddings.claimId, researchClaimEmbeddings.model, researchClaimEmbeddings.inputHash] });
}

// ---------------------------------------------------------------------------
// Rebind (reprocess supersession).
// ---------------------------------------------------------------------------

export interface RebindableClaim {
  id: string;
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
}

/** Active work-sourced claims not already matched to the current published
 *  run — the rebind step's input. `IS NULL OR <>` (not `is distinct from`
 *  directly on the column, for drizzle `ne()` compatibility) covers a claim
 *  that was previously left `unanchored` with `processing_run_id` cleared. */
export async function getClaimsNeedingRebind(workId: string, currentRunId: string): Promise<RebindableClaim[]> {
  return db
    .select({ id: researchClaims.id, quote: researchClaims.quote, prefix: researchClaims.prefix, suffix: researchClaims.suffix })
    .from(researchClaims)
    .where(
      and(
        eq(researchClaims.workId, workId),
        eq(researchClaims.status, "active"),
        or(isNull(researchClaims.processingRunId), ne(researchClaims.processingRunId, currentRunId)),
      ),
    );
}

export async function applyRebindResult(
  claimId: string,
  outcome: { textBlockId: string; anchorState: "rebound"; processingRunId: string } | { textBlockId: null; anchorState: "unanchored"; processingRunId: string },
): Promise<void> {
  await db
    .update(researchClaims)
    .set({
      textBlockId: outcome.textBlockId,
      anchorState: outcome.anchorState,
      processingRunId: outcome.processingRunId,
      updatedAt: new Date(),
    })
    .where(eq(researchClaims.id, claimId));
}

/** Active work-sourced claim count for a specific (run, prompt_version) —
 *  used to decide whether a chunk's extraction has already run this
 *  published run under the current prompt (idempotency at the DB level;
 *  a re-run's LLM calls still happen, but produce zero new rows). */
export async function countActiveClaimsForRun(runId: string, promptVersion: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(researchClaims)
    .where(and(eq(researchClaims.processingRunId, runId), eq(researchClaims.promptVersion, promptVersion), eq(researchClaims.status, "active")));
  return Number(row?.count ?? 0);
}
