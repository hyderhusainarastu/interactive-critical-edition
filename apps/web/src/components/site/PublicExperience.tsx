"use client";

import { useEffect } from "react";
import Lenis from "lenis";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Progressive enhancement for the public surface. Content is fully rendered
 * without JavaScript; this layer only adds scroll choreography and pointer
 * depth when both the operating system and Palimnote preferences allow it.
 */
export function PublicExperience() {
  useEffect(() => {
    const root = document.documentElement;
    const motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    let lenis: Lenis | undefined;
    let frame = 0;
    let observer: IntersectionObserver | undefined;

    const progress = document.querySelector<HTMLElement>("[data-scroll-progress]");
    const revealTargets = Array.from(
      document.querySelectorAll<HTMLElement>(".pal-site main section, .pal-site .policy-copy section"),
    );
    revealTargets.forEach((target, index) => {
      target.classList.add("pal-reveal");
      target.style.setProperty("--reveal-index", String(index));
    });

    const setVisible = () => {
      observer?.disconnect();
      if (motionQuery.matches || root.dataset.motion === "reduced") {
        revealTargets.forEach((target) => target.classList.add("is-visible"));
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            observer?.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -9% 0px", threshold: 0.08 },
      );
      revealTargets.forEach((target) => observer?.observe(target));
    };

    const updateScrollEffects = () => {
      frame = 0;
      const scrollTop = window.scrollY;
      const scrollRange = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      progress?.style.setProperty("--scroll-progress", String(Math.min(1, scrollTop / scrollRange)));
      if (motionQuery.matches || root.dataset.motion === "reduced") return;
      document.querySelectorAll<HTMLElement>("[data-parallax-depth]").forEach((element) => {
        const depth = Number(element.dataset.parallaxDepth ?? 0);
        element.style.setProperty("--parallax-y", `${scrollTop * depth * -0.055}px`);
      });
    };

    const requestScrollEffects = () => {
      if (!frame) frame = window.requestAnimationFrame(updateScrollEffects);
    };

    const destroyLenis = () => {
      lenis?.destroy();
      lenis = undefined;
    };

    const syncMotion = () => {
      destroyLenis();
      setVisible();
      if (!motionQuery.matches && root.dataset.motion !== "reduced") {
        lenis = new Lenis({
          autoRaf: true,
          anchors: true,
          duration: 1.05,
          smoothWheel: true,
          syncTouch: false,
        });
      }
      requestScrollEffects();
    };

    const preferenceObserver = new MutationObserver(syncMotion);
    preferenceObserver.observe(root, { attributes: true, attributeFilter: ["data-motion"] });
    motionQuery.addEventListener("change", syncMotion);
    window.addEventListener("scroll", requestScrollEffects, { passive: true });

    const magneticControls = Array.from(document.querySelectorAll<HTMLElement>("[data-magnetic]"));
    const resetMagnet = (element: HTMLElement) => {
      element.style.removeProperty("--magnetic-x");
      element.style.removeProperty("--magnetic-y");
    };
    const magnetHandlers = magneticControls.map((element) => {
      const move = (event: PointerEvent) => {
        if (motionQuery.matches || root.dataset.motion === "reduced" || event.pointerType === "touch") return;
        const rect = element.getBoundingClientRect();
        element.style.setProperty("--magnetic-x", `${(event.clientX - rect.left - rect.width / 2) * 0.16}px`);
        element.style.setProperty("--magnetic-y", `${(event.clientY - rect.top - rect.height / 2) * 0.18}px`);
      };
      const leave = () => resetMagnet(element);
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerleave", leave);
      return { element, move, leave };
    });

    syncMotion();
    updateScrollEffects();

    return () => {
      destroyLenis();
      observer?.disconnect();
      preferenceObserver.disconnect();
      motionQuery.removeEventListener("change", syncMotion);
      window.removeEventListener("scroll", requestScrollEffects);
      magneticControls.forEach(resetMagnet);
      magnetHandlers.forEach(({ element, move, leave }) => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerleave", leave);
      });
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <div className="public-scroll-progress" data-scroll-progress aria-hidden="true" />;
}
