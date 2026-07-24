import Link from "next/link";
import { isBetaTestingMode } from "@ice/config";
import { registerAction } from "@/lib/actions";
import { BetaBadge } from "@/components/shared/BetaBadge";
import { BetaNotice } from "@/components/shared/BetaNotice";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const betaTestingMode = isBetaTestingMode();

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-24">
      {betaTestingMode && (
        <header className="flex items-center">
          <BetaBadge />
        </header>
      )}
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">
        Create an account
      </h1>

      {betaTestingMode ? (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">
            New registrations are closed during the beta.
          </p>
          <BetaNotice />
        </>
      ) : (
        <>
          {params.error && (
            <p className="rounded-md bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent-burgundy)]">
              Please check your details and try again (password must be at least
              8 characters).
            </p>
          )}

          <form action={registerAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
              Name
              <input
                name="name"
                type="text"
                required
                autoComplete="name"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
              Password
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-[var(--color-background)]"
            >
              Sign up
            </button>
          </form>

          <p className="text-sm text-[var(--color-text-muted)]">
            Already have an account? <Link href="/login">Log in</Link>
          </p>
        </>
      )}
    </main>
  );
}
