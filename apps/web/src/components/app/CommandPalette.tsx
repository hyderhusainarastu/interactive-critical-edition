"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

interface CommandWork { id: string; title: string; authorName: string | null }
interface NavigationItem { href: string; label: string; shortcut?: string }

export function CommandPalette({ items }: { items: NavigationItem[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [works, setWorks] = useState<CommandWork[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
  const visibleNavigation = useMemo(
    () => items.filter((item) => !normalized || item.label.toLocaleLowerCase().includes(normalized)),
    [items, normalized],
  );
  const visibleWorks = useMemo(
    () => works.filter((work) => !normalized || `${work.title} ${work.authorName ?? ""}`.toLocaleLowerCase().includes(normalized)).slice(0, 8),
    [works, normalized],
  );

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/35 p-4 sm:p-12" role="presentation" onMouseDown={() => setOpen(false)}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="mx-auto max-w-xl overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <label className="sr-only" htmlFor="command-search">Search Palimnote</label>
        <input
          id="command-search"
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pages and your works…"
          className="w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3 text-base outline-none"
        />
        <div className="max-h-[min(65vh,34rem)] overflow-y-auto p-2">
          {visibleNavigation.length > 0 && <PaletteGroup label="Navigate">
            {visibleNavigation.map((item) => <PaletteLink key={item.href} href={item.href} onSelect={() => setOpen(false)}>{item.label}{item.shortcut && <kbd>{item.shortcut}</kbd>}</PaletteLink>)}
          </PaletteGroup>}
          {visibleWorks.length > 0 && <PaletteGroup label="Your works">
            {visibleWorks.map((work) => <PaletteLink key={work.id} href={`/works/${work.id}`} onSelect={() => setOpen(false)}><span>{work.title}</span>{work.authorName && <span className="text-xs text-[var(--color-text-muted)]">{work.authorName}</span>}</PaletteLink>)}
          </PaletteGroup>}
          {visibleNavigation.length === 0 && visibleWorks.length === 0 && <p className="px-3 py-6 text-sm text-[var(--color-text-muted)]">No matching page or work.</p>}
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
