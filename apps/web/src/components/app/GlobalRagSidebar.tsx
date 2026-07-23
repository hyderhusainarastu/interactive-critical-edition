"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RagChatPanel } from "@/app/(app)/works/[workId]/reader/RagChatPanel";

const WIDTH_STORAGE_KEY = "palimnote:rag-sidebar-width";
const MIN_WIDTH = 320;
const MAX_WIDTH = 640;
const DEFAULT_WIDTH = 416; // 26rem, matching RagChatPanel's own default drawer width
const KEYBOARD_STEP = 24;

function readStoredWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(parsed) ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed)) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/**
 * Wraps the shared `RagChatPanel` (drawer presentation) with the plan
 * §22.6 "expandable resizable sidebar" affordance: a pointer- and
 * keyboard-operable separator at the sidebar's leading edge, following the
 * same value-bearing-separator pattern Writer's D-19-13 fix established
 * (pointer drag plus Arrow/Home/End keys), with the resulting width
 * persisted to `localStorage` — not `WorkspacePreferences`, since that
 * object is synced to the server and shared by every other page's layout
 * preferences; this is a presentation detail of one optional panel, not a
 * durable cross-device reading preference, so a local-only persistence
 * layer is the right amount of state for it.
 *
 * Only rendered above the `md` breakpoint — below it, `RagChatPanel`'s own
 * `max-md:` classes already turn the drawer into a full-width bottom sheet,
 * where a manual resize handle would have nothing meaningful to do.
 */
export function GlobalRagSidebar({
  id,
  contextWorkId,
  onClose,
}: {
  id?: string;
  contextWorkId: string | null;
  onClose: () => void;
}) {
  // Lazy initial state (not an effect + setState) so the stored width is
  // read exactly once, synchronously, before first paint — reading
  // `localStorage` directly in the initializer is safe here because this
  // component (like the rest of the reader/shell client tree) only ever
  // mounts in the browser.
  const [width, setWidth] = useState<number>(() => (typeof window === "undefined" ? DEFAULT_WIDTH : readStoredWidth()));
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const persistWidth = useCallback((next: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    setWidth(clamped);
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // Width simply won't survive a reload in this browser; the panel
      // still opens at the default width, which is a harmless degradation.
    }
  }, []);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      if (!dragRef.current) return;
      // The panel is pinned to the inline-end edge, so dragging toward the
      // start of the viewport (smaller clientX) should widen it.
      persistWidth(dragRef.current.startWidth + (dragRef.current.startX - event.clientX));
    }
    function onPointerUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [persistWidth]);

  function onHandleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowLeft") { event.preventDefault(); persistWidth(width + KEYBOARD_STEP); }
    else if (event.key === "ArrowRight") { event.preventDefault(); persistWidth(width - KEYBOARD_STEP); }
    else if (event.key === "Home") { event.preventDefault(); persistWidth(MIN_WIDTH); }
    else if (event.key === "End") { event.preventDefault(); persistWidth(MAX_WIDTH); }
  }

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Ask Library sidebar"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        className="fixed inset-y-0 z-40 hidden w-1.5 cursor-ew-resize touch-none md:block hover:bg-[color-mix(in_srgb,var(--color-accent-umber)_45%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--color-accent-umber)_45%,transparent)]"
        style={{ insetInlineEnd: width }}
        onKeyDown={onHandleKeyDown}
        onPointerDown={(event) => {
          dragRef.current = { startX: event.clientX, startWidth: width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
      />
      <RagChatPanel id={id} contextWorkId={contextWorkId} onClose={onClose} widthPx={width} dialogLabel="Ask Library — global sidebar" />
    </>
  );
}
