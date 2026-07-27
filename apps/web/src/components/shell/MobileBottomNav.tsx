"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buildWorkspaceNavItems, isNavItemActive, isReadSectionActive } from "./navItems";

const ICONS: Record<string, string> = {
  home: "⌂",
  read: "📖",
  research: "🔎",
  write: "✎",
};

/**
 * Mobile (<768px) bottom navigation (redesign-shell-spec.md §2.2/§2.4):
 * Home/Read/Research/Write, safe-area aware, 44px+ touch targets. Always
 * mounted alongside `WorkspaceRail` — a CSS media query (`md:hidden` here,
 * `hidden md:flex` on the rail) decides which one is actually visible, so
 * there is no client-side viewport detection and no hydration mismatch risk
 * (same technique the pre-Stage-1 header already used for its own
 * `hidden md:flex`/`md:hidden` split).
 */
export function MobileBottomNav({
  writerEnabled,
  researchEnabled,
}: {
  writerEnabled: boolean;
  researchEnabled: boolean;
}) {
  const pathname = usePathname();
  const items = buildWorkspaceNavItems({ writerEnabled, researchEnabled });

  return (
    <nav
      aria-label="Primary navigation"
      className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--color-border)] bg-[var(--color-rail-surface)] md:hidden"
    >
      {items.map((item) => {
        const active = item.key === "read" ? isReadSectionActive(pathname) : isNavItemActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            data-sound="click"
            aria-current={active ? "page" : undefined}
            className={`app-control flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 py-1 text-xs ${
              active ? "font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]"
            }`}
          >
            <span aria-hidden="true" className="text-base leading-none">{ICONS[item.key]}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
