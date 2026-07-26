"use client";

import { useEffect, useRef } from "react";

/**
 * Closes an open menu/panel when a pointer press lands outside it, including
 * outside its own trigger button.
 *
 * Menu-dismissal design (live-issue fix, 2026-07-25 — see `useReopenGuard`'s
 * doc comment for the toggle-based approach this replaces on the three nav
 * menus): rather than guessing a timing window that hardware bounce can
 * still exceed, the trigger itself becomes open-only for pointer activation
 * (a pointer click while open does nothing — see the trigger `onClick`
 * handlers in `AppShell.tsx`/`RagChatPanel.tsx`), and THIS hook is what
 * actually closes the menu on a real dismissal gesture: a press anywhere
 * else on the page.
 *
 * Listens for `pointerdown`, not `click`, and in the CAPTURE phase:
 * - `pointerdown` fires before the trigger's own `click` handler runs, so a
 *   click on the trigger itself is caught here first — which is exactly why
 *   `containerRef` must wrap BOTH the trigger and the panel (every call site
 *   in this codebase already renders them as siblings inside one
 *   `position: relative` wrapper). Excluding the trigger is what makes a
 *   hardware-bounced SECOND pointerdown on the trigger harmless: it lands
 *   inside `containerRef`, so it is ignored here and falls through to the
 *   trigger's own open-only click handler, which (per that handler's own
 *   design) does nothing while already open. No mount-tick delay is needed:
 *   this hook only starts listening in a `useEffect` that runs after the
 *   opening click's full event sequence (pointerdown → pointerup → click →
 *   commit) has already completed, so the very gesture that opened the menu
 *   can never be seen by this listener at all.
 * - Capture phase means this runs before any other handler (e.g. a nested
 *   button's own `stopPropagation()` in the bubble phase) can shield a
 *   legitimate outside target from being observed here.
 *
 * Deliberately calls `onClose` directly with no focus management — unlike
 * this codebase's Escape/explicit-close convention (`requestAnimationFrame`
 * back to the trigger), an outside click should leave focus wherever the
 * user just interacted, matching standard menu UX. Callers pass a
 * focus-return-free close function for this reason (e.g. `closeProfile`'s
 * "from outside" sibling, not `closeProfile` itself).
 */
export function useOutsideMenuClose(
  open: boolean,
  onClose: () => void,
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      onCloseRef.current();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [open, containerRef]);
}
