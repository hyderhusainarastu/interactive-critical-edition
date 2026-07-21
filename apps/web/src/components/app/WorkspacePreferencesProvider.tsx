"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeWorkspacePreferences,
  WORKSPACE_PREFERENCES_STORAGE_KEY,
  type WorkspacePreferences,
} from "@/lib/workspacePreferences";
import { useToast } from "./ToastProvider";

interface PreferencesContextValue {
  preferences: WorkspacePreferences;
  updatePreferences: (patch: Partial<WorkspacePreferences>) => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function readLocalPreferences(): WorkspacePreferences | null {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_PREFERENCES_STORAGE_KEY);
    return raw ? normalizeWorkspacePreferences(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function applyPreferences(preferences: WorkspacePreferences) {
  const root = document.documentElement;
  const resolvedTheme = preferences.theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preferences.theme;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preferences.theme;
  root.dataset.fontSize = preferences.fontSize;
  root.dataset.readingWidth = preferences.readingWidth;
  root.dataset.focusMode = String(preferences.focusMode);
  root.dataset.scriptDisplay = preferences.scriptDisplay;
}

export function WorkspacePreferencesProvider({
  initialPreferences,
  children,
}: {
  initialPreferences: WorkspacePreferences;
  children: React.ReactNode;
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const preferencesRef = useRef(preferences);
  const { toast } = useToast();

  useEffect(() => {
    const local = readLocalPreferences();
    const active = local ?? initialPreferences;
    // The layout script has already applied the local version before hydration.
    // This effect keeps the React state and server-provided fallback in sync.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferences(active);
    applyPreferences(active);
    try {
      window.localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(active));
    } catch {
      // A blocked local store should never prevent the authenticated DB save.
    }

  // Runs exactly once: the pre-hydration script has already painted this
  // preference, and this only reconciles React state with its local copy.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    preferencesRef.current = preferences;
    applyPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (preferencesRef.current.theme === "system") applyPreferences(preferencesRef.current);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const updatePreferences = useCallback((patch: Partial<WorkspacePreferences>) => {
    setPreferences((current) => {
      const next = normalizeWorkspacePreferences({ ...current, ...patch });
      applyPreferences(next);
      try {
        window.localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Still save to the server for devices with browser storage disabled.
      }
      void fetch("/api/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).then(async (response) => {
        if (!response.ok) throw new Error();
        const body = await response.json();
        const saved = normalizeWorkspacePreferences(body.preferences);
        window.localStorage.setItem(WORKSPACE_PREFERENCES_STORAGE_KEY, JSON.stringify(saved));
      }).catch(() => toast("Your preference could not be saved. It will remain active in this browser.", "error"));
      return next;
    });
  }, [toast]);

  const value = useMemo(() => ({ preferences, updatePreferences }), [preferences, updatePreferences]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function useWorkspacePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error("useWorkspacePreferences must be used within WorkspacePreferencesProvider");
  return context;
}
