import Link from "next/link";
import { SITE_NAME } from "@/lib/brand";
import { DOCUMENTATION_URL } from "@/components/site/links";
import { Mark } from "@/components/site/Mark";
import { FeedbackModal, FeedbackTrigger } from "@/components/shared/FeedbackModal";
import { auth } from "@/lib/auth";

/**
 * Public site footer, restyled to the campaign site's footer (see
 * `footer` in apps/web/src/app/site-theme.css). Shared by `/`,
 * `/privacy`, and `/terms`.
 *
 * Workstream J (v.5): the old `mailto:` "Feedback" link is replaced by the
 * real in-app mechanism — a `FeedbackTrigger` opening the singleton
 * `FeedbackModal` (mounted here, alongside `AppFooter`'s copy for the
 * signed-in shell; see that component's doc comment for the open-event
 * contract). This is now an async server component (matching
 * `SiteHeader`'s own `auth()` call) so the modal knows, without any prop
 * threading through `page.tsx`/`PolicyPageLayout`/`development/page.tsx`,
 * whether to show the optional email field — a visitor already signed in
 * needs no separate way to be reached back.
 */
export async function SiteFooter() {
  const session = await auth();
  const signedIn = Boolean(session?.user?.id);

  return (
    <>
      <footer>
        <div className="footer-brand">
          <Link href="/" className="brand" aria-label={`${SITE_NAME} home`}>
            <Mark small />
            <span>{SITE_NAME}</span>
          </Link>
          <p>The map in the margins.</p>
        </div>
        <p className="footer-statement">
          A research aid for reading difficult texts in company with their sources — never a substitute for the primary
          work.
        </p>
        <div className="footer-links">
          <nav aria-label="Product navigation">
            <Link href="/development">Development</Link>
            <FeedbackTrigger className="app-control" />
            <Link href="/login">Log in</Link>
          </nav>
          <nav aria-label="Policy navigation">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href={DOCUMENTATION_URL} target="_blank" rel="noopener noreferrer">
              Documentation
            </a>
          </nav>
        </div>
      </footer>
      <FeedbackModal authenticated={signedIn} />
    </>
  );
}
