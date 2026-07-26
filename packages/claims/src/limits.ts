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
}

export const RETRIEVAL_LIMITS: ClaimsRetrievalLimits = {
  maxCandidatePairs: Number(process.env.CLAIMS_MAX_CANDIDATE_PAIRS ?? 400),
};
