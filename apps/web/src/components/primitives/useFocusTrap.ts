"use client";

import { useEffect } from "react";

/**
 * Pure decision for what a Tab/Shift+Tab press should do inside a focus
 * trap, given only the shape of the situation (how many focusable elements
 * exist, where the currently-focused one sits among them, and which
 * direction the user is tabbing) — no DOM, no React, unit-tested directly
 * in `useFocusTrap.test.ts` since `apps/web` has no DOM-testing runner
 * wired (see that file's own comment). `useFocusTrap` itself is the only
 * caller; kept exported so the test can import it without reaching into a
 * private closure.
 *
 * `activeIndex` is `-1` when focus is currently outside the tracked
 * focusable list (e.g. on the container itself) — treated the same as "not
 * at an edge," i.e. let the browser's default Tab behavior run.
 */
export function resolveFocusTrapAction(
  focusableCount: number,
  activeIndex: number,
  shiftKey: boolean,
): "focus-container" | "wrap-to-last" | "wrap-to-first" | "allow-default" {
  if (focusableCount === 0) return "focus-container";
  if (shiftKey && activeIndex === 0) return "wrap-to-last";
  if (!shiftKey && activeIndex === focusableCount - 1) return "wrap-to-first";
  return "allow-default";
}

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

      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const action = resolveFocusTrapAction(focusable.length, activeIndex, event.shiftKey);

      if (action === "focus-container") {
        event.preventDefault();
        container.focus();
      } else if (action === "wrap-to-last") {
        event.preventDefault();
        focusable.at(-1)!.focus();
      } else if (action === "wrap-to-first") {
        event.preventDefault();
        focusable[0].focus();
      }
      // "allow-default": let the browser move focus normally — every
      // focusable element in this trap lives inside `container`, so a plain
      // Tab already stays inside it without any intervention.
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, containerRef]);
}
