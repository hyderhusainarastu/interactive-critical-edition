/**
 * Shared roadmap presentation primitives (Phase 22.1, plan §22.2).
 *
 * The landing page's Roadmap showcase is the frozen visual contract
 * (Phase 19.4). `TIER_COLOR` moved verbatim from `RoadmapView.tsx` so the
 * landing depiction's three example tiers and the real Roadmap's seven
 * tiers resolve their accent colors from one mapping; `RoadmapStageRow`
 * is the landing's stage-row markup moved verbatim out of `page.tsx`, and
 * is the presentation contract the real `RoadmapCard`'s opening row
 * converges toward in Phase 22.4 (the real card layers its extra controls
 * — understanding slider, status select, hide — beneath it).
 *
 * No hooks, no client directive — usable from the server-rendered landing
 * page and from "use client" views alike.
 */
import type { PriorityTier } from "@ice/roadmap";

// Tier → palette accent (shared with the reader's visual language).
export const TIER_COLOR: Record<PriorityTier, string> = {
  essential: "--color-accent-burgundy",
  high: "--color-accent-ink",
  strongly_recommended: "--color-accent-green",
  contextual: "--color-accent-umber",
  interpretive_aid: "--color-accent-ink",
  comparative: "--color-accent-umber",
  optional: "--color-text-muted",
};

/**
 * The small colored tier dot (h-2.5 w-2.5 rounded-full). Decorative by
 * construction (`aria-hidden`) — every call site pairs it with a visible
 * tier label, never color alone (plan §20). Positioning/display classes
 * stay at the call site via `className`.
 */
export function TierDot({ colorVar, className }: { colorVar: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={"h-2.5 w-2.5 rounded-full" + (className ? ` ${className}` : "")}
      style={{ background: `var(${colorVar})` }}
    />
  );
}

/**
 * One roadmap stage row: numeral → tier dot → tier label (small caps, in
 * the tier color) → title → reason. Verbatim from the landing showcase's
 * per-item markup (the tier-label color moves from a Tailwind
 * arbitrary-value class to an inline style because the color is now a
 * parameter — computed styles are identical).
 */
export function RoadmapStageRow({
  index,
  colorVar,
  tierLabel,
  title,
  reason,
}: {
  index: number;
  colorVar: string;
  tierLabel: string;
  title: React.ReactNode;
  reason: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <span className="mt-0.5 font-mono text-sm text-[var(--color-text-muted)]">{index}</span>
      <TierDot colorVar={colorVar} className="mt-1 shrink-0" />
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: `var(${colorVar})` }}>
          {tierLabel}
        </p>
        <p className="font-medium text-[var(--color-text)]">{title}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{reason}</p>
      </div>
    </div>
  );
}
