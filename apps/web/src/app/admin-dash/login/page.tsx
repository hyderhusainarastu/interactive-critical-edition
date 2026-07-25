import { redirect } from "next/navigation";
import { isAdminDashAuthed } from "@/lib/adminDash";

/**
 * Workstream H (v.5): the ONE unguarded page in the `/admin-dash` tree —
 * deliberately outside the `(dash)` route group so `requireAdminDash()`
 * never runs here (that would make logging in impossible). Never linked
 * from any nav, footer, or sitemap — this repo has no `sitemap.ts`/
 * `robots.ts` to accidentally list it in either. Minimal on purpose: a
 * plain `<form method="POST">` posting straight to the route handler, no
 * client JS required to log in.
 */
export default async function AdminDashLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  if (await isAdminDashAuthed()) redirect("/admin-dash");

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-24">
      <h1 className="font-serif text-2xl font-semibold text-[var(--color-text)]">Admin</h1>

      {params.error && (
        <p className="rounded-md bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent-burgundy)]">
          Invalid username or password.
        </p>
      )}

      <form method="POST" action="/api/admin-dash/login" className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
          Username
          <input
            name="username"
            type="text"
            required
            autoComplete="username"
            className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="min-h-11 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-[var(--color-background)]"
        >
          Log in
        </button>
      </form>
    </main>
  );
}
