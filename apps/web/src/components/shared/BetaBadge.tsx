/**
 * Temporary owner-requested beta marker (2026-07-23): a small bordered pill
 * shown in the header on every page while `BETA_TESTING_MODE` is on. Reads
 * as "caution/beta" but never relies on color alone — the text itself says
 * "Beta testing". Remove alongside `isBetaTestingMode()` once the beta
 * period ends.
 *
 * Uses `--color-beta-badge`, not `--color-credibility-warning` as it
 * originally did: at this 12px size that token measured 4.48:1 on the page
 * background, just under the 4.5:1 AA floor. See the token's comment in
 * globals.css for why it was split out rather than the credibility token
 * being darkened.
 */
export function BetaBadge() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-[var(--color-beta-badge)] px-2 py-0.5 text-xs font-medium text-[var(--color-beta-badge)]">
      Beta testing
    </span>
  );
}
