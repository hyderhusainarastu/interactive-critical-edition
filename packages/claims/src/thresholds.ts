/**
 * Env-derived thresholds for retrieval and novelty scoring.
 *
 * `denseMin`/`NOVELTY_THRESHOLDS.high`/`.low` now default to the Phase 25.5
 * calibration spike's measured values (see below) rather than NaN — the
 * spike that was supposed to set them has run. `denseStrong` remains NaN:
 * the spike measured the "surface at all" cutoff (`denseMin`) but never
 * measured a "strong enough to skip BM25 corroboration" cutoff, so it stays
 * unset (and still fails loudly via `assertThresholdsSet`) rather than
 * guessed. Real numbers are still env-overridable — the same discipline the
 * ScholarLens port's `bm25MinScore=0.25`/`bm25TopK=5`/`locus` scores below
 * already reflect: those are fixed because they were already calibrated
 * (against ScholarLens's own corpus for the BM25 constants; by definition
 * for the locus/section scores), not because they're less important to get
 * right.
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

// denseMin=0.35: docs/eval/research-claims/spike-25-5-calibration.md,
// 2026-07-26, calibrated for text-embedding-3-small (pooled 100-pair set:
// recall 0.968, rejection 0.946, F1 0.968 at this threshold — the best-F1
// qualifying operating point of the sweep; text-embedding-3-large measured
// at the same spike did not clear the promotion bar). Recalibrate if the
// embedding model changes (guarded below by `calibratedFor`).
export const RETRIEVAL_THRESHOLDS: RetrievalThresholds = {
  denseMin: Number(process.env.CLAIMS_DENSE_MIN ?? 0.35),
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

// low=0.174 (33rd pct)/high=0.725 (67th pct): docs/eval/research-claims/
// spike-25-5-calibration.md, 2026-07-26, calibrated for
// text-embedding-3-small. PROVISIONAL — measured from 20 hand-written
// synthetic hypothesis statements (10 near-duplicate paraphrases, 10
// genuinely novel, cosine distance to a 42-claim pseudo-corpus), not real
// pipeline output; a sanity-check calibration, not a final one. Clean
// bimodal separation observed (near-duplicate max 0.243, genuinely-novel min
// 0.659), so these percentile cutoffs sit safely inside that gap.
// Recalibration against real hypothesis output is due at the Phase 27
// canary — do not treat these as load-bearing beyond that.
export const NOVELTY_THRESHOLDS: NoveltyThresholds = {
  high: Number(process.env.CLAIMS_NOVELTY_HIGH ?? 0.725),
  low: Number(process.env.CLAIMS_NOVELTY_LOW ?? 0.174),
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
