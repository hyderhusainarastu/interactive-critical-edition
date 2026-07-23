"use client";

import { useEffect, useRef, useState } from "react";
import { ReaderSidebarFrame } from "./ReaderSidebarFrame";
import type { OutlineItem } from "./EditionReader";

/**
 * Persistent left outline rail (D-23-51 — owner feedback: the outline
 * should be a left sidebar that stays visible while scrolling, not a
 * dropdown that requires scrolling back up). Items and their block ids come
 * from `computeOutline()` (`EditionReader.tsx`), the same computation the
 * reader itself uses for jump-to-block navigation, so the two can never
 * disagree about what the document's sections are.
 *
 * Current-section indication reuses the real, already-rendered heading
 * elements (`#block-<id>`, set by `EditionReader`) — cheap because it needs
 * no new data or server round trip, just reading positions of DOM nodes
 * that already exist. A direct `getBoundingClientRect()` check on scroll
 * (rAF-throttled), not an `IntersectionObserver` — tried that first, but a
 * large jump (a fast flick, Page Down, or `scrollIntoView` landing far from
 * the previous position) can carry a heading straight across the observed
 * band in one browser-internal step with no threshold-crossing event ever
 * firing, silently freezing the indicator. Measuring positions directly on
 * every scroll is correct regardless of jump size, and — for the handful of
 * headings a real document has — cheap enough to run on every frame.
 */
export function ReaderOutlineSidebar({
  items,
  onSelect,
  onClose,
}: {
  items: OutlineItem[];
  onSelect: (blockId: string) => void;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (items.length === 0) return;
    // Reader order === DOM order (`computeOutline` sorts by pageIndex then
    // blockOrder, the same order `EditionReader` renders blocks in), so the
    // last heading whose top has scrolled up to/past the activation line is
    // "the section you're reading now" — the standard scroll-spy heuristic.
    const entries = items
      .map((item) => ({ id: item.id, element: document.getElementById(`block-${item.id}`) }))
      .filter((entry): entry is { id: string; element: HTMLElement } => entry.element !== null);
    if (entries.length === 0) return;

    const ACTIVATION_LINE_PX = 130; // clears the sticky app header + reader toolbar
    let queued = false;
    function updateActive() {
      queued = false;
      let current = entries[0]!.id;
      for (const entry of entries) {
        if (entry.element.getBoundingClientRect().top <= ACTIVATION_LINE_PX) current = entry.id;
        else break;
      }
      setActiveId(current);
    }
    function onScroll() {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(updateActive);
    }

    // Scheduled via rAF, not called synchronously here — this codebase's own
    // lint rule (`react-hooks/set-state-in-effect`) disallows a bare
    // setState call in an effect body.
    const initialFrame = window.requestAnimationFrame(updateActive);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.cancelAnimationFrame(initialFrame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [items]);

  useEffect(() => {
    if (!activeId) return;
    navRef.current?.querySelector(`[data-outline-item="${activeId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  if (items.length === 0) return null;

  return (
    <ReaderSidebarFrame label="Document outline" widthClassName="w-56" onClose={onClose}>
      <nav ref={navRef} aria-label="Document outline" className="border-e border-[var(--color-border)] bg-[var(--color-surface)] py-2">
        <ul className="flex flex-col">
          {items.map((item) => {
            const active = item.id === activeId;
            return (
              <li key={item.id} data-outline-item={item.id}>
                <button
                  type="button"
                  aria-current={active ? "location" : undefined}
                  onClick={() => onSelect(item.id)}
                  className={`app-control block w-full min-h-11 py-1.5 pe-3 text-start text-xs leading-snug ${item.level === 2 ? "ps-6" : "ps-3 font-medium"}`}
                  style={{
                    borderInlineStart: `2px solid ${active ? "var(--color-accent-ink)" : "transparent"}`,
                    color: active ? "var(--color-text)" : "var(--color-text-muted)",
                    background: active ? "var(--color-background)" : "transparent",
                  }}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </ReaderSidebarFrame>
  );
}
