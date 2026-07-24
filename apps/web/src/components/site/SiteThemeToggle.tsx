"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_WORKSPACE_PREFERENCES,
  WORKSPACE_PREFERENCES_STORAGE_KEY,
  normalizeWorkspacePreferences,
} from "@/lib/workspacePreferences";

/**
 * Light/dark toggle for the public pages.
 *
 * Deliberately NOT a second theme mechanism. The app already persists a
 * `theme` preference under `palimnote.workspace-preferences`, and
 * `PreferenceBootstrap` (root layout `<head>`) resolves it to
 * `data-theme` on <html> before hydration on *every* page, landing page
 * included — the landing page simply never styled itself against it
 * until now. This component reads and writes that same key, so a choice
 * made here carries into the signed-in workspace and vice versa, and the
 * bootstrap script keeps preventing a flash of the wrong theme.
 *
 * The stored preference has three values (`system` | `light` | `dark`);
 * this control is a two-state toggle over the *resolved* theme, which is
 * what a visitor on a marketing page expects. Choosing either side pins
 * that value — `system` remains the default until they do.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the source
 * of truth is `document.documentElement.dataset.theme`, an external store
 * written by a pre-hydration script. `getServerSnapshot` returns `false`
 * so the server render and the hydration render agree (no mismatch, no
 * `suppressHydrationWarning`), and React reads the real value straight
 * after — without a synchronous `setState` inside an effect, which the
 * repo's `react-hooks/set-state-in-effect` rule correctly rejects.
 */

const THEME_CHANGE_EVENT = "palimnote:site-theme-change";

function subscribe(onStoreChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
}

function getSnapshot() {
  return document.documentElement.dataset.theme === "dark";
}

function getServerSnapshot() {
  return false;
}

export function SiteThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next = isDark ? "light" : "dark";
    const root = document.documentElement;
    root.dataset.theme = next;
    root.dataset.themePreference = next;

    try {
      const raw = window.localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY);
      const current = normalizeWorkspacePreferences(raw ? JSON.parse(raw) : DEFAULT_WORKSPACE_PREFERENCES);
      window.localStorage.setItem(
        WORKSPACE_PREFERENCES_STORAGE_KEY,
        JSON.stringify({ ...current, theme: next }),
      );
    } catch {
      // A blocked or full localStorage must not break the toggle — the
      // theme still applies for this page view, it just won't persist.
    }

    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
      <b>{isDark ? "Light" : "Dark"}</b>
    </button>
  );
}
