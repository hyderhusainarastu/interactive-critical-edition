import { findQuoteOffset } from "./highlightDom";
import type { VerificationStatus } from "./types";

/**
 * Reader-facing shape of a `research_claim` row plus its `claim_score`
 * children (Phase 28.3, plan §"Web surfaces (reader)"). Mirrors
 * `@ice/claims`'s taxonomy/scoring types, but kept as a local, JSON-safe
 * interface (no DB/package import) — the same pattern `EditionPassageAnnotation`
 * uses for the `annotation`/`passage_annotation` tables — since this is the
 * wire shape returned by `GET /api/works/[workId]/claims`, not the DB row
 * itself.
 */
export type ClaimNature =
  | "empirical"
  | "textual"
  | "interpretive"
  | "historical"
  | "conceptual"
  | "normative"
  | "definitional"
  | "methodological";

export type ClaimAnchorState = "anchored" | "rebound" | "unanchored";
export type ClaimSourceScope = "full_text" | "abstract" | "sampled";
export type ClaimConfidenceLabel = "high" | "medium" | "low";
export type ClaimScoreDimension = "evidence_strength" | "textual_support";
export type ClaimScoreLabel = "strong" | "moderate" | "weak";

export interface ResearchClaimScore {
  dimension: ClaimScoreDimension;
  score: number;
  label: ClaimScoreLabel;
  tier: string | null;
  signals: string[];
}

export interface ResearchClaimSummary {
  id: string;
  claimText: string;
  claimNature: ClaimNature;
  confidence: ClaimConfidenceLabel;
  section: string;
  sourceScope: ClaimSourceScope;
  supportingExcerpt: string;
  /** Non-null only when `anchorState` is `anchored`/`rebound` (the DB-
   *  enforced `research_claim_unanchored_no_block` invariant). */
  textBlockId: string | null;
  /** {quote, prefix, suffix} — present even when `anchorState` is
   *  `unanchored`, so a render-time re-match (`matchClaimToBlock`) is
   *  still possible; null only for a corpus-item claim that was never
   *  anchored to any block at all (not reachable from this reader route,
   *  which is work-scoped, but kept optional for honesty). */
  quote: string | null;
  prefix: string | null;
  suffix: string | null;
  anchorState: ClaimAnchorState;
  verificationStatus: VerificationStatus;
  promptVersion: string;
  /** The model that produced this claim's extraction run, when a matching
   *  `ai_usage_log` row for that run still exists — null rather than a
   *  fabricated value when it doesn't (the run's usage rows may have been
   *  cleaned up, or `processingRunId` may itself be null after a
   *  reprocess). Real fact or nothing, never guessed. */
  model: string | null;
  scores: ResearchClaimScore[];
}

export const CLAIM_NATURE_LABEL: Record<ClaimNature, string> = {
  empirical: "Empirical",
  textual: "Textual",
  interpretive: "Interpretive",
  historical: "Historical",
  conceptual: "Conceptual",
  normative: "Normative",
  definitional: "Definitional",
  methodological: "Methodological",
};

export const CLAIM_SCORE_DIMENSION_LABEL: Record<ClaimScoreDimension, string> = {
  evidence_strength: "Evidence strength",
  textual_support: "Textual support",
};

/** Never a per-position aggregate (plan §"Web surfaces" Evidence Chamber
 *  contract, applied here too): each dimension's color is looked up
 *  independently by its OWN label, and dimensions are never averaged or
 *  compared against each other. */
export const CLAIM_SCORE_LABEL_COLOR_VAR: Record<ClaimScoreLabel, string> = {
  strong: "--color-accent-green",
  moderate: "--color-credibility-warning",
  weak: "--color-credibility-critical",
};

/** The claim marker's glyph/color — a double dagger distinguishes it from
 *  the footnote dagger (†), the generated-critical-note glyph (✣), and every
 *  10-category relationship glyph (CATEGORY_META). `--color-accent-ink` is
 *  an existing token already used for other marker backgrounds
 *  (`.reader-annotation-marker`'s `color: var(--color-background)` pairing),
 *  so no new color token is needed (the D-23-23 precedent only applies when
 *  no existing token already clears contrast). */
export const CLAIM_MARKER_GLYPH = "‡";
export const CLAIM_MARKER_COLOR_VAR = "--color-accent-ink";

export interface ClaimBlockMatch {
  claimId: string;
  blockId: string;
  offset: number;
}

/**
 * Unanchored `research_claim` rows (`anchor_state = "unanchored"`) never
 * carry a `text_block_id` (the DB-enforced `research_claim_unanchored_no_block`
 * CHECK) but keep their last-known `{quote, prefix, suffix}` anchor. Recompute
 * a conservative client-side re-match against the CURRENT published run's
 * blocks: exactly one matching block renders a visibly-inferred dashed
 * marker (the Phase 11.6 generated-note treatment, `matchNoteToBlock.ts`'s
 * sibling); zero or multiple block matches stay sidebar-only — never a guess
 * between two plausible blocks.
 */
export function matchClaimToBlock(
  claim: Pick<ResearchClaimSummary, "id" | "quote" | "prefix" | "suffix">,
  blocks: Array<{ id: string; text: string }>,
): ClaimBlockMatch | null {
  const quote = claim.quote?.trim();
  if (!quote) return null;
  const prefix = claim.prefix ?? "";
  const suffix = claim.suffix ?? "";

  const matches = blocks
    .map((block) => ({ blockId: block.id, offset: findQuoteOffset(block.text, quote, prefix, suffix) }))
    .filter((match): match is { blockId: string; offset: number } => match.offset !== null);

  if (matches.length !== 1) return null;
  return { claimId: claim.id, blockId: matches[0].blockId, offset: matches[0].offset };
}
