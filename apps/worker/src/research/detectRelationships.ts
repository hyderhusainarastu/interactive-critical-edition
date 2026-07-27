import {
  Bm25Index,
  JUDGE_OUTPUT_SCHEMA,
  JUDGE_PROMPT_VERSION,
  RETRIEVAL_LIMITS,
  RETRIEVAL_THRESHOLDS,
  assertThresholdsCalibratedFor,
  buildJudgePrompt,
  computeRelationshipBasisHash,
  locusPairs,
  pairwiseCosineUpperTriangular,
  parseDetectRelationshipsScope,
  sectionPairs,
  unionCandidates,
  validateJudgeResponse,
  type BuildJudgePromptInput,
  type CandidatePair,
  type ChannelPair,
  type ClaimLocus,
  type EngagementContext,
  type JudgeResult,
} from "@ice/claims";
import { AnthropicTextJsonClient, OpenAIResponsesClient, TASK_ROUTES, resolveEmbeddingProvider, safetyIdentifierFor, type EmbeddingProvider } from "@ice/ai-adapters";
import { canAfford, overSoftCap, type StructuredCaller } from "@ice/research";
import * as repo from "./repository";
import { loadCitationEngagementDoisForWorks, loadCitationEngagementProfiles, loadWorkNormalizedTitles, resolveEngagementForClaims } from "./citationEngagement";
import type { ResearchJobOutcome, ResearchJobRunContext } from "./jobRunner";

/**
 * detect_relationships handler — BOTH stages now: Stage-1 candidate
 * retrieval (Phase 26.2a, plan §Pipeline "Three-channel Stage 1" /
 * "Citation-graph engagement": dense cosine ∪ BM25 ∪ locus, plus the $0
 * citation-graph engagement pre-join, persisted as `claim_pair_candidate`
 * rows) AND the PAID judge stage (Phase 26.2b, `@ice/claims`'s
 * `prompts/judge.ts`) that turns those candidates into `claim_relationship`
 * rows. One handler, one job type, run within the SAME `analyze-claim-
 * debates` queue request that `packages/db/src/queue.ts`'s doc comment
 * describes ("relationship detection AND clustering as one staged,
 * resumable request") — Stage 1 always re-runs first (idempotent,
 * insert-wise a no-op over an unchanged claim set), then the judge stage
 * operates over EVERY persisted candidate for the project, not just this
 * run's newly-inserted ones, so a candidate stranded unjudged by a prior
 * run's budget cap or provider failure is picked back up automatically.
 *
 * Judge branch is `'empirical'` for every pair in this lane — the
 * humanities branch (`@ice/claims`'s `taxonomy.ts` stage-2 mechanisms) stays
 * gated behind its own eval (plan §Program 27.3) regardless of either
 * claim's `claim_nature`. `mechanism` is therefore never written as
 * anything other than SQL NULL here: Stage 1's `claim_relation_mechanism`
 * DB enum contains only `'unspecified'`, and even a validated Stage-2
 * mechanism value from `validateJudgeResponse` (theoretically possible if a
 * model free-associates one despite never being asked, since the empirical
 * branch's prompt never requests the `mechanism` field) is DROPPED before
 * insert rather than attempted — inserting anything else would violate the
 * `claim_relationship_mechanism_matches_valence` CHECK outright.
 */

/** Opaque cross-SOURCE grouping key for one claim (Phase 30 fix lane,
 *  D-25-13): `work:<id>` or `corpus:<id>`, exactly one of which applies per
 *  the `research_claim_exactly_one_source` CHECK. Every retrieval channel
 *  below that used to compare `.workId` for "is this a different source"
 *  now compares this instead, so a corpus-item claim participates in
 *  candidate pairing on equal footing with a work claim — cross-work pairs
 *  behave exactly as before (this is just `work:<id>` either way), work<->
 *  corpus-item pairs are now included, and two claims from the SAME corpus
 *  item are excluded the same way two claims from the same work always
 *  were. */
export function claimSourceKey(claim: { workId: string | null; corpusItemId: string | null }): string {
  return claim.workId ? `work:${claim.workId}` : `corpus:${claim.corpusItemId}`;
}

/** `author:work-slug:locus` → `author:work-slug` (drops the specific locus,
 *  keeping only the classical work identity) — the section-level "same
 *  work, not necessarily the same passage" retrieval channel
 *  (`RETRIEVAL_THRESHOLDS.locusSectionScore`). `claim_locus` stores only the
 *  full column-level key (plan §Schema `canonicalLocusKey` contract), so
 *  this is the coarsest unit derivable from it without a separate stored
 *  section column — two claims sharing a classical WORK even at different
 *  loci are still real evidence they discuss the same text. */
export function deriveSectionKey(locusKey: string): string {
  const parts = locusKey.split(":");
  return parts.length >= 2 ? parts.slice(0, 2).join(":") : locusKey;
}

/**
 * Self-contained BM25 candidate channel over a claim population (pure,
 * exported for unit testing without a DB). One `Bm25Index` over every
 * claim's text; each claim queries the index for its own top matches
 * (`RETRIEVAL_THRESHOLDS.bm25TopK`), keeping only cross-SOURCE matches at or
 * above `bm25MinScore` — `sourceKey` (`claimSourceKey`'s output) rather than
 * a raw `workId`, so a work claim vs. a corpus-item claim counts as
 * cross-source too, and two claims from the SAME corpus item are excluded
 * exactly like two claims from the same work always were (Phase 30 fix
 * lane, D-25-13). BM25 relevance is directionally asymmetric (`query(A)`
 * finding `B` can score differently than `query(B)` finding `A`), so both
 * directions are computed and the MAX of the two scores is kept per
 * unordered pair — one `ChannelPair` per pair, not two.
 */
export function computeBm25CandidatePairs(claims: { id: string; sourceKey: string; claimText: string }[]): ChannelPair[] {
  if (claims.length < 2) return [];
  const index = new Bm25Index(claims.map((c) => c.claimText));
  const bestByPair = new Map<string, number>();

  for (let i = 0; i < claims.length; i++) {
    const matches = index.query(claims[i].claimText, RETRIEVAL_THRESHOLDS.bm25TopK);
    for (const match of matches) {
      if (match.docIndex === i) continue; // a claim always matches its own text most strongly — exclude self
      if (match.score < RETRIEVAL_THRESHOLDS.bm25MinScore) continue;
      const other = claims[match.docIndex];
      if (other.sourceKey === claims[i].sourceKey) continue; // cross-source only

      const [loId, hiId] = [claims[i].id, other.id].sort();
      const key = `${loId} ${hiId}`;
      const prior = bestByPair.get(key);
      if (prior === undefined || match.score > prior) bestByPair.set(key, match.score);
    }
  }

  return [...bestByPair.entries()].map(([key, score]) => {
    const [loId, hiId] = key.split(" ");
    return { loId, hiId, channel: "bm25", score };
  });
}

export interface DetectRelationshipsOutcome extends ResearchJobOutcome {
  claimsInScope: number;
  candidatesFound: number;
  candidatesPersisted: number;
  channelCounts: { dense: number; bm25: number; locus: number; locusSection: number };
  /** How many `claim_pair_candidate` rows the judge stage newly turned into a `claim_relationship` row THIS run. */
  judged: number;
  /** How many candidates already had a `claim_relationship` row under the CURRENT basis hash — a $0 skip. */
  alreadyJudged: number;
  /** How many candidates were attempted but the judge call itself failed (both providers, or the sole configured one) — left for the next run to retry. */
  judgeFailed: number;
  /** How many candidates still lack a `claim_relationship` row after this run (capped-away + budget-stopped + failed) — the honest "judge stage not yet complete" count. */
  candidatesAwaitingJudgment: number;
  concerns: string[];
}

// ---------------------------------------------------------------------------
// JUDGE STAGE (Phase 26.2b) — turns a persisted `claim_pair_candidate` into
// a `claim_relationship` row via a real model call. Every helper below is
// exported for direct unit testing without a DB.
// ---------------------------------------------------------------------------

/** Every judge call in this lane runs the empirical branch — see this
 *  file's top doc comment for why the humanities branch never activates
 *  here regardless of either claim's `claim_nature`. */
export const JUDGE_BRANCH = "empirical" as const;

// Conservative per-pair upper bound (claude-haiku-4-5 or gpt-5.4-nano, a
// short prompt with no few-shot examples — JUDGE_PROMPT_VERSION's v3
// baseline — plus a short JSON reply) — the `CHUNK_COST_ESTIMATE_USD`
// precedent from `extractClaims.ts`.
const JUDGE_COST_ESTIMATE_USD = 0.01;
const JUDGE_MAX_OUTPUT_TOKENS = 600;
const JUDGE_SYSTEM_PROMPT =
  "You are an expert academic judge comparing two claims from different scholarly works. " +
  "Follow the instructions in the user message exactly and return only the JSON requested.";

/** Structural shape of `AnthropicTextJsonClient` (packages/ai-adapters), kept
 *  as a standalone interface — not an import of the class itself as a type —
 *  so a test can inject a plain object mock without constructing the real
 *  client (the `StructuredCaller` precedent from `packages/research`). */
export interface JudgeAnthropicCaller {
  available: boolean;
  call<T>(params: {
    model: string;
    system: string;
    user: string;
    maxOutputTokens?: number;
    validate: (parsed: unknown) => T;
  }): Promise<
    | { ok: true; data: T; model: string; promptTokens: number; completionTokens: number }
    | { ok: false; error: string; model: string; promptTokens: number; completionTokens: number }
  >;
}

/**
 * Decides what engagement context (if any) to hand the judge prompt, and
 * whether the two claims need to swap which one is "Work A" so
 * `engagementBlock`'s calibrated "Work A explicitly cites Work B" framing
 * (`@ice/claims`'s `prompts/judge.ts`) stays literally accurate for the
 * ACTUAL citing direction rather than always assuming lo cites hi.
 *
 * `direct_citation`: swap so the citing work is always "A" when the
 * evidence names a direction; default (no swap) when the direction can't be
 * read back out of the stored evidence. `reciprocal_citation`: both
 * directions hold, so no swap is needed for the framing to stay true either
 * way. `shared_citation`/`none_detected`: the calibrated framing text only
 * exists for a confirmed citation LINK — Phase 25.5b's robustness sub-check
 * (docs/eval/research-claims/spike-25-5-judge.md) found supplying
 * engagement context is only safe "when engagement exists" (a citation, not
 * merely a shared reference), so these two omit it entirely rather than
 * render an inaccurate claim.
 *
 * `loWorkId`/`hiWorkId` are nullable (Phase 30 fix lane, D-25-13): a
 * corpus-item-sourced claim has no `workId` at all. The comparison below
 * still resolves correctly without special-casing that — `citingWorkId` is
 * always a real work id (only a work can be the citer;
 * `resolveWorkCorpusItemEngagement` in `citationEngagement.ts` never
 * derives the reverse direction), so it can only ever equal whichever side
 * actually has a non-null `workId`, and never equals `null`.
 */
export function buildJudgeEngagementContext(
  engagement: string,
  engagementEvidence: Record<string, unknown> | null,
  loWorkId: string | null,
  hiWorkId: string | null,
): { context?: EngagementContext; swapToHiFirst: boolean } {
  if (engagement === "direct_citation") {
    const citingWorkId = typeof engagementEvidence?.citingWorkId === "string" ? (engagementEvidence.citingWorkId as string) : null;
    return { context: { kind: "direct_citation" }, swapToHiFirst: citingWorkId === hiWorkId };
  }
  if (engagement === "reciprocal_citation") {
    return { context: { kind: "direct_citation" }, swapToHiFirst: false };
  }
  return { context: undefined, swapToHiFirst: false };
}

/** Maps `JudgeResult.strongerEvidence` ("paper_a"/"paper_b"/"neither") back
 *  onto the ordered (lo, hi) pair, honoring whichever claim was actually
 *  sent to the judge as "A" (`swapToHiFirst` from
 *  `buildJudgeEngagementContext`) — never assumes A is always lo. */
export function mapStrongerSide(strongerEvidence: JudgeResult["strongerEvidence"], swapToHiFirst: boolean): "lo" | "hi" | "neither" {
  if (strongerEvidence === "neither") return "neither";
  const aIsLo = !swapToHiFirst;
  if (strongerEvidence === "paper_a") return aIsLo ? "lo" : "hi";
  return aIsLo ? "hi" : "lo";
}

const EVIDENCE_GAP_MIN_MAGNITUDE = 0.1;
const EVIDENCE_GAP_DIMENSION_PRIORITY = ["evidence_strength", "textual_support"] as const;

/**
 * A computed differential between the two claims' `claim_score` rows ON THE
 * SAME dimension (plan §Schema `claim_relationship.evidence_gap`) — never
 * comparing an `evidence_strength` score against a `textual_support` one.
 * `evidence_strength` is tried first (the natural fit for this lane's
 * empirical-branch-only judging) and `textual_support` second; a dimension
 * only reports when BOTH claims were scored on it AND the gap clears
 * `EVIDENCE_GAP_MIN_MAGNITUDE` (below that, `evidenceGap`'s own tie
 * convention in `@ice/claims`'s `scoring/evidenceStrength.ts` treats the two
 * as not meaningfully different) — otherwise this returns null, the honest
 * "no gap to report" the schema's own doc comment describes.
 */
export function computeEvidenceGapForPair(loScores: repo.ClaimScoreRow[], hiScores: repo.ClaimScoreRow[]): { gap: number; dimension: string } | null {
  for (const dimension of EVIDENCE_GAP_DIMENSION_PRIORITY) {
    const loScore = loScores.find((s) => s.dimension === dimension);
    const hiScore = hiScores.find((s) => s.dimension === dimension);
    if (!loScore || !hiScore) continue;
    const gap = Math.round((loScore.score - hiScore.score) * 1000) / 1000;
    if (Math.abs(gap) <= EVIDENCE_GAP_MIN_MAGNITUDE) continue;
    return { gap, dimension };
  }
  return null;
}

interface JudgeCallSuccess {
  result: JudgeResult;
  provider: string;
  model: string;
}

/**
 * One judge call, preferred-then-alternate per `TASK_ROUTES.claim_relationship_judgment`
 * (`@ice/ai-adapters`'s `routing.ts`): anthropic/claude-haiku-4-5 via
 * `AnthropicTextJsonClient`'s raw-text-validated mode (the moderator-approved
 * production path — see that route's own doc comment for the full eval
 * history), falling back to openai's structured `JUDGE_OUTPUT_SCHEMA` path
 * only when no Anthropic key is configured OR the Anthropic call itself
 * fails after its own internal retries. Returns null (never fabricates)
 * when no provider is configured, or every attempted provider failed —
 * the caller's job is to skip the pair, not invent a verdict.
 */
export async function callJudge(
  ctx: ResearchJobRunContext,
  anthropic: JudgeAnthropicCaller,
  openai: StructuredCaller,
  input: BuildJudgePromptInput,
  safetyIdentifier: string,
): Promise<JudgeCallSuccess | null> {
  const route = TASK_ROUTES.claim_relationship_judgment;
  const prompt = buildJudgePrompt(input);

  if (anthropic.available) {
    const res = await anthropic.call({
      model: route.preferred.model,
      system: JUDGE_SYSTEM_PROMPT,
      user: prompt,
      maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
      validate: validateJudgeResponse,
    });
    if (res.promptTokens > 0 || res.completionTokens > 0) {
      await ctx.logUsage({
        task: "claim_relationship_judgment",
        stage: "judging-relationships",
        provider: "anthropic",
        model: res.model,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
      });
    }
    if (res.ok) return { result: res.data, provider: "anthropic", model: res.model };
    // Falls through to the openai alternate below — Anthropic's OWN internal
    // retries (`AnthropicTextJsonClient.call`, `MAX_RETRIES`) are already
    // exhausted, so this is a genuinely different provider attempt, not a
    // duplicate retry of the same one.
  }

  if (openai.available) {
    try {
      const res = await openai.call({
        model: route.alternate.model,
        schemaName: "claim_relationship_judgment",
        schema: JUDGE_OUTPUT_SCHEMA,
        system: JUDGE_SYSTEM_PROMPT,
        input: prompt,
        safetyIdentifier,
        maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
        validate: validateJudgeResponse,
      });
      await ctx.logUsage({
        task: "claim_relationship_judgment",
        stage: "judging-relationships",
        provider: "openai",
        model: res.model,
        promptTokens: res.promptTokens,
        completionTokens: res.completionTokens,
      });
      return { result: res.data, provider: "openai", model: res.model };
    } catch {
      // `OpenAIResponsesClient.call()` already retried (`MAX_RETRIES`) and
      // throws with no usable token count on final failure — nothing to
      // log, matching `extractOneChunk`'s own catch-and-skip precedent.
      return null;
    }
  }

  return null;
}

export interface JudgeStageOutcome {
  judged: number;
  alreadyJudged: number;
  judgeFailed: number;
  candidatesAwaitingJudgment: number;
  stoppedEarly: boolean;
  concerns: string[];
}

/**
 * Judges every `claim_pair_candidate` for a project that lacks a
 * `claim_relationship` row under the CURRENT basis hash — operates over the
 * project's ENTIRE persisted candidate set (not just this run's newly
 * inserted ones), which is what lets a candidate stranded unjudged by a
 * prior run's budget cap or provider outage get picked back up
 * automatically on the next `detect_relationships` invocation.
 */
export async function judgeCandidatePairsForProject(
  ctx: ResearchJobRunContext,
  projectId: string,
  anthropic: JudgeAnthropicCaller,
  openai: StructuredCaller,
): Promise<JudgeStageOutcome> {
  const concerns: string[] = [];
  const userId = ctx.request.userId;

  await ctx.setStage("loading-candidates-for-judging");
  const candidates = await repo.loadClaimPairCandidatesForProject(userId, projectId);
  if (candidates.length === 0) {
    return { judged: 0, alreadyJudged: 0, judgeFailed: 0, candidatesAwaitingJudgment: 0, stoppedEarly: false, concerns };
  }

  const claimIds = [...new Set(candidates.flatMap((c) => [c.claimLoId, c.claimHiId]))];
  const [claimDetails, existingKeys, claimScoresByClaim] = await Promise.all([
    repo.loadClaimJudgeDetails(claimIds),
    repo.loadExistingRelationshipKeys(userId, claimIds),
    repo.loadClaimScoresForClaims(claimIds),
  ]);
  const existingKeySet = new Set(existingKeys.map((k) => `${k.claimLoId} ${k.claimHiId} ${k.basisHash}`));

  interface PendingJudge {
    candidate: repo.CandidatePairRow;
    loClaim: repo.ClaimJudgeDetail;
    hiClaim: repo.ClaimJudgeDetail;
    basisHash: string;
  }
  const pending: PendingJudge[] = [];
  let missingClaimDetail = 0;
  for (const candidate of candidates) {
    const loClaim = claimDetails.get(candidate.claimLoId);
    const hiClaim = claimDetails.get(candidate.claimHiId);
    if (!loClaim || !hiClaim) {
      // A candidate whose claim was deleted/hidden (or, once Phase 28.2
      // lands, corpus-item-sourced) since Stage 1 found it — skip rather
      // than crash; there is nothing to judge.
      missingClaimDetail += 1;
      continue;
    }
    const basisHash = computeRelationshipBasisHash({
      loText: loClaim.claimText,
      loExcerpt: loClaim.supportingExcerpt,
      hiText: hiClaim.claimText,
      hiExcerpt: hiClaim.supportingExcerpt,
      promptVersion: JUDGE_PROMPT_VERSION,
      branch: JUDGE_BRANCH,
      engagement: candidate.engagement,
    });
    if (existingKeySet.has(`${candidate.claimLoId} ${candidate.claimHiId} ${basisHash}`)) continue;
    pending.push({ candidate, loClaim, hiClaim, basisHash });
  }
  if (missingClaimDetail > 0) {
    concerns.push(`${missingClaimDetail} candidate pair(s) skipped: a claim's detail could not be loaded.`);
  }
  const alreadyJudged = candidates.length - missingClaimDetail - pending.length;

  if (pending.length === 0) {
    return { judged: 0, alreadyJudged, judgeFailed: 0, candidatesAwaitingJudgment: 0, stoppedEarly: false, concerns };
  }

  if (!anthropic.available && !openai.available) {
    concerns.push(`No judge provider configured (neither ANTHROPIC_API_KEY nor OPENAI_API_KEY) — ${pending.length} candidate pair(s) left unjudged.`);
    return { judged: 0, alreadyJudged, judgeFailed: 0, candidatesAwaitingJudgment: pending.length, stoppedEarly: false, concerns };
  }

  const capped = pending.slice(0, RETRIEVAL_LIMITS.maxJudgedPairsPerRequest);
  if (pending.length > capped.length) {
    concerns.push(`Judging capped at ${RETRIEVAL_LIMITS.maxJudgedPairsPerRequest} pair(s) (found ${pending.length} awaiting judgment) — kept the highest-retrieval-score pairs.`);
  }

  const safetyIdentifier = safetyIdentifierFor(userId);
  let judged = 0;
  let judgeFailed = 0;
  let stoppedEarly = false;

  for (let i = 0; i < capped.length; i++) {
    if (overSoftCap(ctx.budget) || !canAfford(ctx.budget, JUDGE_COST_ESTIMATE_USD)) {
      stoppedEarly = true;
      concerns.push(`Judging stopped after ${i}/${capped.length} pair(s): cost budget reached.`);
      break;
    }
    await ctx.setStage("judging-relationships", { index: i + 1, total: capped.length });
    const { candidate, loClaim, hiClaim, basisHash } = capped[i];

    const { context: engagementContext, swapToHiFirst } = buildJudgeEngagementContext(
      candidate.engagement,
      candidate.engagementEvidence,
      loClaim.workId,
      hiClaim.workId,
    );
    const claimAInput = swapToHiFirst ? { text: hiClaim.claimText, workTitle: hiClaim.workTitle } : { text: loClaim.claimText, workTitle: loClaim.workTitle };
    const claimBInput = swapToHiFirst ? { text: loClaim.claimText, workTitle: loClaim.workTitle } : { text: hiClaim.claimText, workTitle: hiClaim.workTitle };

    const outcome = await callJudge(
      ctx,
      anthropic,
      openai,
      { claimA: claimAInput, claimB: claimBInput, branch: JUDGE_BRANCH, engagement: engagementContext },
      safetyIdentifier,
    );
    if (!outcome) {
      judgeFailed += 1;
      continue;
    }

    const strongerSide = mapStrongerSide(outcome.result.strongerEvidence, swapToHiFirst);
    const gap = computeEvidenceGapForPair(claimScoresByClaim.get(loClaim.id) ?? [], claimScoresByClaim.get(hiClaim.id) ?? []);

    const insertedId = await repo.insertClaimRelationship(userId, projectId, {
      claimLoId: candidate.claimLoId,
      claimHiId: candidate.claimHiId,
      valence: outcome.result.relationship,
      category: outcome.result.category,
      judgeBranch: JUDGE_BRANCH,
      strongerSide,
      explanation: outcome.result.explanation,
      resolution: outcome.result.resolution,
      engagement: candidate.engagement,
      evidenceGap: gap?.gap ?? null,
      evidenceGapDimension: gap?.dimension ?? null,
      basisHash,
      promptVersion: JUDGE_PROMPT_VERSION,
      provider: outcome.provider,
      model: outcome.model,
    });
    if (insertedId) {
      judged += 1;
    } else {
      // Genuinely unreachable in single-worker execution (this exact basis
      // hash was just confirmed absent above) — recorded rather than
      // silently miscounted, in case a future concurrent-worker change
      // makes it reachable.
      concerns.push(`Pair ${candidate.claimLoId}/${candidate.claimHiId} was already judged under an identical basis hash by a concurrent run.`);
    }
  }

  const candidatesAwaitingJudgment = pending.length - judged;
  await ctx.setStage("judged", { index: capped.length, total: pending.length });

  return { judged, alreadyJudged, judgeFailed, candidatesAwaitingJudgment, stoppedEarly, concerns };
}

/**
 * The testable retrieval+engagement core. All DB access goes through
 * `repository.ts`/`citationEngagement.ts` — nothing here is a raw query — so
 * this stays a thin orchestration layer over already-unit-tested pure
 * pieces (`@ice/claims`'s retrieval channels, `resolveEngagement`).
 *
 * `embedder` is DI'd (the `extractClaimsForWork(caller, embedder, ...)`
 * precedent) rather than hardcoding `resolveEmbeddingProvider()` inline —
 * this handler never calls `embedBatch` (it only READS pre-existing
 * `research_claim_embedding` rows filtered to `embedder.model`), so there is
 * no cost implication either way, but DI keeps the dense-channel-present-vs-
 * absent behavior deterministically testable regardless of whatever API
 * keys happen to be in the ambient environment a test runs under.
 */
export async function detectRelationshipsForProject(
  ctx: ResearchJobRunContext,
  projectId: string,
  embedder: EmbeddingProvider = resolveEmbeddingProvider(),
  anthropic: JudgeAnthropicCaller = new AnthropicTextJsonClient(),
  openai: StructuredCaller = new OpenAIResponsesClient(),
): Promise<DetectRelationshipsOutcome> {
  const concerns: string[] = [];

  await ctx.setStage("loading-project-scope");
  const project = await repo.loadResearchProjectForUser(projectId, ctx.request.userId);
  if (!project) throw new Error(`Research project ${projectId} does not belong to the requesting user, or does not exist.`);

  // Phase 30 fix lane (D-25-13): scope now folds in BOTH work AND
  // corpus-item project members — `loadScopedClaimsForRelationshipDetection`
  // returns the owner-scoped union of claims sourced from either.
  const [workIds, corpusItemIds] = await Promise.all([repo.loadProjectWorkIds(projectId), repo.loadProjectCorpusItemIds(projectId)]);

  await ctx.setStage("loading-claims");
  const claims = await repo.loadScopedClaimsForRelationshipDetection(ctx.request.userId, workIds, corpusItemIds);
  // Every retrieval channel below excludes same-SOURCE pairs (never same-work
  // AND never same-corpus-item) via this opaque key, computed once here.
  const claimsWithSource = claims.map((c) => ({ ...c, sourceKey: claimSourceKey(c) }));

  let candidatesFound = 0;
  let candidatesPersisted = 0;
  let channelCounts = { dense: 0, bm25: 0, locus: 0, locusSection: 0 };
  let stage1Note = `Only ${claims.length} claim(s) in scope across ${workIds.length} work(s) and ${corpusItemIds.length} corpus item(s) — nothing new to compare.`;

  // Stage 1 (dense/bm25/locus retrieval + candidate persistence) needs at
  // least two claims to find a pair at all — but the JUDGE stage below
  // still always runs regardless, over whatever `claim_pair_candidate` rows
  // already exist for this project (possibly from before the project's
  // scope shrank to fewer than two claims), so a prior run's stranded
  // candidates are never silently abandoned just because this run's Stage 1
  // has nothing new to find.
  if (claims.length >= 2) {
  // --- Dense channel (pgvector cosine, calibrated denseMin) ---
  let densePairs: ChannelPair[] = [];
  if (embedder.available) {
    await ctx.setStage("dense-retrieval");
    // Fails loudly on a model mismatch (thresholds.ts's own contract) —
    // deliberately NOT caught: running dense retrieval against a
    // calibration that doesn't match the active model would silently score
    // pairs against a meaningless cutoff, which is exactly what this
    // assertion exists to prevent.
    assertThresholdsCalibratedFor(embedder.model, RETRIEVAL_THRESHOLDS);
    const embeddingsByClaim = await repo.loadClaimEmbeddingsForModel(claimsWithSource.map((c) => c.id), embedder.model);
    const embedded = claimsWithSource.filter((c) => embeddingsByClaim.has(c.id));
    if (embedded.length >= 2) {
      const vectors = embedded.map((c) => embeddingsByClaim.get(c.id)!);
      const cosinePairs = pairwiseCosineUpperTriangular(vectors, RETRIEVAL_THRESHOLDS.denseMin);
      densePairs = cosinePairs
        .filter((p) => embedded[p.i].sourceKey !== embedded[p.j].sourceKey)
        .map((p) => {
          const [loId, hiId] = [embedded[p.i].id, embedded[p.j].id].sort();
          return { loId, hiId, channel: "dense", score: p.similarity };
        });
    } else {
      concerns.push(`Dense retrieval skipped: only ${embedded.length} of ${claimsWithSource.length} claim(s) have an embedding under the active model "${embedder.model}".`);
    }
  } else {
    concerns.push("No embedding provider configured — dense retrieval skipped; claims without embeddings still participate via BM25/locus.");
  }

  // --- BM25 channel (self-contained, no calibration needed) ---
  await ctx.setStage("bm25-retrieval");
  const bm25Pairs = computeBm25CandidatePairs(claimsWithSource);

  // --- Locus channels (exact locus + same-SOURCE section, both $0/deterministic) ---
  await ctx.setStage("locus-retrieval");
  const sourceKeyByClaim = new Map(claimsWithSource.map((c) => [c.id, c.sourceKey]));
  const lociRows = await repo.loadDistinctClaimLoci(claims.map((c) => c.id));
  // `ClaimLocus.workId` is `@ice/claims`'s opaque cross-work grouping field
  // (see `locus.ts`'s own doc comment) — fed `sourceKey` here rather than a
  // real `work.id`, which is exactly what makes the exclusion cross-SOURCE
  // instead of cross-work without needing any change to that pure package.
  const localityEntries: ClaimLocus[] = lociRows.map((r) => ({ claimId: r.claimId, workId: sourceKeyByClaim.get(r.claimId)!, locusKey: r.locusKey }));
  const sectionEntries: ClaimLocus[] = lociRows.map((r) => ({ claimId: r.claimId, workId: sourceKeyByClaim.get(r.claimId)!, sectionKey: deriveSectionKey(r.locusKey) }));
  const localityPairs = locusPairs(localityEntries);
  const sectionPairsResult = sectionPairs(sectionEntries);

  const unioned: CandidatePair[] = unionCandidates(densePairs, bm25Pairs, localityPairs, sectionPairsResult);
  const ranked = [...unioned].sort((a, b) => b.bestScore - a.bestScore);
  const capped = ranked.slice(0, RETRIEVAL_LIMITS.maxCandidatePairs);
  if (ranked.length > capped.length) {
    concerns.push(`Candidate pairs capped at ${RETRIEVAL_LIMITS.maxCandidatePairs} (found ${ranked.length}) — kept the highest-scoring pairs, dropped the weakest.`);
  }

  // --- Citation-graph engagement (deterministic pre-join, $0) ---
  await ctx.setStage("citation-engagement");
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const [engagementProfiles, normalizedTitles, workCitedDois, corpusItemDois] = await Promise.all([
    loadCitationEngagementProfiles(workIds),
    loadWorkNormalizedTitles(workIds),
    loadCitationEngagementDoisForWorks(workIds),
    repo.loadCorpusItemDois(corpusItemIds),
  ]);

  const toInsert: repo.NewClaimPairCandidate[] = capped.map((pair) => {
    const loClaim = claimById.get(pair.loId)!;
    const hiClaim = claimById.get(pair.hiId)!;
    const { engagement, evidence } = resolveEngagementForClaims(loClaim, hiClaim, engagementProfiles, normalizedTitles, workCitedDois, corpusItemDois);
    return {
      claimLoId: pair.loId,
      claimHiId: pair.hiId,
      retrievalSources: pair.retrievalSources,
      bestRetrievalScore: pair.bestScore,
      engagement,
      engagementEvidence: evidence,
    };
  });

  await ctx.setStage("persisting-candidates", { index: toInsert.length, total: toInsert.length });
  const persisted = await repo.insertClaimPairCandidates(ctx.request.userId, projectId, toInsert);

  await ctx.setStage("candidates_ready", { index: toInsert.length, total: toInsert.length });

  channelCounts = {
    dense: densePairs.length,
    bm25: bm25Pairs.length,
    locus: localityPairs.length,
    locusSection: sectionPairsResult.length,
  };
  candidatesFound = unioned.length;
  candidatesPersisted = persisted;
  stage1Note = [
    `channels: dense=${channelCounts.dense} bm25=${channelCounts.bm25} locus=${channelCounts.locus} locus_section=${channelCounts.locusSection}`,
    `candidates: ${unioned.length} found, ${toInsert.length} kept after cap, ${persisted} newly persisted (re-runs over an unchanged claim set persist 0)`,
  ].join(" | ");
  } // end `if (claims.length >= 2)`

  // --- Judge stage (Phase 26.2b, paid): always runs, over EVERY persisted
  // `claim_pair_candidate` for this project — see this function's own
  // doc comment on why it isn't gated behind `claims.length >= 2` above. ---
  const judgeOutcome = await judgeCandidatePairsForProject(ctx, projectId, anthropic, openai);

  const note = [
    stage1Note,
    `judge: judged=${judgeOutcome.judged} alreadyJudged=${judgeOutcome.alreadyJudged} failed=${judgeOutcome.judgeFailed} awaitingJudgment=${judgeOutcome.candidatesAwaitingJudgment}${judgeOutcome.stoppedEarly ? " (stopped early: cost budget)" : ""}`,
    ...concerns,
    ...judgeOutcome.concerns,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" | ")
    .slice(0, 2000);

  return {
    // 'full' only once every persisted candidate for this project has
    // either been judged or permanently determined unjudgeable (a missing
    // claim detail) — an outstanding candidate (capped away, budget-
    // stopped, or a failed judge attempt) keeps this 'partial' so a future
    // `detect_relationships` run picks it back up.
    coverage: judgeOutcome.candidatesAwaitingJudgment > 0 ? "partial" : "full",
    note,
    claimsInScope: claims.length,
    candidatesFound,
    candidatesPersisted,
    channelCounts,
    judged: judgeOutcome.judged,
    alreadyJudged: judgeOutcome.alreadyJudged,
    judgeFailed: judgeOutcome.judgeFailed,
    candidatesAwaitingJudgment: judgeOutcome.candidatesAwaitingJudgment,
    concerns: [...concerns, ...judgeOutcome.concerns],
  };
}

/** Real-provider wrapper wired into the worker's queue handler. */
export async function detectRelationships(ctx: ResearchJobRunContext): Promise<ResearchJobOutcome> {
  const scope = parseDetectRelationshipsScope(ctx.request.scope);
  if (!scope) throw new Error('detect_relationships scope must be {"projectId": string}.');
  return detectRelationshipsForProject(ctx, scope.projectId);
}
