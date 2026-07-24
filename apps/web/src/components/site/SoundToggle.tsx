"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_WORKSPACE_PREFERENCES, normalizeWorkspacePreferences, WORKSPACE_PREFERENCES_STORAGE_KEY } from "@/lib/workspacePreferences";
import { playSound } from "@/lib/sound";

const SOUND_CHANGE_EVENT = "palimnote:sound-change";

function getEnabled() {
  try {
    const raw = localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY);
    return normalizeWorkspacePreferences(raw ? JSON.parse(raw) : DEFAULT_WORKSPACE_PREFERENCES).soundEnabled;
  } catch { return true; }
}

export function SoundToggle({ enabled, onChange, className = "app-control app-icon-button" }: { enabled?: boolean; onChange?: (enabled: boolean) => void; className?: string }) {
  const localEnabled = useSyncExternalStore(
    (notify) => { window.addEventListener(SOUND_CHANGE_EVENT, notify); return () => window.removeEventListener(SOUND_CHANGE_EVENT, notify); },
    getEnabled,
    () => true,
  );
  const active = enabled ?? localEnabled;
  function toggle() {
    const next = !active;
    playSound("toggle", next, { force: true });
    if (onChange) onChange(next);
    else {
      try {
        const raw = localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY);
        const current = normalizeWorkspacePreferences(raw ? JSON.parse(raw) : DEFAULT_WORKSPACE_PREFERENCES);
        localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify({ ...current, soundEnabled: next }));
        window.dispatchEvent(new CustomEvent("palimnote:workspace-preferences-change", { detail: { soundEnabled: next } }));
      } catch { /* The page-level setting is best effort. */ }
      window.dispatchEvent(new Event(SOUND_CHANGE_EVENT));
    }
  }
  return <button type="button" className={`${className} sound-toggle ${active ? "sound-toggle-on" : "sound-toggle-off"}`} data-sound="off" aria-label={active ? "Mute interface sounds" : "Enable interface sounds"} aria-pressed={active} onClick={toggle}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" focusable="false"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" /><path className="sound-wave" d="M16 9.5c1.3 1.3 1.3 3.7 0 5M18.7 6.8c2.8 2.8 2.8 7.6 0 10.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><path className="sound-slash" d="m4 4 16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
  </button>;
}
