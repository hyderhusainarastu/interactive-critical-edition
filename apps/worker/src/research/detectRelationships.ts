import {
  Bm25Index,
  RETRIEVAL_LIMITS,
  RETRIEVAL_THRESHOLDS,
  assertThresholdsCalibratedFor,
  locusPairs,
  pairwiseCosineUpperTriangular,
  sectionPairs,
  unionCandidates,
  type CandidatePair,
  type ChannelPair,
  type ClaimLocus,
} from "@ice/claims";
import { resolveEmbeddingProvider, type EmbeddingProvider } from "@ice/ai-adapters";
import * as repo from "./repository";
import { loadCitationEngagementProfiles, loadWorkNormalizedTitles, resolveEngagement } from "./citationEngagement";
import type { ResearchJobOutcome, ResearchJobRunContext } from "./jobRunner";

/**
 * detect_relationships handler — the DETERMINISTIC half only (Phase 26.2a,
 * plan §Pipeline "Three-channel Stage 1" / "Citation-graph engagement"):
 * Stage-1 candidate retrieval (dense cosine ∪ BM25 ∪ locus) plus the $0
 * citation-graph engagement pre-join, persisted as `claim_pair_candidate`
 * rows. Zero AI cost — no provider call path exists anywhere in this file.
 *
 * The PAID judge call (`claim_relationship` rows, `@ice/claims`'s
 * `prompts/judge.ts`) is Phase 26.2b, a separate later lane. This handler
 * always finishes with `coverage: 'partial'` when it found any candidates
 * at all — an honest signal that "relationship detection" (the job type's
 * own name) is only half done for this project until 26.2b judges what got
 * found here.
 *
 * TODO(Phase 26.2b): once the judge lane lands, this same handler (or a
 * follow-on stage within the SAME `analyze-claim-debates` queue request —
 * see `packages/db/src/queue.ts`'s doc comment on why relationship
 * detection and clustering share one queue) should judge each persisted
 * `claim_pair_candidate` into a `claim_relationship` row, routed by the
 * pair's claims' `claim_nature` (empirical vs. humanities branch,
 * `@ice/claims`'s `prompts/judge.ts`), and only then can `coverage` honestly
 * report `full`.
 */

interface DetectRelationshipsScope {
  projectId: string;
}

function parseDetectRelationshipsScope(scope: unknown): DetectRelationshipsScope | null {
  const s = scope as { projectId?: unknown } | null;
  if (s && typeof s.projectId === "string" && s.projectId.length > 0) return { projectId: s.projectId };
  return null;
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
 * (`RETRIEVAL_THRESHOLDS.bm25TopK`), keeping only cross-work matches at or
 * above `bm25MinScore`. BM25 relevance is directionally asymmetric
 * (`query(A)` finding `B` can score differently than `query(B)` finding
 * `A`), so both directions are computed and the MAX of the two scores is
 * kept per unordered pair — one `ChannelPair` per pair, not two.
 */
export function computeBm25CandidatePairs(claims: { id: string; workId: string; claimText: string }[]): ChannelPair[] {
  if (claims.length < 2) return [];
  const index = new Bm25Index(claims.map((c) => c.claimText));
  const bestByPair = new Map<string, number>();

  for (let i = 0; i < claims.length; i++) {
    const matches = index.query(claims[i].claimText, RETRIEVAL_THRESHOLDS.bm25TopK);
    for (const match of matches) {
      if (match.docIndex === i) continue; // a claim always matches its own text most strongly — exclude self
      if (match.score < RETRIEVAL_THRESHOLDS.bm25MinScore) continue;
      const other = claims[match.docIndex];
      if (other.workId === claims[i].workId) continue; // cross-work only

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
  concerns: string[];
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
): Promise<DetectRelationshipsOutcome> {
  const concerns: string[] = [];

  await ctx.setStage("loading-project-scope");
  const project = await repo.loadResearchProjectForUser(projectId, ctx.request.userId);
  if (!project) throw new Error(`Research project ${projectId} does not belong to the requesting user, or does not exist.`);

  const workIds = await repo.loadProjectWorkIds(projectId);
  // TODO(Phase 28.2+): fold corpus-item members' claims into scope once
  // corpus-item-sourced extraction exists (extractClaims.ts's own typed
  // TODO) — research_claim has no corpus_item_id rows to load yet.

  await ctx.setStage("loading-claims");
  const claims = await repo.loadScopedClaimsForRelationshipDetection(ctx.request.userId, workIds);
  if (claims.length < 2) {
    return {
      coverage: "full",
      note: `Only ${claims.length} claim(s) in scope across ${workIds.length} work(s) — nothing to compare.`,
      claimsInScope: claims.length,
      candidatesFound: 0,
      candidatesPersisted: 0,
      channelCounts: { dense: 0, bm25: 0, locus: 0, locusSection: 0 },
      concerns,
    };
  }

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
    const embeddingsByClaim = await repo.loadClaimEmbeddingsForModel(claims.map((c) => c.id), embedder.model);
    const embedded = claims.filter((c) => embeddingsByClaim.has(c.id));
    if (embedded.length >= 2) {
      const vectors = embedded.map((c) => embeddingsByClaim.get(c.id)!);
      const cosinePairs = pairwiseCosineUpperTriangular(vectors, RETRIEVAL_THRESHOLDS.denseMin);
      densePairs = cosinePairs
        .filter((p) => embedded[p.i].workId !== embedded[p.j].workId)
        .map((p) => {
          const [loId, hiId] = [embedded[p.i].id, embedded[p.j].id].sort();
          return { loId, hiId, channel: "dense", score: p.similarity };
        });
    } else {
      concerns.push(`Dense retrieval skipped: only ${embedded.length} of ${claims.length} claim(s) have an embedding under the active model "${embedder.model}".`);
    }
  } else {
    concerns.push("No embedding provider configured — dense retrieval skipped; claims without embeddings still participate via BM25/locus.");
  }

  // --- BM25 channel (self-contained, no calibration needed) ---
  await ctx.setStage("bm25-retrieval");
  const bm25Pairs = computeBm25CandidatePairs(claims);

  // --- Locus channels (exact locus + same-work section, both $0/deterministic) ---
  await ctx.setStage("locus-retrieval");
  const workIdByClaim = new Map(claims.map((c) => [c.id, c.workId]));
  const lociRows = await repo.loadDistinctClaimLoci(claims.map((c) => c.id));
  const localityEntries: ClaimLocus[] = lociRows.map((r) => ({ claimId: r.claimId, workId: workIdByClaim.get(r.claimId)!, locusKey: r.locusKey }));
  const sectionEntries: ClaimLocus[] = lociRows.map((r) => ({ claimId: r.claimId, workId: workIdByClaim.get(r.claimId)!, sectionKey: deriveSectionKey(r.locusKey) }));
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
  const [engagementProfiles, normalizedTitles] = await Promise.all([
    loadCitationEngagementProfiles(workIds),
    loadWorkNormalizedTitles(workIds),
  ]);

  const toInsert: repo.NewClaimPairCandidate[] = capped.map((pair) => {
    const loClaim = claimById.get(pair.loId)!;
    const hiClaim = claimById.get(pair.hiId)!;
    const { engagement, evidence } = resolveEngagement(loClaim.workId, hiClaim.workId, engagementProfiles, normalizedTitles);
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

  const channelCounts = {
    dense: densePairs.length,
    bm25: bm25Pairs.length,
    locus: localityPairs.length,
    locusSection: sectionPairsResult.length,
  };

  const note = [
    `channels: dense=${channelCounts.dense} bm25=${channelCounts.bm25} locus=${channelCounts.locus} locus_section=${channelCounts.locusSection}`,
    `candidates: ${unioned.length} found, ${toInsert.length} kept after cap, ${persisted} newly persisted (re-runs over an unchanged claim set persist 0)`,
    toInsert.length > 0 ? "judge stage not yet implemented — see TODO(Phase 26.2b) in detectRelationships.ts" : null,
    ...concerns,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" | ")
    .slice(0, 2000);

  return {
    // Deliberately 'partial', never 'full', whenever there is at least one
    // candidate for the (not-yet-implemented) judge to act on — this job
    // type's own name is "detect_relationships", and Stage-1 retrieval alone
    // has not yet produced a judged relationship.
    coverage: toInsert.length > 0 ? "partial" : "full",
    note,
    claimsInScope: claims.length,
    candidatesFound: unioned.length,
    candidatesPersisted: persisted,
    channelCounts,
    concerns,
  };
}

/** Real-provider wrapper wired into the worker's queue handler. */
export async function detectRelationships(ctx: ResearchJobRunContext): Promise<ResearchJobOutcome> {
  const scope = parseDetectRelationshipsScope(ctx.request.scope);
  if (!scope) throw new Error('detect_relationships scope must be {"projectId": string}.');
  return detectRelationshipsForProject(ctx, scope.projectId);
}
