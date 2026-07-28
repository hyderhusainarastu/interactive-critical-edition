"use client";

import { useEffect, useId, useRef } from "react";
import { useDialogEscape } from "./useDialogEscape";
import { useFocusRestoration } from "./useFocusRestoration";
import { useFocusTrap } from "./useFocusTrap";

/**
 * A minimal, reusable accessible confirm dialog — built for the integration
 * step's own Research destructive actions that never had ANY confirmation
 * step at all (`deleteMonitor`, `removeMember`, `deleteQuestion` in
 * `MonitorsView.tsx`/`ResearchProjectOverview.tsx`): charter §6 "Research"
 * mandates accessible dialogs in place of `window.prompt`/`window.alert`,
 * and these three actions fired immediately on click with no
 * `window.confirm` either — a fresh accessible dialog here is a pure
 * addition, not a migration of an existing native-dialog assertion.
 *
 * Built on the REAL Stage 1 primitives (`useFocusTrap`/`useDialogEscape`/
 * `useFocusRestoration`) — the same three hooks `ReadManagementSheet.tsx`
 * already composes this way — rather than the ~20-line hand-rolled Tab-cycle
 * `onKeyDown` that `PermanentDeleteDialog.tsx`/`CreateResearchProjectDialog.tsx`
 * each independently copy (both predate this integration pass and are left
 * exactly as-is; refactoring them onto these hooks isn't part of this
 * step's scope, but every *new* confirm surface this step adds uses the
 * shared hooks properly instead of a fourth hand-rolled copy).
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy = false,
  destructive = true,
  triggerRef,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  /** Styles the confirm control as destructive (burgundy outline, matching
   *  `PermanentDeleteDialog.tsx`'s own destructive-confirm styling) vs. a
   *  plain affirmative action. Every current caller is destructive, but
   *  this stays an explicit prop rather than hardcoding that assumption
   *  into the component. */
  destructive?: boolean;
  /** The button that opened this dialog — focus returns here on cancel or
   *  Escape, per the same `useFocusRestoration` contract every other Stage 1
   *  dialog/menu in this codebase already follows. */
  triggerRef: React.RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const restoreFocus = useFocusRestoration(triggerRef);

  const cancel = () => {
    onCancel();
    restoreFocus();
  };

  // Rendered only while open (the caller conditionally mounts this
  // component), so both hooks are simply always-active for this
  // component's lifetime — the same shape `ReadManagementSheet.tsx` uses
  // for its own always-mounted-while-open dialog.
  useFocusTrap(dialogRef, true);
  useDialogEscape(true, cancel);

  useEffect(() => {
    // Initial focus on the safe (Cancel) control — the destructive-
    // confirmation pattern `PermanentDeleteDialog.tsx` already establishes,
    // unlike a creation flow where focus starts on the field being filled.
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={cancel}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="app-panel-enter w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={headingId} className="font-serif text-lg font-semibold text-[var(--color-text)]">
          {title}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={cancel}
            className="app-control rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`app-control rounded-md px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
              destructive
                ? "border border-[var(--color-accent-burgundy)] text-[var(--color-accent-burgundy)]"
                : "bg-[var(--color-accent-ink)] text-[var(--color-background)]"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
