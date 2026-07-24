/**
 * Temporary owner-requested beta marker (2026-07-23): a small bordered pill
 * shown in the header on every page while `BETA_TESTING_MODE` is on. Uses
 * the credibility-warning accent (reads as "caution/beta") but never relies
 * on color alone — the text itself says "Beta testing". Remove alongside
 * `isBetaTestingMode()` once the beta period ends.
 */
export function BetaBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--color-credibility-warning)] px-2 py-0.5 text-xs font-medium text-[var(--color-credibility-warning)]">
      Beta testing
    </span>
  );
}
