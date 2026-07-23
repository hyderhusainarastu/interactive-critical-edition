"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Phase 20.3 permanent-delete confirmation: a modal dialog that names the
 * work, states irreversibility and what is removed, and — for high-value
 * works (multiple editions or a ready document) — requires the work's title
 * to be typed exactly before the destructive action enables. Keyboard
 * lifecycle follows the D-19-14/15 precedent: focus-contained, Escape
 * closes, initial focus lands on the safe (Cancel) control, and the caller
 * restores focus to the trigger on close.
 */
export function PermanentDeleteDialog({
  title,
  requiresTypedConfirmation,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  requiresTypedConfirmation: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const inputId = useId();

  const confirmEnabled = !busy && (!requiresTypedConfirmation || typed === title);

  useEffect(() => {
    // Initial focus on the non-destructive control, per the dialog pattern.
    cancelRef.current?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="app-panel-enter w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id={headingId} className="font-serif text-lg font-semibold text-[var(--color-text)]">
          Permanently delete “{title}”?
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          This removes the work, its uploaded file, its editions and reader data, your highlights, notes and
          bookmarks, its annotations, and its Ask Library passages. It cannot be undone.
        </p>
        {requiresTypedConfirmation && (
          <div className="mt-4">
            <label htmlFor={inputId} className="block text-sm font-medium text-[var(--color-text)]">
              Type the work&apos;s title to confirm
            </label>
            <input
              id={inputId}
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="app-control mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)]"
            />
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="app-control rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!confirmEnabled}
            onClick={onConfirm}
            className="app-control rounded-md border border-[var(--color-accent-burgundy)] px-4 py-2 text-sm text-[var(--color-accent-burgundy)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete permanently"}
          </button>
        </div>
      </section>
    </div>
  );
}
