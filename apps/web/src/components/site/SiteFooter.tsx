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
      <Link href="/" className="brand" aria-label={`${SITE_NAME} home`}>
        <Mark small />
        <span>{SITE_NAME}</span>
      </Link>
      <p>{SITE_NAME} is a research aid, not a substitute for reading primary sources.</p>
      <nav aria-label="Footer navigation">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/login">Log in</Link>
        <a href={DOCUMENTATION_URL} target="_blank" rel="noopener noreferrer">
          Documentation
        </a>
      </nav>
    </footer>
  );
}
