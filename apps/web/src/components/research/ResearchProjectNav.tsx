"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Persistent project subnav (stage5-research-spec.md §2.2). Rendered once by
 * `app/(app)/research/[projectId]/layout.tsx` above every project route's
 * own `{children}` — every page keeps its own `<h1>`/`ResearchBreadcrumb`
 * unchanged (§2.4). Plain `<nav>` of route links, not `role="tablist"`: each
 * tab is a genuine navigation to a different page's content, not an
 * ARIA-tabs single-page pattern — the same distinction `ResearchBreadcrumb`
 * already draws with its own `<nav><ol>` idiom.
 */

type Tab = { key: string; label: string; href: string };

function tabsFor(projectId: string, monitoringEnabled: boolean): Tab[] {
  const tabs: Tab[] = [
    { key: "overview", label: "Overview", href: `/research/${projectId}` },
    { key: "corpus", label: "Corpus", href: `/research/${projectId}/corpus` },
    { key: "claims", label: "Claims", href: `/research/${projectId}/claims` },
    { key: "debates", label: "Debates", href: `/research/${projectId}/debates` },
    { key: "chambers", label: "Evidence Chambers", href: `/research/${projectId}/chambers` },
    { key: "hypotheses", label: "Hypotheses", href: `/research/${projectId}/hypotheses` },
  ];
  // Monitors is a project-scoped section gated by a second flag beyond
  // `research` — omitted entirely (not disabled) when off, the same
  // "hide the door rather than show a locked one" posture flag-gated nav
  // already uses elsewhere in this codebase.
  if (monitoringEnabled) {
    tabs.push({ key: "monitors", label: "Monitors", href: `/research/${projectId}/monitors` });
  }
  tabs.push({ key: "graph", label: "Knowledge Map", href: `/research/${projectId}/graph` });
  return tabs;
}

/** Overview's own href (`/research/[id]`) is a literal prefix of every other
 *  tab's href, so it needs an exact match; every other tab correctly stays
 *  active on its own nested routes (e.g. `/research/[id]/debates/[clusterId]`
 *  still highlights "Debates") via a prefix match. The project-scoped
 *  Monitors href (`/research/[id]/monitors`) is a different path from the
 *  global `/research/monitors` route entirely, so no extra guard is needed
 *  to keep the two from cross-matching. */
function isActive(pathname: string, tab: Tab, overviewHref: string): boolean {
  if (tab.href === overviewHref) return pathname === overviewHref;
  return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

export function ResearchProjectNav({ projectId, monitoringEnabled }: { projectId: string; monitoringEnabled: boolean }) {
  const pathname = usePathname();
  const overviewHref = `/research/${projectId}`;
  const tabs = tabsFor(projectId, monitoringEnabled);

  return (
    <nav
      aria-label="Research project sections"
      className="mx-auto max-w-5xl border-b border-[var(--color-border)] px-4 pt-6 pb-2 sm:px-6"
    >
      <ul className="flex flex-wrap gap-1">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab, overviewHref);
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`app-control app-press inline-flex min-h-11 items-center rounded-md px-3 text-sm ${
                  active
                    ? "bg-[var(--color-rail-active-bg)] font-medium text-[var(--color-rail-active-fg)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
