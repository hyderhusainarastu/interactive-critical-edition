import Link from "next/link";
import { requireAdminDash } from "@/lib/adminDash";

/**
 * Workstream H (v.5): the guarded shell for every real admin-dash page.
 * `requireAdminDash()` here is belt; every page under this layout ALSO
 * calls it itself (braces) — this repo has no middleware, so a page that
 * somehow rendered without this layout (there isn't one, but the plan is
 * explicit about not relying on that) still 404s on its own.
 */
export default async function AdminDashLayout({ children }: { children: React.ReactNode }) {
  await requireAdminDash();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--color-border)] pb-4">
        <div className="flex flex-wrap items-center gap-6">
          <h1 className="font-serif text-xl font-semibold text-[var(--color-text)]">Admin dashboard</h1>
          <nav className="flex gap-4 text-sm" aria-label="Admin dashboard">
            <Link href="/admin-dash" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              Overview
            </Link>
            <Link href="/admin-dash/users" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              Users
            </Link>
            <Link href="/admin-dash/feedback" className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
              Feedback
            </Link>
          </nav>
        </div>
        <form method="POST" action="/api/admin-dash/logout">
          <button
            type="submit"
            className="min-h-11 rounded-md border border-[var(--color-border)] px-3 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Log out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
