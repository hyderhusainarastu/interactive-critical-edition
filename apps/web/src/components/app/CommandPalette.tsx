"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface CommandWork { id: string; title: string; authorName: string | null }
interface NavigationItem { href: string; label: string; shortcut?: string }

/**
 * Command-palette extension seam (redesign-shell-spec.md §6.3). Stage 1
 * ships this type and refactors the palette's two existing hard-coded
 * groups ("Navigate", "Uploaded works") to conform to it and render through
 * one shared `.map()`, so a later stage adding a `claims`/`library`/etc.
 * group is an additive array entry, not a structural edit to this
 * component. The actual new fetch endpoints/entity types are explicitly
 * NOT Stage 1 scope — see spec §6.3/§8.
 */
export interface PaletteResult {
  id: string;
  href: string;
  primaryText: string;
  secondaryText?: string;
  shortcut?: string;
}

export interface PaletteResultGroup {
  id: string;
  label: string;
  results: PaletteResult[];
}

export function CommandPalette({ items }: { items: NavigationItem[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [works, setWorks] = useState<CommandWork[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setOpen(true);
      }
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    };
    const onOpen = (event: Event) => {
      const trigger = (event as CustomEvent<HTMLElement | undefined>).detail;
      triggerRef.current = trigger instanceof HTMLElement ? trigger : document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("palimnote:open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("palimnote:open-command-palette", onOpen);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (works.length > 0) return;
    fetch("/api/command-menu")
      .then(async (response) => response.ok ? response.json() : { works: [] })
      .then((response) => setWorks(Array.isArray(response.works) ? response.works : []))
      .catch(() => setWorks([]));
  }, [open, works.length]);

  const normalized = query.trim().toLocaleLowerCase();

  const groups: PaletteResultGroup[] = useMemo(() => {
    const visibleNavigation: PaletteResult[] = items
      .filter((item) => !normalized || item.label.toLocaleLowerCase().includes(normalized))
      .map((item) => ({ id: item.href, href: item.href, primaryText: item.label, shortcut: item.shortcut }));

    const visibleWorks: PaletteResult[] = works
      .filter((work) => !normalized || `${work.title} ${work.authorName ?? ""}`.toLocaleLowerCase().includes(normalized))
      .slice(0, 8)
      .map((work) => ({ id: work.id, href: `/works/${work.id}`, primaryText: work.title, secondaryText: work.authorName ?? undefined }));

    const result: PaletteResultGroup[] = [];
    if (visibleNavigation.length > 0) result.push({ id: "navigate", label: "Navigate", results: visibleNavigation });
    if (visibleWorks.length > 0) result.push({ id: "works", label: "Uploaded works", results: visibleWorks });
    return result;
  }, [items, normalized, works]);

  const hasResults = groups.some((group) => group.results.length > 0);

  // Kept as this component's own implementation deliberately, not migrated
  // onto `useFocusTrap` yet — redesign-shell-spec.md §5.2 defers migrating
  // CommandPalette's existing (already-working) focus trap to a later
  // stage; Stage 1 only wires the shared primitive into the *new* Stage 1
  // chrome (the mobile Read-management sheet).
  function trapFocus(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
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

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/35 p-4 sm:p-12" role="presentation" onMouseDown={() => close()}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
        className="mx-auto max-w-xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={trapFocus}
      >
        <label className="sr-only" htmlFor="command-search">Search Palimnote</label>
        <input
          id="command-search"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages and uploaded works…"
          className="w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3 text-base outline-none"
        />
        <div className="max-h-[min(65vh,34rem)] overflow-y-auto p-2">
          {groups.map((group) => (
            <PaletteGroup key={group.id} label={group.label}>
              {group.results.map((result) => (
                <PaletteLink key={result.id} href={result.href} onSelect={() => close(false)}>
                  <span>{result.primaryText}</span>
                  {result.secondaryText && <span className="text-xs text-[var(--color-text-muted)]">{result.secondaryText}</span>}
                  {result.shortcut && <kbd>{result.shortcut}</kbd>}
                </PaletteLink>
              ))}
            </PaletteGroup>
          ))}
          {!hasResults && <p className="px-3 py-6 text-sm text-[var(--color-text-muted)]">No matching page or work.</p>}
        </div>
      </section>
    </div>
  );
}

function PaletteGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="py-1"><h2 className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</h2>{children}</section>;
}

function PaletteLink({ href, onSelect, children }: { href: string; onSelect: () => void; children: React.ReactNode }) {
  return <Link href={href} onClick={onSelect} className="flex min-h-10 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm hover:bg-[var(--color-surface)]">{children}</Link>;
}
