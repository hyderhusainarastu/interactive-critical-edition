"use client";

import { useCallback } from "react";

/**
 * The "focus the trigger back on close" pattern, factored out of the
 * duplicated `closeDrawer`/`closePreferences`/`closeRag`/`closeProfile`
 * bodies in the pre-Stage-1 `AppShell.tsx` (redesign-shell-spec.md §5.1/§5.2,
 * §5.3). Returns a function a caller invokes from its own close handler —
 * this hook does not itself decide *when* to close, only restores focus
 * once something else already has.
 *
 * Deliberately NOT invoked for an outside-pointerdown dismissal (see
 * `useOutsideMenuClose`'s own doc comment) — callers keep a separate
 * "close from outside" path that skips this restoration, matching the
 * existing, already-reasoned convention.
 */
export function useFocusRestoration<T extends HTMLElement>(triggerRef: React.RefObject<T | null>) {
  return useCallback(() => {
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, [triggerRef]);
}
