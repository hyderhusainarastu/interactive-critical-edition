"use client";

import { useCallback, useRef } from "react";

/** Default guard window, in ms. Chosen well above the ~74–100ms gap observed
 * between the two synthetic events a single physical click/tap can produce
 * on affected hardware (mouse switch-bounce, some macOS trackpad double-fire
 * cases), and well below the gap between two genuinely separate presses —
 * including two deliberate keyboard (Enter/Space) activations, which are
 * never this close together in practice. */
const DEFAULT_GUARD_MS = 250;

/**
 * Guards a toggle-style trigger (`isOpen ? close() : open()`) against a
 * single physical click/keypress that fires as two synthetic events a few
 * tens of milliseconds apart. Without this, the second event reads the
 * just-set "open" state and immediately closes the panel again — see the
 * incident this hook fixes: `AppShell.tsx`'s profile/preferences menus and
 * `RagChatPanel.tsx`'s conversation-history menu all opened and then
 * instantly closed on affected hardware, with no outside-click handler or
 * remount involved (verified by live event-timeline capture).
 *
 * Usage: call `markOpened()` at the same moment the panel's own open state
 * is set to true; before running whatever would close the panel, call
 * `shouldIgnoreClose()` and bail out (leaving the panel open) if it returns
 * true.
 *
 *   onClick={() => {
 *     if (open) {
 *       if (guard.shouldIgnoreClose()) return;
 *       close();
 *     } else {
 *       setOpen(true);
 *       guard.markOpened();
 *     }
 *   }}
 *
 * Deliberately one-directional: this only suppresses a close that lands
 * suspiciously soon after an open. Closing via Escape, an explicit close
 * button, or an outside click is untouched — those call the close function
 * directly, never through this guard, so they remain instant exactly as
 * before.
 */
export function useReopenGuard(delayMs: number = DEFAULT_GUARD_MS) {
  const openedAtRef = useRef<number | null>(null);

  const markOpened = useCallback(() => {
    openedAtRef.current = Date.now();
  }, []);

  const shouldIgnoreClose = useCallback(() => {
    const openedAt = openedAtRef.current;
    return openedAt !== null && Date.now() - openedAt < delayMs;
  }, [delayMs]);

  return { markOpened, shouldIgnoreClose };
}
