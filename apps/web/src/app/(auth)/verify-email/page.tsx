import Link from "next/link";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="mx-auto flex max-w-sm flex-col gap-4 px-6 py-24 text-center">
      <h1 className="text-2xl font-semibold text-[var(--color-text)]">
        Check your email
      </h1>

      {params.sent && (
        <p className="text-[var(--color-text-muted)]">
          We sent a verification link to your email address. Click it to
          activate your account, then log in.
        </p>
      )}
      {params.error && (
        <p className="rounded-md bg-[var(--color-surface)] px-4 py-3 text-sm text-[var(--color-accent-burgundy)]">
          That verification link is invalid or has expired. Sign up again to
          get a new one.
        </p>
      )}
      {!params.sent && !params.error && (
        <p className="text-[var(--color-text-muted)]">
          Waiting on a verification email? Check your inbox for the link we
          sent when you signed up.
        </p>
      )}

      <Link href="/login" className="text-[var(--color-accent-ink)] underline">
        Back to log in
      </Link>
    </main>
  );
}
