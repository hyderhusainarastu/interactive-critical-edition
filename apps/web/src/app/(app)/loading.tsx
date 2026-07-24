export default function AppLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6" role="status" aria-label="Loading workspace">
      <div className="app-shimmer app-skeleton h-7 w-48 bg-[var(--color-surface)]" />
      <div className="app-reveal-stagger mt-6 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="app-card app-shimmer app-skeleton h-36 rounded-lg" />
        ))}
      </div>
      <span className="sr-only">Loading workspace…</span>
    </div>
  );
}
