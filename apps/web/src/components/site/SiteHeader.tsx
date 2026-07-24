import Link from "next/link";
import { isBetaTestingMode } from "@ice/config";
import { auth } from "@/lib/auth";
import { BetaBadge } from "@/components/shared/BetaBadge";
import { SiteThemeToggle } from "@/components/site/SiteThemeToggle";
import { SoundToggle } from "@/components/site/SoundToggle";
import { Wordmark } from "@/components/site/Wordmark";
import { ScrollAwareHeader } from "@/components/site/ScrollAwareHeader";

/**
 * Public site masthead for the landing and policy pages, restyled to the
 * campaign site's editorial masthead (see `.masthead` in
 * apps/web/src/app/site-theme.css). Shared by `/`, `/privacy`, and
 * `/terms` — nothing else renders it.
 *
 * The section links are absolute (`/#graph`, not `#graph`) so they still
 * work from the policy pages, where those sections don't exist. They are
 * hidden below 980px, where the campaign layout drops the nav entirely.
 *
 * The CTA keeps the pre-existing auth-aware behavior — a signed-in
 * visitor is never sent back through signup — and additionally drops
 * "Get started" while beta testing is on, since registration is closed
 * for the duration and `/signup` renders only a contact notice.
 */
export async function SiteHeader() {
  const session = await auth();
  const signedIn = Boolean(session?.user?.id);
  const betaTestingMode = isBetaTestingMode();

  return (
    <ScrollAwareHeader className="masthead">
      <div className="brand-group">
        <Wordmark href="/" className="brand" />
        {betaTestingMode && <BetaBadge />}
      </div>
      <nav aria-label="Primary navigation">
        <Link className="nav" data-sound="click" href="/#workspace">Workspace</Link>
        <Link className="nav" data-sound="click" href="/#reader">Reader</Link>
        <Link className="nav" data-sound="click" href="/#library">Library</Link>
        <Link className="nav" data-sound="click" href="/#graph">Graph</Link>
        <Link className="nav" data-sound="click" href="/#ask">Ask Library</Link>
      </nav>
      <div className="masthead-end">
        <SiteThemeToggle />
        <SoundToggle className="theme-toggle" />
        {signedIn ? (
          <Link href="/dashboard" className="nav-cta">
            Your library
          </Link>
        ) : betaTestingMode ? (
          <Link href="/login" className="nav-cta">
            Log in
          </Link>
        ) : (
          <Link href="/signup" className="nav-cta">
            Get started
          </Link>
        )}
      </div>
    </ScrollAwareHeader>
  );
}
