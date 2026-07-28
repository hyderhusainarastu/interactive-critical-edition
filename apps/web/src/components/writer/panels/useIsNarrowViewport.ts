"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const QUERY = "(max-width: 1023.98px)";

// `useLayoutEffect` warns when it runs during SSR ("does nothing on the
// server") — same isomorphic swap `AnimatedStat.tsx` already uses, since this
// hook's own effect only ever touches `window`, which is already guarded by
// the lazy `useState` initializer below.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Stage 6 layout spec §2.2/§2.1: narrow (<1024px, matching the `lg:`
 * breakpoint already used throughout `WriterEditor.tsx` and the Stage 1
 * shell rail) drives the Sources/Evidence and Citations/History panels into
 * a single-open bottom sheet instead of two always-inline `<aside>`s.
 *
 * SSR/first-paint default is `false` (wide) — the server has no viewport to
 * guess wrong, so this can never cause a hydration mismatch — matching
 * today's shipped markup (both panels open, inline) until the client
 * corrects itself via `matchMedia` in a layout effect, which (unlike a
 * plain effect) runs before the browser paints the frame it's responsible
 * for, so a genuinely narrow device never flashes the wide layout first.
 * Same lazy-correct-after-mount technique `WorkspaceRail.tsx` already uses
 * for its own localStorage-backed collapse state (redesign-shell-spec.md
 * §2.5).
 */
export function useIsNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(false);

  useIsomorphicLayoutEffect(() => {
    const mediaQueryList = window.matchMedia(QUERY);
    setIsNarrow(mediaQueryList.matches);
    const onChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    mediaQueryList.addEventListener("change", onChange);
    return () => mediaQueryList.removeEventListener("change", onChange);
  }, []);

  return isNarrow;
}
