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
 *
 * `aria-label` is set unconditionally (not only while `collapsed`), matching
 * every existing `.app-icon-button`/`data-tooltip` pairing in this codebase
 * (`ContextBar.tsx`'s "Knowledge Map"/"Workspace preferences"/etc. icon
 * buttons all carry a real `aria-label` regardless of tooltip visibility).
 * Without it, the collapsed rail's `.rail-label` span is `display: none`
 * (`globals.css`'s `.workspace-rail[data-collapsed="true"] .rail-label`
 * rule) and the icon glyph is `aria-hidden`, so the link had NO accessible
 * name at all in that state — a real WCAG 2A 4.1.2 `link-name` failure
 * (found by the a11y proxy pass axe-scanning every collapsed-rail route:
 * Reader, Research, Knowledge Map, Writer).
 *
 * `data-tooltip` is ALSO unconditional now (D-a11y-s7-4, React hydration
 * error #418): it used to be `collapsed ? label : undefined`, but
 * `WorkspaceRail`'s own `collapsed` state is intentionally
 * SSR-`false`-then-corrected-from-`localStorage` on the client (its own
 * doc comment) — whenever a session already has a stored `true`
 * preference, this `<Link>`'s very first client render legitimately
 * disagreed with the server's `collapsed=false`-shaped render on this
 * exact attribute, a real, reproduced hydration mismatch (`hydration-
 * smoke.spec.ts`). Making the value unconditional removes the divergence
 * at its source instead of layering a `suppressHydrationWarning` over a
 * value that's still genuinely different between renders. The only visual
 * effect is that hovering an EXPANDED rail item now also shows a (harmless,
 * redundant with the already-visible label) tooltip — the CSS tooltip
 * itself only ever renders on `:hover`/`:focus-visible` either way.
 */
export function WorkspaceRailItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      data-sound="click"
      aria-current={active ? "page" : undefined}
      aria-label={label}
      data-tooltip={label}
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
