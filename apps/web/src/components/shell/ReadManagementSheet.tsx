"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useDialogEscape } from "@/components/primitives/useDialogEscape";
import { useFocusRestoration } from "@/components/primitives/useFocusRestoration";
import { useFocusTrap } from "@/components/primitives/useFocusTrap";
import { useSecondaryPanel } from "@/components/primitives/useSecondaryPanel";

const ITEMS = [
  { href: "/library", label: "Library" },
  { href: "/upload", label: "Upload" },
  { href: "/works/trash", label: "Trash" },
];

/**
 * The mobile "secondary Library/Read management menu" the charter requires
 * (§6 Read subnav: "Trash, placed in a secondary Library/Read management
 * menu but always reachable") — redesign-shell-spec.md §3.2/§3.4. Reachable
 * from `ContextBar` on any Read-family route (`/works*`, `/library*`) below
 * the `md` breakpoint, where the rail's own always-visible Read subnav isn't
 * rendered. Replaces the old slide-in `MobileDrawer` as the one remaining
 * modal mobile surface: focus-trapped, Escape-closes, restores focus to its
 * trigger — built on the new shared primitives rather than a fifth hand-
 * rolled copy of the same mechanism.
 */
export function ReadManagementSheet() {
  const panel = useSecondaryPanel("read-management");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useFocusRestoration(triggerRef);

  const close = () => {
    panel.close();
    restoreFocus();
  };
  const closeFromOutside = () => panel.close();

  useFocusTrap(dialogRef, panel.isOpen);
  useDialogEscape(panel.isOpen, close);

  useEffect(() => {
    if (panel.isOpen) closeButtonRef.current?.focus();
  }, [panel.isOpen]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="app-control app-icon-button md:hidden"
        data-tooltip="Read management"
        aria-label="Read management"
        aria-expanded={panel.isOpen}
        onClick={() => panel.open()}
      >
        ≡
      </button>
      {panel.isOpen && (
        <div className="fixed inset-0 z-40 bg-black/35 md:hidden" role="presentation" onMouseDown={closeFromOutside}>
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label="Read management"
            className="app-panel-enter absolute inset-x-0 bottom-0 flex max-h-[70vh] flex-col gap-1 rounded-t-2xl border-t border-[var(--color-border)] bg-[var(--color-background)] p-4 shadow-2xl"
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold text-[var(--color-text)]">Read management</h2>
              <button ref={closeButtonRef} type="button" className="app-control app-icon-button h-8 w-8" aria-label="Close Read management" onClick={close}>×</button>
            </div>
            <nav className="flex flex-col gap-1" aria-label="Read management links">
              {ITEMS.map((item) => (
                <Link key={item.href} href={item.href} data-sound="click" className="app-control min-h-11 rounded-md px-3 py-2 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface)]" onClick={() => panel.close()}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </section>
        </div>
      )}
    </>
  );
}
