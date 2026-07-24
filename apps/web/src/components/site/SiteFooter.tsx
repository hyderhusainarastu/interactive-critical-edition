import Link from "next/link";
import { SITE_NAME } from "@/lib/brand";
import { DOCUMENTATION_URL } from "@/components/site/links";
import { Mark } from "@/components/site/Mark";

/**
 * Public site footer, restyled to the campaign site's footer (see
 * `footer` in apps/web/src/app/site-theme.css). Shared by `/`,
 * `/privacy`, and `/terms`.
 */
export function SiteFooter() {
  return (
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
          <a href="mailto:harastu@usf.edu?subject=Palimnote%20feedback">Feedback</a>
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
  );
}
