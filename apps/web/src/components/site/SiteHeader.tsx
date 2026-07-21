import Link from "next/link";
import { auth } from "@/lib/auth";
import { SITE_NAME } from "@/lib/brand";

/**
 * Public site header for the landing and policy pages. Adapts its CTA to
 * whether the visitor is already signed in (avoids sending a logged-in
 * user back through signup).
 */
export async function SiteHeader() {
  const session = await auth();
  const signedIn = Boolean(session?.user?.id);

  return (
    <header className="border-b border-[var(--color-border)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-serif text-lg font-semibold text-[var(--color-text)]">
          {SITE_NAME}
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {signedIn ? (
            <Link
              href="/dashboard"
              className="rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-[var(--color-background)]"
            >
              Your library
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-[var(--color-background)]"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
