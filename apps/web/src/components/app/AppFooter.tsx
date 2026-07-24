import Link from "next/link";
import { Mark } from "@/components/site/Mark";

/**
 * Minimal footer for the signed-in app shell (UI-overhaul spec §2.3). The
 * shell previously had none. Modeled on the public `SiteFooter`'s markup
 * shape (brand mark + one-line tagline + a short nav) but styled with
 * plain `var(--color-*)`-driven Tailwind classes rather than the
 * `.pal-site`-scoped `site-theme.css` rules — this component renders
 * outside that scope and already inherits the landing palette via the
 * token swap in globals.css, with no class-scoping needed or wanted.
 *
 * Deliberately light-touch: a reading-heavy app doesn't want a large
 * marketing-style footer repeating on every page, so this is one thin
 * row, not a port of the public footer's full column layout.
 */
export function AppFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] px-4 py-6 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 text-center text-xs text-[var(--color-text-muted)] sm:flex-row sm:justify-between sm:text-left">
        <span className="flex shrink-0 items-center gap-2 font-serif text-sm text-[var(--color-text)]">
          <Mark small />
          Palimnote
        </span>
        <p className="max-w-md">Palimnote is a research aid, not a substitute for reading primary sources.</p>
        <nav className="flex items-center gap-4" aria-label="Footer navigation">
          <Link href="/privacy" className="hover:text-[var(--color-text)]">Privacy</Link>
          <Link href="/terms" className="hover:text-[var(--color-text)]">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}
