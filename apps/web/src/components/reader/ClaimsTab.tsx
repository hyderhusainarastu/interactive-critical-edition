"use client";

import { useEffect, useRef, useState } from "react";
import { InsertIntoWriterButton } from "@/components/writer/insertion/InsertIntoWriterButton";
import { VERIFICATION_LABELS } from "./annotationMeta";
import type { EditionPayload } from "./EditionReader";
import { readerScrollBehavior } from "./readerMotion";
import {
  CLAIM_MARKER_GLYPH,
  CLAIM_NATURE_LABEL,
  CLAIM_SCORE_DIMENSION_LABEL,
  CLAIM_SCORE_LABEL_COLOR_VAR,
  matchClaimToBlock,
  type ResearchClaimScore,
  type ResearchClaimSummary,
} from "./researchClaims";

const SOURCE_SCOPE_LABEL: Record<ResearchClaimSummary["sourceScope"], string> = {
  full_text: "full text",
  sampled: "sampled extraction",
  abstract: "abstract",
};

/**
 * One score dimension as a chip — never rendered as a single aggregated
 * number across dimensions (plan §"Web surfaces" Evidence Chamber contract:
 * "per-claim scores shown with named signals but never aggregated to a
 * per-position number"). The dot + label pairing (never color alone) mirrors
 * `CredibilityMeter`'s own discipline; the specific signals that produced
 * the score are progressive-disclosure, shown only on expand.
 */
function ClaimScoreChip({ score }: { score: ResearchClaimScore }) {
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

function ClaimCard({
  claim,
  matchedBlockId,
  active,
  activationId,
  onSelect,
  onLocatePassage,
  writerEnabled,
}: {
  claim: ResearchClaimSummary;
  /** Set only for an `unanchored` claim that re-matched exactly one block at
   *  render time (`matchClaimToBlock`) — lets "Locate passage" work for a
   *  re-matched claim too, not only a DB-anchored one. */
  matchedBlockId: string | null;
  active: boolean;
  activationId: string | null;
  onSelect?: (id: string) => void;
  onLocatePassage?: (textBlockId: string) => void;
  /** Integration step "writer-insertion-dialogs": gates the "Insert into
   *  Writer" action (charter §6 "Write" — Reader is one of the four named
   *  context-preserving insertion entry points). Off entirely when Writer
   *  itself is feature-flagged off, matching how every other Writer-adjacent
   *  affordance in this app is gated. */
  writerEnabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement | null>(null);
  const expanded = open || active;
  const locatableBlockId = claim.textBlockId ?? matchedBlockId;

  useEffect(() => {
    if (active && activationId === claim.id) ref.current?.scrollIntoView({ block: "center", behavior: readerScrollBehavior() });
  }, [active, activationId, claim.id]);

  return (
    <li
      ref={ref}
      data-claim-card={claim.id}
      className="rounded-lg border bg-[var(--color-background)] p-2.5 text-sm"
      style={{ borderColor: active ? "var(--color-accent-ink)" : "var(--color-border)" }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-[var(--color-accent-ink)] text-[0.7rem] font-bold text-[var(--color-background)]"
        >
          {CLAIM_MARKER_GLYPH}
        </span>
        <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide">
          {CLAIM_NATURE_LABEL[claim.claimNature]}
        </span>
        {claim.anchorState === "rebound" && (
          <span className="text-[0.65rem] uppercase tracking-wide text-[var(--color-text-muted)]">re-anchored</span>
        )}
        {claim.anchorState === "unanchored" && (
          <span className="text-[0.65rem] uppercase tracking-wide text-[var(--color-text-muted)]">
            {matchedBlockId ? "re-matched" : "unanchored"}
          </span>
        )}
        {claim.verificationStatus !== "unreviewed" && (
          <span
            className="rounded border px-1.5 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide"
            style={{ borderColor: "var(--color-accent-ink)" }}
          >
            {VERIFICATION_LABELS[claim.verificationStatus]}
          </span>
        )}
        <span className="ml-auto text-[0.68rem] text-[var(--color-text-muted)]">
          {claim.confidence[0].toUpperCase() + claim.confidence.slice(1)} confidence
        </span>
      </div>
      <p className="mt-1.5 text-[0.82rem] leading-snug">
        {onSelect ? (
          <button type="button" onClick={() => onSelect(claim.id)} className="app-control text-left underline-offset-2 hover:underline">
            {claim.claimText}
          </button>
        ) : (
          claim.claimText
        )}
      </p>
      {claim.scores.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {claim.scores.map((score) => (
            <ClaimScoreChip key={score.dimension} score={score} />
          ))}
        </ul>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={expanded} className="app-control mt-1 text-[0.72rem] underline">
        {expanded ? "Hide evidence" : "Evidence and details"}
      </button>
      {expanded && (
        <div className="app-panel-enter mt-1.5 border-t border-[var(--color-border)] pt-1.5 text-[0.78rem]">
          <p className="border-l-2 border-[var(--color-border)] pl-2 text-[0.72rem] italic text-[var(--color-text-muted)]">
            “{claim.supportingExcerpt}”
          </p>
          <p className="mt-1.5 text-[0.72rem] text-[var(--color-text-muted)]">
            Section: {claim.section} · source: {SOURCE_SCOPE_LABEL[claim.sourceScope]} · provenance:{" "}
            {claim.model ? `${claim.model}, ` : ""}prompt {claim.promptVersion}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-border)] pt-2 text-[0.72rem]">
            {locatableBlockId && onLocatePassage && (
              <button type="button" className="app-control underline" onClick={() => onLocatePassage(locatableBlockId)}>
                Locate passage
              </button>
            )}
            {writerEnabled && claim.supportingExcerpt && (
              <InsertIntoWriterButton
                quote={claim.supportingExcerpt}
                attribution={`${CLAIM_NATURE_LABEL[claim.claimNature]} claim, ${claim.section} (${SOURCE_SCOPE_LABEL[claim.sourceScope]})`}
                sourceLabel="Reader"
                className="app-control underline"
              />
            )}
            <a className="app-control ml-auto underline" href={`/research/claims/${claim.id}`}>
              Open full claim →
            </a>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Sidebar "Claims" tab (Phase 28.3, plan §"Web surfaces (reader)"): a
 * `EditionAnnotationsPanel` sibling of "Annotations"/"Critical notes", same
 * flat-card-list convention as `NotesTab`. Each card is self-contained
 * (claim text, nature, dimension score chips with signals on expand,
 * verification status, confidence, provenance, and a "Locate passage"
 * affordance) — no separate index/detail split, since the underlying data
 * (unlike passage annotations) has no reader-level/relationship filters yet.
 */
export function ClaimsTab({
  claims,
  blocks,
  activeId,
  onSelectClaim,
  onLocatePassage,
  writerEnabled,
}: {
  claims: ResearchClaimSummary[];
  blocks: EditionPayload["blocks"];
  activeId: string | null;
  onSelectClaim?: (id: string) => void;
  onLocatePassage?: (textBlockId: string) => void;
  writerEnabled?: boolean;
}) {
  if (claims.length === 0) {
    return <p className="px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">No research claims for this work yet.</p>;
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-3">
      <p className="px-1 text-[0.68rem] text-[var(--color-text-muted)]">
        Falsifiable assertions extracted from this work&apos;s own text, each traceable to a literal excerpt. A dashed in-text
        marker means the claim was re-matched on read, not DB-anchored.
      </p>
      <ul className="flex flex-col gap-2">
        {claims.map((claim) => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            matchedBlockId={claim.anchorState === "unanchored" ? (matchClaimToBlock(claim, blocks)?.blockId ?? null) : null}
            active={activeId === claim.id}
            activationId={activeId}
            onSelect={onSelectClaim}
            onLocatePassage={onLocatePassage}
            writerEnabled={writerEnabled}
          />
        ))}
      </ul>
    </div>
  );
}
