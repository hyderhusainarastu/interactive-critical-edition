"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

function postUsageEvent(eventType: "session_start" | "page_view", path: string) {
  // Fire-and-forget: `keepalive` lets the browser finish the request even
  // if the user is already navigating away, and the `.catch` makes a
  // network failure invisible to the page — this beacon must never block or
  // break rendering (plan §H).
  void fetch("/api/usage-event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventType, path }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Workstream H (v.5) telemetry. Renders nothing — mounted once in
 * `(app)/layout.tsx`. `(app)/layout.tsx` is a Server Component that does
 * NOT re-render on client-side (soft) navigation between pages under it, so
 * a page-view count can't be derived from that layout rendering; this
 * client component's own `usePathname()` effect is what actually observes
 * each navigation.
 *
 * Two effects, deliberately separate: the first (empty dep array) fires
 * exactly once per full page load and records `session_start`; the second
 * (keyed on `pathname`) fires on that same initial mount AND on every
 * subsequent pathname change, recording `page_view` for each one —
 * matching the plan's "session_start on mount + page_view per pathname
 * change" exactly.
 */
export function TelemetryBeacon() {
  const pathname = usePathname();
  const sentSessionStart = useRef(false);

  useEffect(() => {
    if (sentSessionStart.current) return;
    sentSessionStart.current = true;
    postUsageEvent("session_start", pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, deliberately not re-run on pathname change
  }, []);

  useEffect(() => {
    postUsageEvent("page_view", pathname);
  }, [pathname]);

  return null;
}
