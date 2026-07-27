/**
 * Generic empty/loading/error-state card (redesign-shell-spec.md §5.2),
 * implementing charter §7's "every loading, empty, unavailable, partial,
 * failed, and retrying state must explain what happened and what the user
 * can do." Stage 1 uses this once (the mobile Read-management sheet's empty
 * state) and makes it available for later stages instead of each one
 * re-inventing its own empty-state markup.
 */
export function EmptyState({
  icon,
  heading,
  body,
  action,
}: {
  icon?: React.ReactNode;
  heading: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="app-empty flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] px-6 py-10 text-center">
      {icon && <div aria-hidden="true" className="text-2xl text-[var(--color-text-muted)]">{icon}</div>}
      <h2 className="font-serif text-base font-semibold text-[var(--color-text)]">{heading}</h2>
      <p className="max-w-sm text-sm text-[var(--color-text-muted)]">{body}</p>
      {action}
    </div>
  );
}
