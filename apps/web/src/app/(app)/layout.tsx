import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";

/**
 * Single, centralized auth check for every route under (app) — replaces
 * the Phase 1 pattern of checking auth() in each page individually,
 * per the "revisit once Phase 2 adds more protected pages" note in
 * CLAUDE.md. Still Node-runtime (not Edge middleware) since the
 * sessionVersion revocation check needs postgres.js.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
        <nav className="flex items-center gap-6 text-sm">
          <Link
            href="/dashboard"
            className="font-semibold text-[var(--color-text)]"
          >
            Interactive Critical Edition
          </Link>
          <Link href="/upload" className="text-[var(--color-text-muted)]">
            Upload
          </Link>
        </nav>
        <div className="flex items-center gap-4 text-sm text-[var(--color-text-muted)]">
          <span>{session.user.email}</span>
          <form action={logoutAction}>
            <button type="submit" className="underline">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
