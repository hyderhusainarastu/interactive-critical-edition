import Link from "next/link";
import { requestResetAction, resetPasswordAction } from "@/lib/actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{
    token?: string;
    email?: string;
    sent?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const hasToken = Boolean(params.token && params.email);

  if (hasToken) {
    return (
      <main className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-24">
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          Set a new password
        </h1>

        {params.error && (
          <p className="rounded-md bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent-burgundy)]">
            That reset link is invalid or has expired. Request a new one.
          </p>
        )}

        <form action={resetPasswordAction} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={params.token} />
          <input type="hidden" name="email" value={params.email} />
          <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
            New password
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
            Update password
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-24">
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">
        Reset your password
      </h1>

      {params.sent ? (
        <p className="text-[var(--color-text-muted)]">
          If an account exists for that email, we sent a password reset
          link.
        </p>
      ) : (
        <form action={requestResetAction} className="flex flex-col gap-4">
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
          <button
            type="submit"
            className="rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-[var(--color-background)]"
          >
            Send reset link
          </button>
        </form>
      )}

      <Link href="/login" className="text-sm text-[var(--color-accent-ink)] underline">
        Back to log in
      </Link>
    </main>
  );
}
