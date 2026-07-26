/**
 * Judge-quality gates for promoting the claims-comparison pipeline out of
 * the calibration spike. Every threshold below carries the specific
 * measurement/reasoning that set it — these are NOT arbitrary. Most come
 * from ScholarLens's own judge-quality eval on a Sonnet-class Claude model
 * (macro-F1 0.788, Cohen's kappa 0.683) minus a small safety margin, so a
 * genuinely worse-calibrated deployment fails the gate rather than shipping
 * on paper-only confidence.
 */

/** ScholarLens measured 0.788 valence macro-F1 on Sonnet-class Claude; 0.75
 *  leaves margin without accepting a materially worse judge. */
export const JUDGE_VALENCE_MACRO_F1_MIN = 0.75;

/** ScholarLens measured 0.683 Cohen's kappa (agreement beyond chance)
 *  against its gold set; 0.60 ("substantial agreement" by the conventional
 *  Landis & Koch bands) is the floor below which judge output isn't
 *  trustworthy enough to surface unreviewed. */
export const JUDGE_KAPPA_MIN = 0.6;

/** A missed contradiction is the single worst failure mode for this
 *  feature — silence reads as "no tension found" rather than "the judge
 *  missed it" — so recall on the contradiction class specifically is
 *  floored higher than the general per-class floor below. */
export const JUDGE_CONTRADICTION_RECALL_MIN = 0.66;

/**
 * The humanities branch (definitional/interpretive nuance, `taxonomy.ts`'s
 * stage-2 mechanisms) is new territory ScholarLens's empirical-paper eval
 * never measured. Rather than assume parity, this requires the humanities
 * branch to measure within 0.05 macro-F1 of the empirical branch
 * (`perDomainMacroF1` in `metrics.ts`) before it's trusted at the same
 * confidence level — a material gap means the pre-classification step
 * needs more work before shipping unreviewed.
 */
export const HUMANITIES_BRANCH_DELTA_MIN = 0.05;

/** Stage-2 mechanism labeling is optional metadata, not the core verdict —
 *  0.60 accuracy is enough to be useful without being load-bearing the way
 *  the valence gates above are. */
export const MECHANISM_ACCURACY_MIN = 0.6;

/** Adding the humanities branch/mechanism logic must not regress the
 *  empirical branch ScholarLens already validated — at most a 2-point
 *  macro-F1 drop is tolerated before treating it as a real regression. */
export const EMPIRICAL_REGRESSION_MAX = 0.02;

/** No single class (of the 4 valences, or a domain slice) may fall below
 *  this even if the macro average passes — a macro average can hide one
 *  class collapsing to near-zero while others compensate. */
export const CLASS_F1_FLOOR = 0.4;

/** The 8-value `claim_nature` taxonomy is new (not ScholarLens-derived);
 *  0.65 is a deliberately lower bar than the 4-valence judge gates above,
 *  since nature classification is a softer, more subjective task by
 *  construction. */
export const CLAIM_NATURE_MACRO_F1_MIN = 0.65;

/** Below this many gold examples for a class/value, its own per-class
 *  metric is too noisy to gate on — report it, but don't fail the gate on
 *  it alone. */
export const MIN_GOLD_PER_VALUE = 6;
