"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Wraps routed page CONTENT in a subtle cross-fade on navigation. Deliberately
 * scoped by callers to wrap only the content area, never persistent chrome
 * (see `AppShell.tsx`'s single usage around `<main>`) — see that file's own
 * comment for why: wrapping the whole app shell in this `AnimatePresence`
 * caused a real production bug (menus opening and instantly closing).
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const systemReduced = useReducedMotion();
  const [preferenceReduced, setPreferenceReduced] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setPreferenceReduced(root.dataset.motion === "reduced");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
    return () => observer.disconnect();
  }, []);
  const reduced = systemReduced || preferenceReduced;
  return <AnimatePresence mode="wait" initial={false}><motion.div className="flex min-h-full min-w-0 flex-1 flex-col" key={pathname} initial={reduced ? false : { opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -3 }} transition={{ duration: reduced ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}>{children}</motion.div></AnimatePresence>;
}
