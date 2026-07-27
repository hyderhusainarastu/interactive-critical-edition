"use client";

import { useEffect } from "react";

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
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onClose]);
}
