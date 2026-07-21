"use client";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="mx-auto max-w-xl px-6 py-16"><h1 className="font-serif text-3xl font-semibold">This workspace view could not load</h1><p className="mt-3 text-[var(--color-text-muted)]">Your work is safe. Check your connection, then try this view again.</p><button type="button" onClick={reset} className="mt-6 rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm font-medium text-[var(--color-background)]">Try again</button></div>;
}
