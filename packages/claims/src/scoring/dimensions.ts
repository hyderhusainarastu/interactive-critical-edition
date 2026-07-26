import { scoreEvidenceStrength, type EvidenceStrength } from "./evidenceStrength";
import { scoreTextualSupport, type TextualSupport } from "./textualSupport";

export type ClaimScoreDimension = "evidence_strength" | "textual_support";

export interface ClaimScore {
  dimension: ClaimScoreDimension;
  score: number;
  label: "strong" | "moderate" | "weak";
  /** The specific matched category that drove `score` — `EvidenceStrength.design`
   *  for the `evidence_strength` dimension, `TextualSupport.mode` for
   *  `textual_support` — unified under one field name here so a caller
   *  reading a `ClaimScore` doesn't need to know which scorer produced it. */
  tier: string | null;
  signals: string[];
}

/**
 * A score with zero contributing signals carries no real information — the
 * scorer found nothing in the text to go on, which is honestly "unscored,"
 * not "score of exactly 0". `scoreBothDimensions` filters these out rather
 * than returning a misleadingly precise weak/0 score for a dimension that
 * simply doesn't apply to this claim's text.
 */
export const MIN_SIGNAL_FLOOR = 1;

function toClaimScore(
  dimension: ClaimScoreDimension,
  result: EvidenceStrength | TextualSupport,
  tier: string | null,
): ClaimScore {
  return { dimension, score: result.score, label: result.label, tier, signals: result.signals };
}

/**
 * Runs both dimension scorers over the same claim text and keeps only the
 * results that found at least one real signal (`MIN_SIGNAL_FLOOR`). An
 * empty return array is itself meaningful: it means this claim's text gave
 * neither scorer anything to go on, and callers should present that
 * honestly rather than inventing a default score.
 */
export function scoreBothDimensions(text: string): ClaimScore[] {
  const evidence = scoreEvidenceStrength(text);
  const textual = scoreTextualSupport(text);

  const scores: ClaimScore[] = [
    toClaimScore("evidence_strength", evidence, evidence.design),
    toClaimScore("textual_support", textual, textual.mode),
  ];

  return scores.filter((s) => s.signals.length >= MIN_SIGNAL_FLOOR);
}
