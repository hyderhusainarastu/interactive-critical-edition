"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

interface SecondaryPanelContextValue {
  openId: string | null;
  open: (id: string) => void;
  close: (id: string) => void;
}

const SecondaryPanelContext = createContext<SecondaryPanelContextValue | null>(null);

/**
 * One-at-a-time singleton for shell-level secondary drawers/sheets/menus
 * (redesign-shell-spec.md §3.4/§5.2): opening one closes whatever else was
 * open — never stacked, never simultaneous. Stage 1 applies this uniformly
 * (desktop and mobile) to the shell's own preferences/account/Ask-Library
 * triggers plus the new mobile Read-management sheet, which is a strict
 * superset of the charter's literal "never show more than one secondary
 * drawer or bottom sheet on mobile" requirement (§6) rather than a narrower
 * mobile-only reading of it — simpler to reason about correctly, and it
 * cannot reintroduce the exact bug the charter is guarding against on any
 * viewport. The Reader's own contextual Ask Library toggle (a page-internal
 * affordance, Stage 4 scope per spec §8) is not part of this singleton.
 *
 * `id` identifies which panel a given call site owns (e.g. "preferences",
 * "profile", "rag", "read-management"); every consumer of this same context
 * instance shares one `openId`, so calling `open("profile")` while
 * `"preferences"` is open closes preferences automatically.
 */
export function SecondaryPanelProvider({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = useCallback((id: string) => setOpenId(id), []);
  const close = useCallback((id: string) => setOpenId((current) => (current === id ? null : current)), []);
  const value = useMemo(() => ({ openId, open, close }), [openId, open, close]);
  return <SecondaryPanelContext.Provider value={value}>{children}</SecondaryPanelContext.Provider>;
}

export function useSecondaryPanel(id: string) {
  const context = useContext(SecondaryPanelContext);
  if (!context) throw new Error("useSecondaryPanel must be used within SecondaryPanelProvider");
  const { openId, open, close } = context;
  return {
    isOpen: openId === id,
    open: () => open(id),
    close: () => close(id),
  };
}
