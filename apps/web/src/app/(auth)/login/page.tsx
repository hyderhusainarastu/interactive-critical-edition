import Link from "next/link";
import { isBetaTestingMode } from "@ice/config";
import { loginAction } from "@/lib/actions";
import { BetaBadge } from "@/components/shared/BetaBadge";
import { BetaNotice } from "@/components/shared/BetaNotice";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; verified?: string; reset?: string }>;
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
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">Log in</h1>

      {betaTestingMode && <BetaNotice />}

      {params.verified && (
        <p className="rounded-md bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent-green)]">
          Email verified — you can log in now.
        </p>
      )}
      {params.reset && (
        <p className="rounded-md bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent-green)]">
          Password updated — log in with your new password.
        </p>
      )}
      {params.error && (
        <p className="rounded-md bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent-burgundy)]">
          Invalid email or password, or your email isn&apos;t verified yet.
        </p>
      )}

      <form action={loginAction} className="flex flex-col gap-4">
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
            autoComplete="current-password"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-[var(--color-background)]"
        >
          Log in
        </button>
      </form>

      <div className="flex justify-between text-sm text-[var(--color-text-muted)]">
        <Link href="/signup">Create an account</Link>
        <Link href="/reset-password">Forgot password?</Link>
      </div>
    </main>
  );
}
