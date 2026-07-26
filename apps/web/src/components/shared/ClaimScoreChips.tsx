"use client";

import { useState } from "react";
import type { ClaimScore } from "@ice/claims";

/**
 * Shared evidence-strength/textual-support chip presentation (Phase 29.3,
 * plan §"What ScholarLens improves in existing Palimnote (reverse
 * direction)" — "Evidence-strength chips on existing surfaces").
 *
 * Same visual conventions as `ClaimsTab.tsx`'s Phase 28.3 `ClaimScoreChip`
 * (dot + label pairing, never color alone; click-to-expand named signals;
 * a dimension is never aggregated into one number, matching the Evidence
 * Chamber contract) — extracted here so the two reverse-direction render
 * sites (`ClaimView`'s `generated_claim` cards, `GraphInspector`'s
 * `work_claim` evidence anchors) share one implementation instead of a
 * second copy. `ClaimsTab.tsx` itself is untouched: its `research_claim`
 * rows carry a DB-persisted `ClaimScore[]`, while these two call sites score
 * plain claim text at render time (see `scoreBothDimensions` callers) — same
 * shape, different data source, so sharing this presentational piece alone
 * (not the DB-backed `ResearchClaimSummary` type) is the right seam.
 */
export const CLAIM_SCORE_DIMENSION_LABEL: Record<ClaimScore["dimension"], string> = {
  evidence_strength: "Evidence strength",
  textual_support: "Textual support",
};

export const CLAIM_SCORE_LABEL_COLOR_VAR: Record<ClaimScore["label"], string> = {
  strong: "--color-accent-green",
  moderate: "--color-credibility-warning",
  weak: "--color-credibility-critical",
};

function ClaimScoreChip({ score }: { score: ClaimScore }) {
  const [open, setOpen] = useState(false);
  const colorVar = CLAIM_SCORE_LABEL_COLOR_VAR[score.label];
  const hasSignals = score.signals.length > 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => hasSignals && setOpen((v) => !v)}
        aria-expanded={hasSignals ? open : undefined}
        className="app-control flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[0.68rem]"
        style={{ borderColor: `var(${colorVar})` }}
      >
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: `var(${colorVar})` }} />
        {CLAIM_SCORE_DIMENSION_LABEL[score.dimension]}: {score.label}
        {score.tier ? ` (${score.tier})` : ""}
      </button>
      {open && hasSignals && (
        <ul className="app-panel-enter mt-1 flex flex-col gap-0.5 pl-3 text-[0.65rem] text-[var(--color-text-muted)]">
          {score.signals.map((signal, i) => (
            <li key={i}>· {signal}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The chip-visibility rule, pulled out as a pure predicate so it's directly
 * unit-testable without rendering React (`ClaimScoreChips.test.ts`): a claim
 * with zero contributing signals is honestly "unscored," never a fabricated
 * chip. Exported (not inlined in the component below) specifically so the
 * test asserts the SAME logic the component actually runs, not a duplicated
 * copy that could silently drift from it.
 */
export function shouldRenderClaimScoreChips(scores: ClaimScore[]): boolean {
  return scores.length > 0;
}

/**
 * Renders nothing when `scores` is empty — an honest "unscored" claim never
 * shows a fabricated chip (`scoreBothDimensions` already filters dimensions
 * with zero contributing signals before this component ever sees them).
 */
export function ClaimScoreChips({ scores, className }: { scores: ClaimScore[]; className?: string }) {
  if (!shouldRenderClaimScoreChips(scores)) return null;
  return <ul className={className ?? "mt-1.5 flex flex-wrap gap-1.5"}>{scores.map((score) => (
    <ClaimScoreChip key={score.dimension} score={score} />
  ))}</ul>;
}
