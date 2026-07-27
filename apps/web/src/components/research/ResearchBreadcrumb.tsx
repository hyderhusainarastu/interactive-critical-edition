import Link from "next/link";

/**
 * Item 2 of the Research-workspace fix lane: no breadcrumb pattern existed
 * anywhere in the app before this (checked the reader/works/writer headers —
 * each uses a one-off "Back to X" link at most, never a full trail), so this
 * is a new, modest, shared strip rather than an adaptation of an existing
 * one. Every research route composes it the same way: `/research` first,
 * then each ancestor down to the current page, which renders as plain text
 * (`aria-current="page"`), never a link. Doubles as the "back to parent
 * list" affordance the plan calls for — the second-to-last crumb IS that
 * parent list's own link.
 */

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function ResearchBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-1">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm font-medium text-[var(--color-accent)]">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isLink = Boolean(item.href) && !isLast;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-x-1">
              {index > 0 && (
                <span aria-hidden="true" className="text-[var(--color-text-muted)]">
                  /
                </span>
              )}
              {isLink ? (
                <Link
                  href={item.href as string}
                  className="app-control app-press inline-flex min-h-11 items-center rounded px-1 underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className="inline-flex min-h-11 items-center px-1 text-[var(--color-text-muted)]"
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
