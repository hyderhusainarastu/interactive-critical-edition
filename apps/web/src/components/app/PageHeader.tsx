export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Optional small uppercase label above the title (UI-overhaul spec
   * §2.2), matching the landing's `.section-index`/`.kicker` convention.
   * No default — existing call sites are unaffected unless they opt in. */
  eyebrow?: string;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-[var(--color-border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-[10px] font-bold uppercase tracking-[.13em] text-[var(--color-accent-burgundy)]">{eyebrow}</p>}
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-[var(--color-text)] sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
