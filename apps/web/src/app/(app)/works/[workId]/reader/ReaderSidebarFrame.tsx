"use client";

import { useEffect, useRef } from "react";
import { useNarrowViewport } from "@/hooks/useNarrowViewport";

/**
 * Shared positioning shell for the reader's rails (outline on the left;
 * annotations/notes on the right) — D-23-51, owner feedback that the
 * outline and apparatus panels required scrolling back to the top to reach.
 *
 * Wide viewports (>=1024px): an inline `position: sticky` column, bounded to
 * the viewport height minus the app header, with its own internal scroll —
 * the panel and its add-note/add-annotation affordances stay reachable at
 * any scroll depth without covering the reading column.
 *
 * Narrow viewports: the same content becomes a bottom-sheet dialog, matching
 * this codebase's established drawer/dialog standard (`RagChatPanel`,
 * `FootnoteModal`, `AppShell`'s `MobileDrawer`/`PreferencesMenu` —
 * D-19-18/19/20): labelled `role="dialog"`, initial focus on its own close
 * control, and Escape closing it. Deliberately matches `RagChatPanel`'s
 * precedent of *not* adding a full Tab focus-trap loop — that component is
 * this exact codebase's own convention for "the reader's contextual side
 * panel," cited directly in this task's own instructions.
 *
 * Callers keep owning their own landmark (`<aside aria-label>`) and content;
 * this component only ever supplies the outer positioning/dialog shell, so
 * nothing here touches the text-block DOM the highlight/annotation
 * quote-fingerprint anchoring (`highlightDom.ts`) depends on.
 */
export function ReaderSidebarFrame({
  label,
  widthClassName,
  onClose,
  children,
  /** The sticky rail's offset assumes the app shell's ~3.5rem header is
   *  visible above it; the reader's own distraction-reduced focus mode
   *  hides that header entirely (`AppShell`'s `sr-only` swap), so its one
   *  caller (the analysis panel, forced open in focus mode) passes `true`
   *  here to pin flush to the real top of the viewport instead of leaving
   *  a blank ~3.5rem gap where the hidden header used to be. */
  flushTop = false,
}: {
  label: string;
  widthClassName: string;
  onClose: () => void;
  children: React.ReactNode;
  flushTop?: boolean;
}) {
  const narrow = useNarrowViewport();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (narrow) closeButtonRef.current?.focus();
  }, [narrow]);

  if (narrow) {
    return (
      <div className="fixed inset-0 z-40 flex items-end bg-black/35" role="presentation" onMouseDown={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="app-panel-enter flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-t-xl border-t border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl"
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
            <span className="text-sm font-semibold text-[var(--color-text)]">{label}</span>
            <button
              ref={closeButtonRef}
              type="button"
              className="app-control app-icon-button"
              aria-label={`Close ${label}`}
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`sticky ${flushTop ? "top-0 max-h-dvh" : "top-14 max-h-[calc(100dvh-3.5rem)]"} ${widthClassName} shrink-0 self-start overflow-y-auto`}
    >
      {children}
    </div>
  );
}
