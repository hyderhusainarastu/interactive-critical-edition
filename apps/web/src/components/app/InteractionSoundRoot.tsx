"use client";

import { useEffect } from "react";
import { playSound } from "@/lib/sound";
import { DEFAULT_WORKSPACE_PREFERENCES, normalizeWorkspacePreferences, WORKSPACE_PREFERENCES_STORAGE_KEY } from "@/lib/workspacePreferences";

/** One capture listener prevents individual controls from accidentally layering sounds. */
export function InteractionSoundRoot({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("button:not([data-sound='off']), [role='button']:not([data-sound='off']), a[data-sound], a.nav") : null;
      if (!target || target.hasAttribute("disabled") || event.defaultPrevented) return;
      let enabled = true;
      try {
        const raw = localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY);
        enabled = normalizeWorkspacePreferences(raw ? JSON.parse(raw) : DEFAULT_WORKSPACE_PREFERENCES).soundEnabled;
      } catch { /* Use the accessibility-friendly default. */ }
      playSound(target.dataset.sound === "send" ? "send" : "click", enabled);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return <>{children}</>;
}
