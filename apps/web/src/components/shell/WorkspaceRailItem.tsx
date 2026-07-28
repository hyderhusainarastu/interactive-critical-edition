"use client";

import Link from "next/link";

/**
 * One rail entry (redesign-shell-spec.md §2.2/§3.9): a real `<Link>` with a
 * visible sentence-case label when the rail is expanded, and an
 * `aria-label` plus the existing CSS-only tooltip convention
 * (`.rail-item-tooltip`, mirroring `.app-icon-button`'s own `data-tooltip`
 * pattern) when collapsed. Deliberately `text-sm` (14px), sentence case, no
 * `uppercase` — corrects the pre-Stage-1 `NavLink`'s `text-[11px] uppercase`
 * defect (§1.5).
 */
export function WorkspaceRailItem({
  href,
  label,
  icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href}
      data-sound="click"
      aria-current={active ? "page" : undefined}
      // `data-tooltip` (below) is a CSS-only `content: attr(...)` visual
      // tooltip, not something assistive tech reliably exposes — collapsing
      // the rail also `display:none`s the visible `.rail-label` span below
      // via `globals.css`, so without this the link was left with NO
      // accessible name at all once collapsed (real axe "link-name"
      // violation found running this suite against a fresh session's
      // first-ever visit to an immersive route, which auto-collapses the
      // rail — see `WorkspaceRail.tsx`'s own auto-collapse effect). This
      // component's own doc comment already promised an `aria-label` here;
      // it was simply never added.
      aria-label={collapsed ? label : undefined}
      data-tooltip={collapsed ? label : undefined}
      className={`rail-item-tooltip app-control flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm ${
        active
          ? "bg-[var(--color-rail-active-bg)] font-medium text-[var(--color-rail-active-fg)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
      }`}
    >
      <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center text-base leading-none">
        {icon}
      </span>
      <span className="rail-label truncate">{label}</span>
    </Link>
  );
}
