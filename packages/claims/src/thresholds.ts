/**
 * Env-derived thresholds for retrieval and novelty scoring.
 *
 * `denseMin`/`denseStrong`/`NOVELTY_THRESHOLDS.high`/`.low` default to NaN
 * rather than a guessed number. NaN propagates through every comparison as
 * false, so a threshold nobody has calibrated yet fails LOUDLY
 * (`assertThresholdsSet` throws) instead of silently gating retrieval or
 * novelty tiering on an invented cutoff. Real numbers are set via env vars
 * once the Phase 25 calibration spike measures them against a held-out
 * sample — the same discipline the ScholarLens port's `bm25MinScore=0.25`/
 * `bm25TopK=5`/`locus` scores below already reflect: those are fixed because
 * they were already calibrated (against ScholarLens's own corpus for the
 * BM25 constants; by definition for the locus/section scores), not because
 * they're less important to get right.
 */

export interface RetrievalThresholds {
  /** Minimum cosine similarity to treat a dense-retrieval pair as related at
   *  all. Unset (NaN) until the calibration spike measures it against this
   *  package's own embedding model/corpus. */
  denseMin: number;
  /** Cosine similarity above which a dense-retrieval pair is treated as
   *  strong enough to skip the BM25 pass's corroboration. Unset (NaN) for
   *  the same reason as denseMin. */
  denseStrong: number;
  /** How many BM25 candidates to retrieve per claim — ported unchanged from
   *  ScholarLens's `find_claim_pairs` default. */
  bm25TopK: number;
  /** Minimum normalized BM25 score to keep a pair — ported unchanged from
   *  ScholarLens's `find_claim_pairs` default. */
  bm25MinScore: number;
  /** Score assigned to a pair sharing an exact classical locus (src/retrieval/locus.ts). */
  locusScore: number;
  /** Score assigned to a pair sharing only a containing section, not the
   *  exact locus (src/retrieval/locus.ts). */
  locusSectionScore: number;
  /** The embedding model these thresholds were calibrated against — compared
   *  by `assertThresholdsCalibratedFor` before the thresholds are trusted. */
  calibratedFor: string;
}

export const RETRIEVAL_THRESHOLDS: RetrievalThresholds = {
  denseMin: Number(process.env.CLAIMS_DENSE_MIN ?? NaN),
  denseStrong: Number(process.env.CLAIMS_DENSE_STRONG ?? NaN),
  bm25TopK: 5,
  bm25MinScore: 0.25,
  locusScore: 1.0,
  locusSectionScore: 0.7,
  calibratedFor: process.env.RESEARCH_EMBEDDING_MODEL ?? "text-embedding-3-small",
};

export interface NoveltyThresholds {
  /** Cosine distance above which a claim/hypothesis is "high" novelty relative to the corpus. */
  high: number;
  /** Cosine distance below which it is "low" novelty. */
  low: number;
  calibratedFor: string;
}

export const NOVELTY_THRESHOLDS: NoveltyThresholds = {
  high: Number(process.env.CLAIMS_NOVELTY_HIGH ?? NaN),
  low: Number(process.env.CLAIMS_NOVELTY_LOW ?? NaN),
  calibratedFor: process.env.RESEARCH_EMBEDDING_MODEL ?? "text-embedding-3-small",
};

/**
 * Throws when a threshold set was calibrated for a different embedding
 * model than the one actually in use — cosine distances from two different
 * embedding models are not comparable, so silently reusing thresholds across
 * a model change would score novelty/retrieval against a meaningless cutoff.
 */
export function assertThresholdsCalibratedFor(model: string, thresholds: { calibratedFor: string }): void {
  if (thresholds.calibratedFor !== model) {
    throw new Error(
      `Thresholds were calibrated for "${thresholds.calibratedFor}" but this run uses "${model}" — ` +
        "re-run the calibration spike before trusting these cutoffs.",
    );
  }
}

/**
 * Throws if any numeric field in the given threshold object is still the
 * NaN default. NaN defaults mean the pipeline fails loudly before the
 * calibration spike sets real numbers — never run on invented thresholds.
 */
export function assertThresholdsSet(thresholds: object): void {
  for (const [key, value] of Object.entries(thresholds as Record<string, unknown>)) {
    if (typeof value === "number" && Number.isNaN(value)) {
      throw new Error(
        `Threshold "${key}" is unset (NaN default) — set the corresponding env var once the ` +
          "calibration spike has measured a real value; this must fail loudly rather than run on an invented cutoff.",
      );
    }
  }
}
