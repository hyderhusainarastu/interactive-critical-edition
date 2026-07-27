"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface ContextBarState {
  title: ReactNode | null;
  actions: ReactNode | null;
}

interface ContextBarContextValue extends ContextBarState {
  setContextBar: (patch: Partial<ContextBarState>) => void;
}

const DEFAULT_STATE: ContextBarState = { title: null, actions: null };

const ContextBarContext = createContext<ContextBarContextValue | null>(null);

/**
 * Route-aware content seam for `ContextBar` (redesign-shell-spec.md
 * §2.2/§3.3): lets a page register its own title/contextual actions without
 * `ContextBar` itself needing per-route knowledge. Stage 1 ships this
 * provider and `ContextBar`'s own fallback (the current nav section's
 * label) — no page populates it yet; Reader/Research/Writer wire in
 * starting their own stage (§8).
 */
export function ContextBarProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContextBarState>(DEFAULT_STATE);
  const setContextBar = (patch: Partial<ContextBarState>) => setState((current) => ({ ...current, ...patch }));
  const value = useMemo(() => ({ ...state, setContextBar }), [state]);
  return <ContextBarContext.Provider value={value}>{children}</ContextBarContext.Provider>;
}

function useContextBarContext(): ContextBarContextValue {
  const context = useContext(ContextBarContext);
  if (!context) throw new Error("useContextBar hooks must be used within ContextBarProvider");
  return context;
}

/** Read-only: what `ContextBar` itself renders. */
export function useContextBarState(): ContextBarState {
  const { title, actions } = useContextBarContext();
  return { title, actions };
}

/**
 * A page calls this to register its own context-bar title/actions for as
 * long as it stays mounted; unmounting (or navigating away) resets to the
 * default so a leftover title/actions never bleed into the next route. Not
 * called by any page in Stage 1 — the seam exists so a later stage doesn't
 * need to restructure `ContextBar` to add it.
 */
export function useRegisterContextBar(state: Partial<ContextBarState>) {
  const { setContextBar } = useContextBarContext();
  useEffect(() => {
    setContextBar(state);
    return () => setContextBar(DEFAULT_STATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.title, state.actions]);
}
