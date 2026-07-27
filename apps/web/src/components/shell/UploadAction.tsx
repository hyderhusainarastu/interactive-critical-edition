"use client";

import Link from "next/link";

/**
 * The persistent, prominently-styled global Upload action (redesign-shell-
 * spec.md §3.6, charter §6: "Put Upload in a persistent, clearly labeled
 * action" — not a fifth workspace, not styled like an ordinary nav row).
 * Rendered by `WorkspaceRail` (desktop/tablet, under the primary items) and
 * by `ContextBar` (mobile, since the bottom nav's four slots are reserved
 * for Home/Read/Research/Write).
 *
 * Uses the same audited `--color-rail-active-bg`/`--color-rail-active-fg`
 * pair the active-rail-item state uses (redesign-shell-spec.md §1.3 — passes
 * AA in both themes at 11.66:1 light / 5.27:1 dark), rather than
 * `--color-accent-ink` + a fixed white foreground, which fails in dark theme
 * (accent-ink is near-white there).
 */
export function UploadAction({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/upload"
      data-sound="click"
      data-tooltip={collapsed ? "Upload" : undefined}
      aria-label={collapsed ? "Upload" : undefined}
      className={`rail-item-tooltip app-control flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--color-rail-active-bg)] px-3 py-2 text-sm font-medium text-[var(--color-rail-active-fg)] hover:opacity-90 ${
        collapsed ? "w-11" : ""
      }`}
    >
      <span aria-hidden="true">⭱</span>
      {!collapsed && <span className="rail-label">Upload</span>}
    </Link>
  );
}
