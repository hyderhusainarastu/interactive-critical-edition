import {
  claimRelationships,
  db,
  debateClusters,
  researchGaps,
  researchHypotheses,
  researchHypothesisSources,
  researchHypothesisSupport,
  researchRevisions,
} from "@ice/db";
import { and, asc, eq, ne, or, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// generate_hypotheses (Phase 27.2): conflict context, novelty corpus reads,
// job-level idempotency, and the hypothesis/support/gap/revision writes.
// ---------------------------------------------------------------------------

export interface ConflictRelationshipRow {
  id: string;
  claimLoId: string;
  claimHiId: string;
  valence: string;
  category: string;
  explanation: string;
  resolution: string;
}

/** Every UNDISPUTED contradiction/nuance `claim_relationship` in a project's
 *  scope — the hypothesis prompt's entire `[CONFLICT_N]` input population.
 *  `verification_status <> 'disputed'` excludes exactly what the plan calls
 *  for: a conflict the user has already dismissed must never be handed to
 *  the model as if it were live tension worth hypothesizing about. `support`
 *  and `unrelated` edges are excluded by construction (only two valences are
 *  ever conflicts in this pipeline's vocabulary). */
export async function loadUndisputedConflictRelationshipsForProject(userId: string, projectId: string): Promise<ConflictRelationshipRow[]> {
  return db
    .select({
      id: claimRelationships.id,
      claimLoId: claimRelationships.claimLoId,
      claimHiId: claimRelationships.claimHiId,
      valence: claimRelationships.valence,
      category: claimRelationships.category,
      explanation: claimRelationships.explanation,
      resolution: claimRelationships.resolution,
    })
    .from(claimRelationships)
    .where(
      and(
        eq(claimRelationships.userId, userId),
        eq(claimRelationships.projectId, projectId),
        eq(claimRelationships.status, "active"),
        eq(claimRelationships.hidden, false),
        ne(claimRelationships.verificationStatus, "disputed"),
        or(eq(claimRelationships.valence, "contradiction"), eq(claimRelationships.valence, "nuance")),
      ),
    )
    // `limits.ts`'s `MAX_CONFLICTS_FOR_HYPOTHESIS_CONTEXT` doc comment
    // promises "the highest-value context still makes it in (the caller
    // ranks before truncating)" — but `generateHypotheses.ts` only ever
    // `.slice(0, MAX_CONFLICTS_FOR_HYPOTHESIS_CONTEXT)`s this row set with no
    // sort of its own, so without an ORDER BY here the promise was false: a
    // truncation dropped rows in whatever order Postgres happened to return
    // them, not the strongest ones (27.2 merge-gate adversarial finding,
    // D-25-7 sibling). `claim_relationship` carries no literal `confidence`
    // column, so `evidence_gap` — the differential between the two claims'
    // `claim_score` rows, this table's own numeric measure of how decisively
    // one side outweighs the other — is the closest real proxy for
    // conflict-strength ranking; nulls (either claim lacked a score on the
    // judged dimension) sort last rather than first or arbitrarily. `id` is
    // the final tiebreaker purely for deterministic pagination/testing, not
    // because insertion order carries any meaning.
    .orderBy(sql`${claimRelationships.evidenceGap} DESC NULLS LAST`, asc(claimRelationships.id));
}

export interface ClusterGapCandidateRow {
  id: string;
  name: string;
  researchQuestion: string | null;
  counts: Record<string, number>;
}

/** Every ACTIVE `debate_cluster` in a project that still carries at least one
 *  unresolved contradiction edge — `research_gap`'s entire, deterministic
 *  input population (plan §Pipeline: "derive research_gap rows
 *  deterministically from clusters with unresolved contradictions"). The
 *  `counts.contradiction > 0` filter runs in application code (jsonb, small
 *  per-project row count — the same `bibliographic_record.raw`-style
 *  in-memory-filter precedent as `listResearchJobRequestsForProject`'s own
 *  doc comment explains) rather than a jsonb operator this codebase has
 *  already been bitten by once (drizzle's raw-`sql` array pitfall). */
export async function loadActiveClustersWithContradictions(userId: string, projectId: string): Promise<ClusterGapCandidateRow[]> {
  const rows = await db
    .select({ id: debateClusters.id, name: debateClusters.name, researchQuestion: debateClusters.researchQuestion, counts: debateClusters.counts })
    .from(debateClusters)
    .where(and(eq(debateClusters.userId, userId), eq(debateClusters.projectId, projectId), eq(debateClusters.status, "active")));
  return rows
    .map((r) => ({ ...r, counts: (r.counts as Record<string, number>) ?? {} }))
    .filter((r) => (r.counts.contradiction ?? 0) > 0);
}

export interface NewResearchHypothesis {
  question: string | null;
  statement: string;
  rationale: string;
  methodology: string;
  challenges: string[];
  grounding: "detected_conflicts" | "single_work_gaps";
  noveltyDistance: number | null;
  noveltyTier: "high" | "medium" | "low" | "unknown" | null;
  noveltyEmbeddingModel: string | null;
  noveltyCorpus: string | null;
  runHash: string;
  promptVersion: string;
  provider: string;
  model: string;
}

/** Inserts one hypothesis, respecting the `(user_id, run_hash)` unique — a
 *  hypothesis grounded in an unchanged conflict set, under an unchanged
 *  question/prompt/novelty-model, is never duplicated. Returns the inserted
 *  row's id, or null on a dedup hit (nothing further — source/support/
 *  revision rows — should be written for a dedup hit either, since they
 *  already exist from whichever run first inserted this exact hypothesis). */
export async function insertResearchHypothesis(userId: string, projectId: string, hyp: NewResearchHypothesis): Promise<string | null> {
  const [inserted] = await db
    .insert(researchHypotheses)
    .values({
      userId,
      projectId,
      question: hyp.question,
      statement: hyp.statement,
      rationale: hyp.rationale,
      methodology: hyp.methodology,
      challenges: hyp.challenges,
      grounding: hyp.grounding,
      noveltyDistance: hyp.noveltyDistance,
      noveltyTier: hyp.noveltyTier as (typeof researchHypotheses.$inferInsert)["noveltyTier"],
      noveltyEmbeddingModel: hyp.noveltyEmbeddingModel,
      noveltyCorpus: hyp.noveltyCorpus,
      runHash: hyp.runHash,
      promptVersion: hyp.promptVersion,
      provider: hyp.provider,
      model: hyp.model,
    })
    .onConflictDoNothing({ target: [researchHypotheses.userId, researchHypotheses.runHash] })
    .returning({ id: researchHypotheses.id });
  return inserted?.id ?? null;
}

/** Which real, validated `claim_relationship` ids a hypothesis cites — the
 *  label-then-validate pattern's durable record. */
export async function insertResearchHypothesisSources(hypothesisId: string, claimRelationshipIds: string[]): Promise<void> {
  if (claimRelationshipIds.length === 0) return;
  await db
    .insert(researchHypothesisSources)
    .values(claimRelationshipIds.map((claimRelationshipId) => ({ hypothesisId, claimRelationshipId })))
    .onConflictDoNothing({ target: [researchHypothesisSources.hypothesisId, researchHypothesisSources.claimRelationshipId] });
}

export interface HypothesisSupportTarget {
  workId: string | null;
  corpusItemId: string | null;
}

/** The distinct works/corpus items a hypothesis's cited conflicts touch —
 *  exactly one of `workId`/`corpusItemId` per target (the
 *  `research_hypothesis_support_exactly_one_target` XOR CHECK). */
export async function insertResearchHypothesisSupport(hypothesisId: string, targets: HypothesisSupportTarget[]): Promise<void> {
  if (targets.length === 0) return;
  await db
    .insert(researchHypothesisSupport)
    .values(targets.map((t) => ({ hypothesisId, workId: t.workId, corpusItemId: t.corpusItemId })))
    .onConflictDoNothing();
}

/** The immutable revision-0 "generated" snapshot for a hypothesis — the
 *  `research_revision` spine's first writer (no earlier lane has written to
 *  this table yet). `before: null`/`action: 'generated'`/`editor: 'system'`
 *  is the only shape `research_revision_no_auto_endorsement` accepts from
 *  the system. */
export async function insertGeneratedHypothesisRevision(userId: string, hypothesisId: string, snapshot: unknown): Promise<void> {
  await db
    .insert(researchRevisions)
    .values({
      userId,
      objectType: "hypothesis",
      researchHypothesisId: hypothesisId,
      revision: 0,
      action: "generated",
      before: null,
      after: snapshot,
      editor: "system",
    })
    .onConflictDoNothing({
      target: [researchRevisions.researchHypothesisId, researchRevisions.revision],
      where: sql`${researchRevisions.researchHypothesisId} is not null`,
    });
}

/** The immutable revision-0 "generated" snapshot for a gap — same shape as
 *  the hypothesis revision above, targeting the gap branch instead. */
export async function insertGeneratedGapRevision(userId: string, gapId: string, snapshot: unknown): Promise<void> {
  await db
    .insert(researchRevisions)
    .values({
      userId,
      objectType: "gap",
      researchGapId: gapId,
      revision: 0,
      action: "generated",
      before: null,
      after: snapshot,
      editor: "system",
    })
    .onConflictDoNothing({
      target: [researchRevisions.researchGapId, researchRevisions.revision],
      where: sql`${researchRevisions.researchGapId} is not null`,
    });
}

export interface NewResearchGap {
  debateClusterId: string;
  description: string;
  unresolvedContradictionCount: number;
}

export interface UpsertResearchGapResult {
  id: string;
  /** False when this exact `(user_id, debate_cluster_id)` already existed —
   *  the row was refreshed (description/count re-templated) rather than
   *  re-inserted, the `upsertResearchCorpusItem`/`reactivateDebateCluster`
   *  precedent combined. */
  wasNew: boolean;
}

/** Idempotent upsert on the `(user_id, debate_cluster_id)` unique — a re-run
 *  over an unchanged cluster refreshes (never duplicates) the gap row. */
export async function upsertResearchGap(userId: string, projectId: string, gap: NewResearchGap): Promise<UpsertResearchGapResult> {
  const [inserted] = await db
    .insert(researchGaps)
    .values({
      userId,
      projectId,
      debateClusterId: gap.debateClusterId,
      description: gap.description,
      unresolvedContradictionCount: gap.unresolvedContradictionCount,
    })
    .onConflictDoNothing({ target: [researchGaps.userId, researchGaps.debateClusterId] })
    .returning({ id: researchGaps.id });
  if (inserted) return { id: inserted.id, wasNew: true };

  const [existing] = await db
    .select({ id: researchGaps.id })
    .from(researchGaps)
    .where(and(eq(researchGaps.userId, userId), eq(researchGaps.debateClusterId, gap.debateClusterId)))
    .limit(1);
  if (!existing) {
    throw new Error(`Research gap upsert conflicted on debateClusterId ${gap.debateClusterId} but no existing row was found.`);
  }
  await db
    .update(researchGaps)
    .set({ description: gap.description, unresolvedContradictionCount: gap.unresolvedContradictionCount, status: "active", updatedAt: new Date() })
    .where(eq(researchGaps.id, existing.id));
  return { id: existing.id, wasNew: false };
}
