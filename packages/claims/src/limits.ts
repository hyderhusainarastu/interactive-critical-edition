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

/**
 * `generate_hypotheses` caps (Phase 27.2, plan §Program 27.2 "maxHypotheses
 * <=5"). `maxHypothesesPerRequest` is the hard ceiling `generateHypotheses.ts`
 * clamps a caller-supplied `maxHypotheses` scope field to, regardless of what
 * value is requested. `maxConflictsForHypothesisContext` bounds how many
 * `[CONFLICT_N]`-labeled conflicts are ever assembled into one prompt — a
 * project with hundreds of undisputed conflicts must not blow up the prompt
 * (or the cost) just because they all exist; the highest-value context still
 * makes it in (the caller ranks before truncating), the rest are simply
 * outside this run's hypothesis-generation window, not silently corrupted.
 */
export const MAX_HYPOTHESES_PER_REQUEST = Number(process.env.CLAIMS_MAX_HYPOTHESES_PER_REQUEST ?? 5);
export const MAX_CONFLICTS_FOR_HYPOTHESIS_CONTEXT = Number(process.env.CLAIMS_MAX_CONFLICTS_FOR_HYPOTHESIS_CONTEXT ?? 30);
