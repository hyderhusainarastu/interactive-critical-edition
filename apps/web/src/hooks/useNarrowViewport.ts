"use client";

import { useEffect, useState } from "react";

/** SSR-safe: `window` doesn't exist on the server, and the reader shell that
 * consumes this only ever renders its real content after a client-side data
 * fetch resolves (it shows "Loading…" until then), so there is no
 * server/client markup to keep in sync — this only has to be correct once
 * the browser is real. */
function matchesNarrow(breakpointPx: number): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(`(max-width: ${breakpointPx - 1}px)`).matches;
}

/**
 * True below the reader layout's own sticky-sidebar breakpoint (default
 * 1024px, Tailwind's `lg`). Used to switch the reader's outline/annotations/
 * notes rails between an inline `position: sticky` column (wide — Phase
 * 23.3/D-23-51) and the app's existing dialog/drawer pattern (narrow), so
 * 320–1440px all get a usable presentation instead of three columns
 * squeezed onto a phone screen.
 *
 * The lazy `useState` initializer reads the real viewport on the very first
 * client render (not just after an effect), so callers don't see a
 * momentarily-wrong layout before a `useEffect` catches up.
 */
export function useNarrowViewport(breakpointPx = 1024): boolean {
  const [narrow, setNarrow] = useState(() => matchesNarrow(breakpointPx));

  useEffect(() => {
    // The lazy `useState` initializer above already gives the correct value
    // for the very first render; this only needs to subscribe for later
    // changes (resize, orientation change), matching this codebase's own
    // "no synchronous setState in an effect body" rule
    // (`react-hooks/set-state-in-effect`).
    const query = window.matchMedia(`(max-width: ${breakpointPx - 1}px)`);
    const listener = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [breakpointPx]);

  return narrow;
}
