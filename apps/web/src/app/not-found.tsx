import Link from "next/link";

export default function NotFound() {
  return <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col justify-center px-6"><p className="text-sm text-[var(--color-text-muted)]">404</p><h1 className="mt-2 font-serif text-4xl font-semibold">That page is not here.</h1><p className="mt-3 text-[var(--color-text-muted)]">It may have moved, been deleted, or require a different account.</p><Link href="/" className="mt-6 w-fit rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm font-medium text-[var(--color-background)]">Back to Palimnote</Link></main>;
}
