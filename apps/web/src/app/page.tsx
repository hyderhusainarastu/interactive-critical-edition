export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-sm font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
        Phase 1 — Foundation
      </p>
      <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-[var(--color-text)]">
        Interactive Critical Edition
      </h1>
      <p className="mt-4 max-w-lg text-lg text-[var(--color-text-muted)]">
        Scaffold is live. Auth, library, reader, and roadmap land in the
        phases that follow — see <code>CLAUDE.md</code> for current status.
      </p>
    </main>
  );
}
