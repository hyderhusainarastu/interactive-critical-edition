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

/**
 * Confirmation-gate thresholds for the `extract_claims` job (Phase 28.1's
 * `dispatchExtractClaimsJob`). Phase 12's cross-library graph expansion
 * precedent (plan §Owner-ratified decisions 3 / `planResearchJob`'s own doc
 * comment): small jobs auto-enqueue, larger ones need explicit confirmation.
 * A single work's extraction is capped by `planExtractionChunks`'s own
 * `DEFAULT_MAX_CHUNKS` (12, ~$0.12) — well under `AUTO_APPROVE_MAX_CHUNKS` —
 * so confirmation is realistically reached only if that per-work cap is ever
 * raised. Colocated here (rather than left local to the web-side dispatcher)
 * so any future caller shares the same numbers instead of re-guessing them.
 */
export const AUTO_APPROVE_MAX_CHUNKS = 12;
export const HARD_STOP_MAX_CHUNKS = 50;
