import Link from "next/link";

/**
 * Owner-requested version marker: a small bordered link shown in every header.
 * Reads
 * as "caution/beta" but never relies on color alone — the text itself names
 * the beta version.
 *
 * Uses `--color-beta-badge`, not `--color-credibility-warning` as it
 * originally did: at this 12px size that token measured 4.48:1 on the page
 * background, just under the 4.5:1 AA floor. See the token's comment in
 * globals.css for why it was split out rather than the credibility token
 * being darkened.
 */
export function BetaBadge() {
  return (
    <Link
      href="/development"
      className="beta-badge app-press"
      aria-label="Beta v.6 — view Palimnote development"
    >
      Beta v.6
    </Link>
  );
}
