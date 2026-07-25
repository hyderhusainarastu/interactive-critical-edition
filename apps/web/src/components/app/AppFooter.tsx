import Link from "next/link";
import { Mark } from "@/components/site/Mark";
import { FeedbackModal, FeedbackTrigger } from "@/components/shared/FeedbackModal";

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
 *
 * Workstream J (v.5): also mounts the singleton `FeedbackModal` (see that
 * file's doc comment for the open-event contract) alongside the visible
 * `FeedbackTrigger` button. The modal itself renders as a `role="dialog"`
 * outside the `<footer>` landmark — nested inside it is misleading landmark
 * structure for an overlay that isn't footer content once open.
 */
export function AppFooter() {
  return (
    <>
      <footer className="border-t border-[var(--color-border)] px-4 py-6 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-3 text-center text-xs text-[var(--color-text-muted)] sm:flex-row sm:justify-between sm:text-left">
          <span className="flex shrink-0 items-center gap-2 font-serif text-sm text-[var(--color-text)]">
            <Mark small />
            Palimnote
          </span>
          <p className="max-w-md">Palimnote is a research aid, not a substitute for reading primary sources.</p>
          <nav className="flex items-center gap-4" aria-label="Footer navigation">
            <Link href="/development" className="hover:text-[var(--color-text)]">Development</Link>
            <Link href="/privacy" className="hover:text-[var(--color-text)]">Privacy</Link>
            <Link href="/terms" className="hover:text-[var(--color-text)]">Terms</Link>
            <FeedbackTrigger className="app-control hover:text-[var(--color-text)]" />
          </nav>
        </div>
      </footer>
      <FeedbackModal authenticated />
    </>
  );
}
