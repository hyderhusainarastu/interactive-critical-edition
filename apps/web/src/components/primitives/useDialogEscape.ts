"use client";

import { useEffect } from "react";

/**
 * Pure predicate for whether a given keydown should close a dialog: only
 * `Escape`, and only while the surface is actually `active` — unit-tested
 * directly in `useDialogEscape.test.ts` (no DOM needed, see that file's own
 * comment on why `apps/web` tests these as plain functions).
 */
export function shouldHandleEscape(key: string, active: boolean): boolean {
  return active && key === "Escape";
}

/**
 * Escape-closes-and-doesn't-bubble, factored out of the ad hoc `onKeyDown`
 * each existing dialog/popover hand-rolls today (e.g. `PreferencesMenu`'s
 * inline handler) — see redesign-shell-spec.md §5.1/§5.2. Only listens while
 * `active`, so an unmounted/closed surface never intercepts Escape meant for
 * whatever else is open.
 */
export function useDialogEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;

    function onKeyDown(event: KeyboardEvent) {
      if (!shouldHandleEscape(event.key, active)) return;
      event.stopPropagation();
      onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onClose]);
}
