"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LiveRegion } from "@/components/primitives/LiveRegion";
import { BetaBadge } from "@/components/shared/BetaBadge";
import { Wordmark } from "@/components/site/Wordmark";
import { READ_SUBNAV, buildWorkspaceNavItems, isNavItemActive, isReadSectionActive } from "./navItems";
import { UploadAction } from "./UploadAction";
import { WorkspaceRailItem } from "./WorkspaceRailItem";

const RAIL_COLLAPSE_STORAGE_KEY = "palimnote:rail-collapsed";

const ICONS: Record<string, string> = {
  home: "⌂",
  read: "📖",
  research: "🔎",
  write: "✎",
};

function readStoredCollapsed(): boolean {
  try {
    return window.localStorage.getItem(RAIL_COLLAPSE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * Desktop/tablet workspace rail (redesign-shell-spec.md §2.2/§2.3/§3).
 * Tablet (768–1023px) is forced collapsed via a CSS media query regardless
 * of the stored preference (charter §6: tablet is not user-toggleable);
 * desktop (>=1024px) honors the user's own collapse choice, persisted to
 * `localStorage` only (§2.5 — not a `WorkspacePreferences` field, same
 * precedent as `GlobalRagSidebar`'s stored width).
 */
export function WorkspaceRail({
  writerEnabled,
  researchEnabled,
  immersive,
}: {
  writerEnabled: boolean;
  researchEnabled: boolean;
  immersive: boolean;
}) {
  const pathname = usePathname();
  const items = buildWorkspaceNavItems({ writerEnabled, researchEnabled });
  const hasReadItem = items.some((item) => item.key === "read");
  const readSubnavId = useId();
  // SSR always renders expanded; the client corrects itself before paint via
  // this lazy initializer (same pattern as GlobalRagSidebar's stored width).
  const [collapsed, setCollapsed] = useState<boolean>(() => (typeof window === "undefined" ? false : readStoredCollapsed()));
  const [announcement, setAnnouncement] = useState("");
  const [readOpen, setReadOpen] = useState(true);
  // Ensures the immersive auto-collapse convenience (§4) only ever writes a
  // default once per mount, and only when the user has never made an
  // explicit choice — it must never override a stored preference.
  const autoCollapseAppliedRef = useRef(false);

  useEffect(() => {
    if (!immersive || autoCollapseAppliedRef.current) return;
    autoCollapseAppliedRef.current = true;
    try {
      if (window.localStorage.getItem(RAIL_COLLAPSE_STORAGE_KEY) === null) {
        window.localStorage.setItem(RAIL_COLLAPSE_STORAGE_KEY, "true");
        // One-time default write on first landing on an immersive route this
        // session, never a subsequent override — same precedent as
        // WorkspacePreferencesProvider's own local-storage reconciliation
        // effect.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCollapsed(true);
      }
    } catch {
      // A blocked localStorage just skips this convenience — the rail stays
      // in whatever state it already rendered.
    }
  }, [immersive]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(RAIL_COLLAPSE_STORAGE_KEY, String(next));
      } catch {
        // Collapse state simply won't survive a reload in this browser.
      }
      setAnnouncement(next ? "Navigation collapsed" : "Navigation expanded");
      return next;
    });
  }, []);

  return (
    <div
      data-collapsed={collapsed}
      // D-a11y-s7-4 (a11y-proxy/cross-browser finding #4, React hydration
      // error #418): this component's own doc comment above already says
      // "SSR always renders expanded; the client corrects itself before
      // paint via this lazy initializer" — an intentional FOUC-avoidance
      // divergence, same shape as `PreferenceBootstrap`'s `<html>` script
      // (`layout.tsx`). React's hydration diff doesn't know that
      // divergence is deliberate, so once a session has ever visited an
      // immersive route (localStorage's collapse preference now `true`)
      // and then does a fresh full navigation elsewhere, this div's very
      // first client render legitimately disagrees with the server's
      // always-`false` default — reproduced directly via a fresh
      // `layout.tsx`+`hydration-smoke.spec.ts` walk. `suppressHydrationWarning`
      // is the same, correct, one-level-deep fix as `<html>`'s.
      suppressHydrationWarning
      className="workspace-rail hidden shrink-0 flex-col border-e border-[var(--color-border)] bg-[var(--color-rail-surface)] md:fixed md:inset-y-0 md:start-0 md:z-20 md:flex"
    >
      <div className="flex min-h-14 items-center gap-2 px-3">
        <Wordmark href="/dashboard" className="shrink-0 font-serif text-lg font-semibold tracking-tight text-[var(--color-text)]" />
        <span className="rail-label"><BetaBadge /></span>
      </div>
      {/*
        Deliberately two SIBLING `<nav>` landmarks, not one nested inside
        the other: the Read subnav (Reading Queue/Library/Upload) is a
        secondary group, not itself one of the four primary destinations,
        so it must not appear inside `getByRole("navigation", { name:
        "Primary navigation" })`'s own link list — that landmark's content
        is exactly Home/Read/Research/Write (redesign-shell-spec.md §3.1,
        §7's compat table: "the primary-nav landmark's link text equals
        exactly [...]").
      */}
      <nav aria-label="Primary navigation" className="flex flex-col gap-1 px-2 py-2">
        {items.map((item) => (
          <WorkspaceRailItem
            key={item.href}
            href={item.href}
            label={item.label}
            icon={ICONS[item.key]}
            active={item.key === "read" ? isReadSectionActive(pathname) : isNavItemActive(pathname, item.href)}
          />
        ))}
        {hasReadItem && (
          <button
            type="button"
            className="rail-label app-control flex min-h-11 items-center self-end px-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            aria-expanded={readOpen}
            aria-controls={readSubnavId}
            onClick={() => setReadOpen((open) => !open)}
          >
            {readOpen ? "Hide Read section ▾" : "Show Read section ▸"}
          </button>
        )}
      </nav>
      {hasReadItem && readOpen && (
        <nav id={readSubnavId} aria-label="Read subnavigation" className="rail-label flex flex-col gap-0.5 overflow-y-auto px-4 pb-2">
          {READ_SUBNAV.map((sub) => (
            <Link
              key={sub.href}
              href={sub.href}
              data-sound="click"
              aria-current={isNavItemActive(pathname, sub.href) ? "page" : undefined}
              className={`app-control min-h-9 rounded px-2 py-1.5 text-sm ${
                isNavItemActive(pathname, sub.href) ? "font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              }`}
            >
              {sub.label}
            </Link>
          ))}
        </nav>
      )}
      <div className="flex-1" />
      <div className="flex flex-col gap-1 border-t border-[var(--color-border)] px-2 py-2">
        <UploadAction collapsed={collapsed} />
        <button
          type="button"
          className="rail-item-tooltip app-control app-icon-button hidden lg:inline-flex"
          data-tooltip={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          // D-a11y-s7-4: same real, reproduced SSR-vs-first-client-render
          // divergence as `<html>`/the outer rail `<div>`/`UploadAction` —
          // `collapsed` itself is intentionally SSR-`false`-then-corrected
          // from `localStorage`, so this button's label/tooltip/glyph text
          // legitimately differ on a session that already has a stored
          // `true` preference.
          suppressHydrationWarning
          onClick={toggleCollapsed}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>
      <LiveRegion message={announcement} />
    </div>
  );
}
