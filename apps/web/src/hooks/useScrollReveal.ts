"use client";

import { useEffect, useRef } from "react";

/**
 * Small shared progressive-enhancement seam for workspace surfaces. Content is
 * fully visible without JavaScript and with reduced motion; otherwise it gets
 * one restrained entrance when it reaches the viewport rather than a repeated
 * decorative animation.
 */
export function useScrollReveal<T extends HTMLElement>(index = 0) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.setProperty("--reveal-index", String(index));
    if (document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    element.dataset.revealReady = "true";
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      element.dataset.revealed = "true";
      observer.disconnect();
    }, { threshold: 0.12 });
    observer.observe(element);
    return () => observer.disconnect();
  }, [index]);

  return ref;
}
