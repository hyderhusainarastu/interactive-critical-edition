/**
 * Evidence-strength scoring for claims.
 *
 * A contradiction between two claims is not symmetric: a finding from a
 * 600-person randomized trial reporting an effect size and confidence
 * interval carries more weight than an unquantified assertion from a single
 * case study. This module turns the cues a claim already states — study
 * design, sample size, effect size, statistical detail — into a transparent
 * 0..1 strength score plus the list of signals that produced it, so the UI
 * can show *why* one side outweighs the other instead of asking the user to
 * take a model's word for it.
 *
 * This is a verbatim TypeScript port of ScholarLens's
 * `utils/evidence_strength.py` (licensed, MIT + explicit owner permission —
 * see docs/PROJECT-LOG.md's Design Decisions row on the reference project).
 * Same design tiers, patterns, weights, hedges, labels, and evidence-gap
 * rule — nothing rebalanced or "improved" in the port.
 *
 * Design notes (carried over from the Python docstring):
 *   - Pure and deterministic: regex/keyword matching, no model call, no I/O.
 *     That makes it free to run on every claim and trivially unit-testable.
 *   - Explainable by construction: every point added is tied to a named
 *     signal returned in `signals`, so a score is auditable.
 */

// Study-design tiers, strongest first. The first pattern that matches wins,
// so more specific / stronger designs are listed above weaker ones.
const DESIGN_TIERS: Array<[RegExp, number, string]> = [
  [/meta[- ]analy|systematic review/i, 1.0, "meta-analysis / systematic review"],
  [/randomi[sz]ed controlled|\bRCT\b|randomi[sz]ed.{0,20}trial/i, 0.9, "randomized controlled trial"],
  [/\blongitudinal\b|\bcohort\b|prospective study/i, 0.7, "longitudinal / cohort design"],
  [
    /\bquasi[- ]experiment|\bcontrolled (?:study|experiment)|within[- ]subjects?|between[- ]subjects?/i,
    0.6,
    "controlled experiment",
  ],
  [/\bobservational\b|cross[- ]sectional|\bsurvey\b|correlational/i, 0.4, "observational / cross-sectional"],
  [/case study|case report|anecdot|\bpilot\b|preliminary/i, 0.2, "case study / pilot"],
];

// Quantitative-evidence signals. Each contributes once; weights reflect how
// much each cue raises confidence that the claim is empirically grounded.
const QUANT_SIGNALS: Array<[RegExp, number, string]> = [
  [/\bp\s*[<=>]\s*0?\.\d+|\bp[- ]value/i, 0.18, "p-value"],
  [
    /cohen'?s\s*d|effect size|odds ratio|\bOR\s*=|\bRR\s*=|hazard ratio|\bβ\s*=|\bbeta\s*=|\br\s*=\s*0?\.\d+/i,
    0.2,
    "effect size",
  ],
  [/95%\s*(?:ci|confidence interval)|confidence interval|\bCI\b/i, 0.14, "confidence interval"],
  [
    /\bn\s*=\s*\d|\bN\s*=\s*\d|\d+\s*(?:participants|subjects|respondents|patients|samples)/i,
    0.2,
    "sample size",
  ],
  [/\d+(?:\.\d+)?\s*%/, 0.1, "reported percentage"],
  [/\bSD\b|standard deviation|standard error|\bSE\b|variance/i, 0.08, "dispersion reported"],
  [/significan|statistically/i, 0.06, "significance stated"],
];

// Hedging language caps the score: a heavily qualified claim is, by its own
// admission, weakly supported.
const HEDGES =
  /\bmay\b|\bmight\b|\bcould\b|suggests?\b|\bappears?\b|\bpreliminary\b|\bunclear\b|\blimited evidence\b|\bnot conclusive\b/i;

export interface EvidenceStrength {
  score: number; // 0..1, higher = stronger support
  label: "strong" | "moderate" | "weak";
  design: string | null; // named design tier, if detected
  signals: string[]; // human-readable cues
}

function labelFor(score: number): "strong" | "moderate" | "weak" {
  if (score >= 0.66) return "strong";
  if (score >= 0.33) return "moderate";
  return "weak";
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Score how strongly a claim is empirically supported, from its own stated
 * cues. `evidence`/`conditions` are the optional extracted fields; when
 * present they are folded into the same text so quantitative detail
 * recorded separately still counts.
 */
export function scoreEvidenceStrength(
  text: string,
  opts: { evidence?: string | null; conditions?: string | null } = {},
): EvidenceStrength {
  const blob = [text, opts.evidence, opts.conditions].filter((p): p is string => Boolean(p)).join(" ");
  if (!blob.trim()) {
    return { score: 0, label: "weak", design: null, signals: [] };
  }

  const signals: string[] = [];

  // Design tier — take the strongest match, contributing up to ~0.45.
  let designName: string | null = null;
  let designScore = 0;
  for (const [pattern, weight, name] of DESIGN_TIERS) {
    if (pattern.test(blob)) {
      designName = name;
      designScore = weight * 0.45;
      signals.push(name);
      break;
    }
  }

  // Quantitative signals — additive, each counted once.
  let quantScore = 0;
  for (const [pattern, weight, name] of QUANT_SIGNALS) {
    if (pattern.test(blob)) {
      quantScore += weight;
      signals.push(name);
    }
  }

  const raw = designScore + quantScore;
  let score = Math.max(0, Math.min(1, raw));

  // Hedging penalty: cap an otherwise-confident score for qualified language.
  if (HEDGES.test(blob)) {
    score = Math.min(score, 0.6);
    signals.push("hedged language");
  }

  return { score: round3(score), label: labelFor(score), design: designName, signals };
}

/**
 * Compare two claims' strength. Returns the signed gap and which side is
 * better supported — a computed second opinion alongside a judge model's own
 * `strongerEvidence` verdict. A gap under 0.1 is treated as a tie ("neither"
 * side is meaningfully stronger).
 */
export function evidenceGap(
  a: EvidenceStrength,
  b: EvidenceStrength,
): { gap: number; stronger: "claim_a" | "claim_b" | "neither" } {
  const diff = round3(a.score - b.score);
  const stronger: "claim_a" | "claim_b" | "neither" =
    Math.abs(diff) < 0.1 ? "neither" : diff > 0 ? "claim_a" : "claim_b";
  return { gap: diff, stronger };
}
