"use client";

import { useEffect, useRef } from "react";
import { useDialogEscape } from "@/components/primitives/useDialogEscape";
import { useFocusRestoration } from "@/components/primitives/useFocusRestoration";
import { useFocusTrap } from "@/components/primitives/useFocusTrap";

/**
 * Stage 6 layout spec §2.1/§8: the narrow-viewport (<1024px) bottom-sheet
 * chrome shared by both Writer panels, built directly on the
 * `ReadManagementSheet.tsx` pattern (`role="dialog"`, `aria-modal`,
 * `useFocusTrap`+`useDialogEscape`+`useFocusRestoration`, `app-panel-enter`
 * slide-up, safe-area padding) — parameterized by label/children/open/close
 * instead of two independent copies. `open`/`onClose` are driven by the
 * caller (WriterEditor, via the shell's `SecondaryPanelProvider` singleton),
 * not owned here — this component is pure sheet chrome, not a panel-state
 * source of truth.
 *
 * Reduced motion is respected for free: `app-panel-enter`'s animation is
 * already covered by the site-wide `:root[data-motion="reduced"] *`
 * override (globals.css), so no new motion vocabulary is introduced here.
 */
export function WriterPanelSheet({
  open,
  onClose,
  triggerRef,
  label,
  id,
  children,
}: {
  open: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  label: string;
  /** Links a toolbar toggle button's `aria-controls` to this sheet's own
   *  dialog element, matching the `id` the inline `<aside>` variant also
   *  carries — the caller passes the same id to both. */
  id?: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useFocusRestoration(triggerRef);

  const close = () => {
    onClose();
    restoreFocus();
  };
  const closeFromOutside = () => onClose();

  useFocusTrap(dialogRef, open);
  useDialogEscape(open, close);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 bg-black/35 lg:hidden" role="presentation" onMouseDown={closeFromOutside}>
      <section
        ref={dialogRef}
        id={id}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-label={label}
        className="app-panel-enter absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col gap-1 overflow-y-auto rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-background)] p-4 shadow-2xl"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-serif text-base font-semibold text-[var(--color-text)]">{label}</h2>
          <button ref={closeButtonRef} type="button" className="app-control app-icon-button h-8 w-8" aria-label={`Close ${label}`} onClick={close}>
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
