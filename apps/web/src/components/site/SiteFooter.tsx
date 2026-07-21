import Link from "next/link";
import { SITE_NAME } from "@/lib/brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-border)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-[var(--color-text-muted)] sm:flex-row sm:items-center sm:justify-between">
        <p>
          {SITE_NAME} — an AI-assisted research aid, not a substitute for reading primary sources.
        </p>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/privacy" className="hover:text-[var(--color-text)]">
            Privacy &amp; copyright
          </Link>
          <Link href="/terms" className="hover:text-[var(--color-text)]">
            Terms
          </Link>
          <Link href="/login" className="hover:text-[var(--color-text)]">
            Log in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
