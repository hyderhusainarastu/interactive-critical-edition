/**
 * Per-request caps for the claim-relationship pipeline (plan §Pipeline
 * "Budget": "pair detection is project-scoped, never library-scoped —
 * bounds the O(n²) surface"). Env-overridable, matching the
 * `packages/research/src/config.ts` (`RESEARCH_MAX_CITATION_LOOKUPS` etc.)
 * precedent — a cap is a runtime knob, never a hardcoded magic number
 * buried in a handler.
 */

export interface ClaimsRetrievalLimits {
  /** Hard ceiling on how many Stage-1 candidate pairs one `detect_relationships`
   *  request will persist, after the dense/bm25/locus union — the union
   *  itself is NOT truncated (every channel's own findings are computed in
   *  full before ranking), only the number of `claim_pair_candidate` rows
   *  written. Pairs are ranked by `bestScore` (descending) before the cap is
   *  applied, so a truncation drops the WEAKEST candidates first, never an
   *  arbitrary subset. */
  maxCandidatePairs: number;
  /** Hard ceiling on how many `claim_pair_candidate` rows one
   *  `detect_relationships` request will send to the PAID judge stage
   *  (Phase 26.2b, plan §Pipeline "Budget": "maxJudgedPairsPerRequest 40").
   *  Candidates needing judgment are ranked by `bestRetrievalScore`
   *  (descending) before this cap is applied — the same "drop the weakest
   *  first" discipline as `maxCandidatePairs` above — and a request that hits
   *  this cap (or the cost budget) reports `coverage: 'partial'`, never
   *  silently drops the remainder: an unjudged candidate simply has no
   *  `claim_relationship` row yet and is picked back up by the next
   *  `detect_relationships` run over the same project. */
  maxJudgedPairsPerRequest: number;
}

export const RETRIEVAL_LIMITS: ClaimsRetrievalLimits = {
  maxCandidatePairs: Number(process.env.CLAIMS_MAX_CANDIDATE_PAIRS ?? 400),
  maxJudgedPairsPerRequest: Number(process.env.CLAIMS_MAX_JUDGED_PAIRS_PER_REQUEST ?? 40),
};
