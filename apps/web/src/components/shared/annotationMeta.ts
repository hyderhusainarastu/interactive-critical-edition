/**
 * Shared presentation metadata for the 10 relationship categories
 * (plan §5/§12), extracted in Phase 22.1 (plan §22.2) so the landing
 * showcases and the authenticated Reader/Annotations surfaces draw the
 * category label/glyph/color vocabulary from ONE module instead of
 * duplicating it. Moved verbatim from
 * `apps/web/src/app/(app)/works/[workId]/reader/annotationMeta.ts`,
 * which now re-exports from here for its existing importers.
 *
 * Each category has a distinct label, a short glyph, AND a color token —
 * never color alone (WCAG requirement, plan §20): the glyph + label carry
 * the meaning for anyone who can't distinguish the hues. Colors are drawn
 * from the existing warm palette tokens so the annotation layer shares the
 * reader's visual language rather than inventing a new one (plan §19).
 *
 * The two string unions below are the same literal members as the reader's
 * `types.ts` unions; TypeScript's structural typing keeps them
 * interchangeable, and any future divergence fails the typecheck at the
 * `CATEGORY_META[...]` index sites rather than drifting silently.
 */

export type RelationshipCategory =
  | "explicit_reference"
  | "secondary_scholarly_recommendation"
  | "historical_context"
  | "prerequisite"
  | "conceptual_influence"
  | "disagreement_polemical_target"
  | "interpretive_aid"
  | "parallel_comparison"
  | "optional_extension"
  | "ai_inferred";

export type VerificationStatus =
  | "unreviewed"
  | "user_verified"
  | "source_verified"
  | "disputed"
  | "rejected";

export interface CategoryMeta {
  label: string;
  glyph: string;
  /** CSS var used for the marker/underline color. */
  colorVar: string;
  /** One-line gloss shown in the legend and detail view. */
  gloss: string;
}

export const CATEGORY_META: Record<RelationshipCategory, CategoryMeta> = {
  explicit_reference: {
    label: "Explicit reference",
    glyph: "→",
    colorVar: "--color-accent-ink",
    gloss: "Directly cited or quoted in the text.",
  },
  secondary_scholarly_recommendation: {
    label: "Secondary scholarship",
    glyph: "✦",
    colorVar: "--color-accent-green",
    gloss: "Scholarship about this text worth reading.",
  },
  historical_context: {
    label: "Historical context",
    glyph: "◷",
    colorVar: "--color-accent-umber",
    gloss: "Situates the text in its intellectual moment.",
  },
  prerequisite: {
    label: "Prerequisite",
    glyph: "▲",
    colorVar: "--color-accent-burgundy",
    gloss: "Best understood before this text.",
  },
  conceptual_influence: {
    label: "Conceptual influence",
    glyph: "❋",
    colorVar: "--color-accent-green",
    gloss: "Shaped the text's ideas.",
  },
  disagreement_polemical_target: {
    label: "Disagreement",
    glyph: "✕",
    colorVar: "--color-accent-burgundy",
    gloss: "The text argues against it.",
  },
  interpretive_aid: {
    label: "Interpretive aid",
    glyph: "❍",
    colorVar: "--color-accent-ink",
    gloss: "Helps interpret a difficult part.",
  },
  parallel_comparison: {
    label: "Parallel / comparison",
    glyph: "≈",
    colorVar: "--color-accent-umber",
    gloss: "A comparable work.",
  },
  optional_extension: {
    label: "Optional extension",
    glyph: "◇",
    colorVar: "--color-accent-green",
    gloss: "Worthwhile follow-up, not essential.",
  },
  ai_inferred: {
    label: "Inferred connection",
    glyph: "∴",
    colorVar: "--color-accent-umber",
    gloss: "A plausible but uncertain inferred connection.",
  },
};

export const VERIFICATION_LABELS: Record<VerificationStatus, string> = {
  unreviewed: "Unreviewed",
  user_verified: "Verified by you",
  source_verified: "Source-verified",
  disputed: "Disputed",
  rejected: "Rejected",
};

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) return "High";
  if (confidence >= 0.5) return "Moderate";
  if (confidence >= 0.3) return "Low";
  return "Very low";
}
