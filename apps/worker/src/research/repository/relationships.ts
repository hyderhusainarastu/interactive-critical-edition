import {
  claimLoci,
  claimPairCandidates,
  claimRelationships,
  db,
  researchClaimEmbeddings,
  researchClaims,
  researchCorpusItems,
  works,
} from "@ice/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";

export interface ScopedClaimRow {
  id: string;
  userId: string;
  /** Exactly one of `workId`/`corpusItemId` is non-null (the
   *  `research_claim_exactly_one_source` CHECK) — both are carried here
   *  (rather than narrowed to a single required field the way this row used
   *  to be) so `detectRelationships.ts` can tell the two source kinds apart
   *  for cross-source pairing and citation-engagement resolution. */
  workId: string | null;
  corpusItemId: string | null;
  claimText: string;
  claimNature: string;
}

/** Active, non-hidden claims across a set of works AND/OR corpus items —
 *  Stage-1 retrieval's entire input population. Owner-scoped by `userId` as
 *  a second, independent guard on the actual claim rows returned (not just
 *  relied on transitively via `loadProjectWorkIds`/`loadProjectCorpusItemIds`'s
 *  own ownership checks) — the same defense-in-depth the rest of this file's
 *  owner-scoped reads apply. Either id array may be empty (a project with
 *  only corpus-item members, or only work members); both empty returns `[]`
 *  without querying. */
export async function loadScopedClaimsForRelationshipDetection(
  userId: string,
  workIds: string[],
  corpusItemIds: string[] = [],
): Promise<ScopedClaimRow[]> {
  if (workIds.length === 0 && corpusItemIds.length === 0) return [];
  const sourceConditions = [];
  if (workIds.length > 0) sourceConditions.push(inArray(researchClaims.workId, workIds));
  if (corpusItemIds.length > 0) sourceConditions.push(inArray(researchClaims.corpusItemId, corpusItemIds));

  const rows = await db
    .select({
      id: researchClaims.id,
      userId: researchClaims.userId,
      workId: researchClaims.workId,
      corpusItemId: researchClaims.corpusItemId,
      claimText: researchClaims.claimText,
      claimNature: researchClaims.claimNature,
    })
    .from(researchClaims)
    .where(
      and(
        eq(researchClaims.userId, userId),
        or(...sourceConditions),
        eq(researchClaims.status, "active"),
        eq(researchClaims.hidden, false),
      ),
    );
  return rows;
}

/** Embedding vectors for a set of claims, filtered to ONE model — "the
 *  ACTIVE model" (plan §Pipeline "Three-channel Stage 1"). A claim without a
 *  row here (never embedded, or embedded under a since-changed model)
 *  simply has no dense-channel entry — it still participates via BM25/locus,
 *  never silently dropped from retrieval altogether. */
export async function loadClaimEmbeddingsForModel(claimIds: string[], model: string): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (claimIds.length === 0) return out;
  const rows = await db
    .select({ claimId: researchClaimEmbeddings.claimId, embedding: researchClaimEmbeddings.embedding })
    .from(researchClaimEmbeddings)
    .where(and(inArray(researchClaimEmbeddings.claimId, claimIds), eq(researchClaimEmbeddings.model, model)));
  for (const row of rows) out.set(row.claimId, row.embedding as unknown as number[]);
  return out;
}

export interface ClaimLocusRow {
  claimId: string;
  locusKey: string;
}

/** Every distinct `(claimId, locusKey)` a set of claims carries, collapsed
 *  across origins (`excerpt`/`block`/`footnote`/`citation`) — the locus
 *  retrieval channel only cares THAT a claim is anchored at a given locus,
 *  not which origin(s) corroborated it. */
export async function loadDistinctClaimLoci(claimIds: string[]): Promise<ClaimLocusRow[]> {
  if (claimIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ claimId: claimLoci.claimId, locusKey: claimLoci.locusKey })
    .from(claimLoci)
    .where(inArray(claimLoci.claimId, claimIds));
  return rows;
}

export interface NewClaimPairCandidate {
  claimLoId: string;
  claimHiId: string;
  retrievalSources: { channel: string; score: number }[];
  bestRetrievalScore: number;
  engagement: string;
  engagementEvidence: Record<string, unknown> | null;
}

/** Idempotent bulk insert on the `(user_id, claim_lo_id, claim_hi_id)`
 *  unique — a re-run over an unchanged claim set inserts zero new rows.
 *  Returns how many rows were ACTUALLY new (not how many were attempted),
 *  which is what makes the "repeat run costs nothing new" canary assertion
 *  meaningful. */
export async function insertClaimPairCandidates(userId: string, projectId: string, candidates: NewClaimPairCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;
  const inserted = await db
    .insert(claimPairCandidates)
    .values(
      candidates.map((c) => ({
        userId,
        projectId,
        claimLoId: c.claimLoId,
        claimHiId: c.claimHiId,
        retrievalSources: c.retrievalSources,
        bestRetrievalScore: c.bestRetrievalScore,
        engagement: c.engagement as (typeof claimPairCandidates.$inferInsert)["engagement"],
        engagementEvidence: c.engagementEvidence,
      })),
    )
    .onConflictDoNothing({ target: [claimPairCandidates.userId, claimPairCandidates.claimLoId, claimPairCandidates.claimHiId] })
    .returning({ id: claimPairCandidates.id });
  return inserted.length;
}

// ---------------------------------------------------------------------------
// detect_relationships JUDGE stage (Phase 26.2b).
// ---------------------------------------------------------------------------

export interface CandidatePairRow {
  id: string;
  claimLoId: string;
  claimHiId: string;
  bestRetrievalScore: number;
  engagement: string;
  engagementEvidence: Record<string, unknown> | null;
}

/** Every persisted `claim_pair_candidate` for a project — the judge stage's
 *  entire input population, ranked by `bestRetrievalScore` (descending) so a
 *  caller applying `RETRIEVAL_LIMITS.maxJudgedPairsPerRequest` drops the
 *  weakest candidates first, matching Stage-1's own truncation discipline. */
export async function loadClaimPairCandidatesForProject(userId: string, projectId: string): Promise<CandidatePairRow[]> {
  const rows = await db
    .select({
      id: claimPairCandidates.id,
      claimLoId: claimPairCandidates.claimLoId,
      claimHiId: claimPairCandidates.claimHiId,
      bestRetrievalScore: claimPairCandidates.bestRetrievalScore,
      engagement: claimPairCandidates.engagement,
      engagementEvidence: claimPairCandidates.engagementEvidence,
    })
    .from(claimPairCandidates)
    .where(and(eq(claimPairCandidates.userId, userId), eq(claimPairCandidates.projectId, projectId)))
    .orderBy(sql`${claimPairCandidates.bestRetrievalScore} desc`);
  return rows.map((r) => ({ ...r, engagementEvidence: r.engagementEvidence as Record<string, unknown> | null }));
}

export interface ClaimJudgeDetail {
  id: string;
  workId: string | null;
  corpusItemId: string | null;
  /** The owning WORK's title, or the owning CORPUS ITEM's title when
   *  `workId` is null — kept as one field (not split into two) because
   *  `JudgeClaimInput.workTitle` (`@ice/claims`'s judge-prompt contract) is a
   *  single generic "name this source" slot the prompt's "Work A: <title>"
   *  framing applies to either kind of source equally; renaming that pure
   *  package's field for one caller wasn't worth the churn. */
  workTitle: string;
  claimText: string;
  supportingExcerpt: string;
  claimNature: string;
}

/** Judge-input detail for a set of claims — text, excerpt, nature, and the
 *  owning source's title, whether that source is a work or a corpus item
 *  (Phase 30 fix lane, D-25-13 — corpus-item-sourced claims used to be
 *  silently absent here since Stage 1 retrieval never surfaced one before
 *  this lane; now that it can, both `leftJoin`s below are exercised for
 *  real). Exactly one of the two joins matches per row (the
 *  `research_claim_exactly_one_source` CHECK), so `workId ? workTitle :
 *  corpusItemTitle` always resolves to a real title; a row where somehow
 *  neither did is skipped defensively rather than inserted with an empty
 *  display title. */
export async function loadClaimJudgeDetails(claimIds: string[]): Promise<Map<string, ClaimJudgeDetail>> {
  const out = new Map<string, ClaimJudgeDetail>();
  if (claimIds.length === 0) return out;
  const rows = await db
    .select({
      id: researchClaims.id,
      workId: researchClaims.workId,
      corpusItemId: researchClaims.corpusItemId,
      workTitle: works.title,
      corpusItemTitle: researchCorpusItems.title,
      claimText: researchClaims.claimText,
      supportingExcerpt: researchClaims.supportingExcerpt,
      claimNature: researchClaims.claimNature,
    })
    .from(researchClaims)
    .leftJoin(works, eq(works.id, researchClaims.workId))
    .leftJoin(researchCorpusItems, eq(researchCorpusItems.id, researchClaims.corpusItemId))
    .where(inArray(researchClaims.id, claimIds));
  for (const row of rows) {
    const title = row.workId ? row.workTitle : row.corpusItemTitle;
    if (!title) continue;
    out.set(row.id, {
      id: row.id,
      workId: row.workId,
      corpusItemId: row.corpusItemId,
      workTitle: title,
      claimText: row.claimText,
      supportingExcerpt: row.supportingExcerpt,
      claimNature: row.claimNature,
    });
  }
  return out;
}

export interface ExistingRelationshipKey {
  claimLoId: string;
  claimHiId: string;
  basisHash: string;
}

/** Every `claim_relationship` row already covering one of the given claim
 *  ids, for THIS user — the judge stage's "already judged under an
 *  unchanged world" check. Not project-scoped: `claim_relationship`'s own
 *  dedup unique is `(user_id, claim_lo_id, claim_hi_id, basis_hash)`, with no
 *  project_id in it (the same claim pair surfacing in two different
 *  projects is still one judgment, not two) — so this reads by claim id
 *  membership, matching the real key rather than narrowing by project and
 *  silently re-paying for a pair another project already judged. */
export async function loadExistingRelationshipKeys(userId: string, claimIds: string[]): Promise<ExistingRelationshipKey[]> {
  if (claimIds.length === 0) return [];
  return db
    .select({ claimLoId: claimRelationships.claimLoId, claimHiId: claimRelationships.claimHiId, basisHash: claimRelationships.basisHash })
    .from(claimRelationships)
    .where(
      and(
        eq(claimRelationships.userId, userId),
        inArray(claimRelationships.claimLoId, claimIds),
        inArray(claimRelationships.claimHiId, claimIds),
      ),
    );
}

export interface NewClaimRelationship {
  claimLoId: string;
  claimHiId: string;
  valence: string;
  category: string;
  judgeBranch: string;
  strongerSide: string;
  explanation: string;
  resolution: string;
  engagement: string;
  evidenceGap: number | null;
  evidenceGapDimension: string | null;
  basisHash: string;
  promptVersion: string;
  provider: string;
  model: string;
}

/** Idempotent insert on the `(user_id, claim_lo_id, claim_hi_id, basis_hash)`
 *  unique — a re-run that recomputes the SAME basis hash for a pair already
 *  judged inserts nothing new (the "repeat run costs $0" canary guarantee).
 *  `mechanism` is never accepted as a parameter here: Stage 1's DB enum only
 *  contains `'unspecified'`, and this lane never persists it (see
 *  `detectRelationships.ts`'s judge-stage doc comment) — the column is left
 *  at its SQL-level NULL default. Returns the inserted row's id, or null on
 *  a dedup hit. */
export async function insertClaimRelationship(userId: string, projectId: string, rel: NewClaimRelationship): Promise<string | null> {
  const [inserted] = await db
    .insert(claimRelationships)
    .values({
      userId,
      projectId,
      claimLoId: rel.claimLoId,
      claimHiId: rel.claimHiId,
      valence: rel.valence as (typeof claimRelationships.$inferInsert)["valence"],
      category: rel.category as (typeof claimRelationships.$inferInsert)["category"],
      judgeBranch: rel.judgeBranch as (typeof claimRelationships.$inferInsert)["judgeBranch"],
      strongerSide: rel.strongerSide as (typeof claimRelationships.$inferInsert)["strongerSide"],
      explanation: rel.explanation,
      resolution: rel.resolution,
      engagement: rel.engagement as (typeof claimRelationships.$inferInsert)["engagement"],
      evidenceGap: rel.evidenceGap,
      evidenceGapDimension: rel.evidenceGapDimension as (typeof claimRelationships.$inferInsert)["evidenceGapDimension"],
      basisHash: rel.basisHash,
      promptVersion: rel.promptVersion,
      provider: rel.provider,
      model: rel.model,
    })
    .onConflictDoNothing({
      target: [claimRelationships.userId, claimRelationships.claimLoId, claimRelationships.claimHiId, claimRelationships.basisHash],
    })
    .returning({ id: claimRelationships.id });
  return inserted?.id ?? null;
}
