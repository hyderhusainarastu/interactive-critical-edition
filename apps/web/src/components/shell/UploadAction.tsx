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
 *
 * D-a11y-s7-4 (React hydration error #418): `collapsed` comes from
 * `WorkspaceRail`'s own SSR-`false`-then-corrected-from-`localStorage`
 * state, so this component's own rendered `data-tooltip`/`aria-label`/
 * `className` legitimately (and intentionally, for the same FOUC-avoidance
 * reason as `PreferenceBootstrap`'s `<html>` script) differ between the
 * server's render and this session's first client render whenever a
 * stored `collapsed=true` preference already exists — a real, reproduced
 * mismatch (`hydration-smoke.spec.ts`), fixed the same way as `<html>`'s:
 * `suppressHydrationWarning` on this exact node. The `<span>` label,
 * unlike those attributes, used to be CONDITIONALLY OMITTED from the tree
 * entirely when collapsed — a structural mismatch `suppressHydrationWarning`
 * cannot cover (it only suppresses a mismatch in this node's OWN
 * attributes/text, never a child being present-or-absent). Fixed by always
 * rendering it and letting the existing `.workspace-rail[data-collapsed="true"]
 * .rail-label { display: none }` CSS rule hide it when collapsed — the
 * exact same pattern `WorkspaceRailItem`'s own label span already uses.
 */
export function UploadAction({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link
      href="/upload"
      data-sound="click"
      data-tooltip={collapsed ? "Upload" : undefined}
      aria-label={collapsed ? "Upload" : undefined}
      suppressHydrationWarning
      className={`rail-item-tooltip app-control flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--color-rail-active-bg)] px-3 py-2 text-sm font-medium text-[var(--color-rail-active-fg)] hover:opacity-90 ${
        collapsed ? "w-11" : ""
      }`}
    >
      <span aria-hidden="true">⭱</span>
      <span className="rail-label">Upload</span>
    </Link>
  );
}
