"use client";

import { useEffect } from "react";

/**
 * Tab-key focus-cycling within `containerRef`, while `active`. Factored out
 * of the two independent, near-identical implementations this codebase had
 * before Stage 1 (`AppShell.tsx`'s `MobileDrawer.keepFocusInDrawer` and
 * `CommandPalette.tsx`'s `trapFocus`) — see redesign-shell-spec.md §5.1/§5.2.
 * Existing dialogs are migrated onto this in a later stage; Stage 1 itself
 * only wires it into the new mobile Read-management sheet.
 *
 * Listens on `document` (not the container directly) so callers don't need
 * to thread an `onKeyDown` prop through JSX, but only acts when focus is
 * already inside `containerRef` — this lets multiple trap-capable surfaces
 * coexist in the tree without one's (inactive) trap ever intercepting a Tab
 * press meant for a different, currently-focused surface.
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const container = containerRef.current;
      if (!container || !container.contains(document.activeElement)) return;

      const focusable = [...container.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )].filter((element) => !element.hidden && element.getClientRects().length > 0);

      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, containerRef]);
}
