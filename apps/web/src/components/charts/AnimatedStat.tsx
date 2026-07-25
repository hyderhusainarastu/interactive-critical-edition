"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

// `useLayoutEffect` warns when it runs during SSR ("does nothing on the
// server"); this repo's other client components avoid a matching warning
// the standard way — swap in `useEffect` server-side, since the effect
// itself only ever touches `window`/`document`, both already guarded.
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * A fixed set of presets, not an arbitrary `(value: number) => string`
 * function — `AnimatedStat` is a Client Component, and a Server Component
 * caller (e.g. `/admin-dash`'s overview page) cannot pass a function prop
 * across that boundary at all ("Functions cannot be passed directly to
 * Client Components" — this is exactly the bug this preset shape avoids).
 * Add a new preset here rather than reaching for a function prop.
 */
export type AnimatedStatFormat = "integer" | "usd" | "bytes";

const FORMATTERS: Record<AnimatedStatFormat, (value: number) => string> = {
  integer: (n) => `${Math.round(n)}`,
  usd: (n) => `$${n.toFixed(2)}`,
  bytes: (n) => {
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
    if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${Math.round(n)} B`;
  },
};

export interface AnimatedStatProps {
  value: number;
  label?: string;
  format?: AnimatedStatFormat;
  durationMs?: number;
  className?: string;
}

function prefersReducedMotionNow(): boolean {
  if (typeof window === "undefined") return true;
  return (
    document.documentElement.dataset.motion === "reduced"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A count-up number, respecting BOTH the OS `prefers-reduced-motion`
 * setting and the in-app motion toggle (same combined check as
 * `apps/web/src/app/(app)/works/[workId]/reader/readerMotion.ts`'s
 * `readerScrollBehavior`) — this one has to run in JS, unlike the CSS-only
 * chart draw-in animations elsewhere in this folder, because a changing
 * NUMBER needs a value driver, not just a visual transition. `tabular-nums`
 * keeps digit width constant while counting so surrounding layout never
 * jitters mid-animation.
 */
export function AnimatedStat({
  value,
  label,
  format = "integer",
  durationMs = 900,
  className,
}: AnimatedStatProps) {
  const formatValue = FORMATTERS[format];
  // Server render and the client's initial render both show the FINAL
  // value — matching output avoids a hydration mismatch. The count-up
  // itself starts from `useIsomorphicLayoutEffect`, which (on the client)
  // fires before the browser paints, so resetting to 0 there is never
  // visible as a flash of the final value first.
  const [display, setDisplay] = useState(value);
  const frameRef = useRef<number | null>(null);
  const previousValueRef = useRef(value);

  useIsomorphicLayoutEffect(() => {
    if (prefersReducedMotionNow()) {
      setDisplay(value);
      previousValueRef.current = value;
      return;
    }
    // First mount: previousValueRef still equals the initial value, so
    // count up from 0. A later prop change: count up (or down) from
    // whatever the previous value was, not from 0 again.
    const from = previousValueRef.current === value ? 0 : previousValueRef.current;
    previousValueRef.current = value;
    const start = performance.now();
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setDisplay(from + (value - from) * eased);
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    }
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, durationMs]);

  return (
    <span
      className={`tabular-nums ${className ?? ""}`}
      aria-label={label ? `${label}: ${formatValue(value)}` : undefined}
    >
      {formatValue(display)}
    </span>
  );
}
