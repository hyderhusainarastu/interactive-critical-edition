"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { READER_LEVELS, type ReaderLevel } from "@ice/roadmap";
import type { WorkspacePreferences } from "@/lib/workspacePreferences";
import { logoutAction } from "@/lib/actions";
import { BetaBadge } from "@/components/shared/BetaBadge";
import { Wordmark } from "@/components/site/Wordmark";
import { SoundToggle } from "@/components/site/SoundToggle";
import { AppFooter } from "./AppFooter";
import { CommandPalette } from "./CommandPalette";
import { GlobalRagSidebar } from "./GlobalRagSidebar";
import { ToastProvider, useToast } from "./ToastProvider";
import { WorkspacePreferencesProvider, useWorkspacePreferences } from "./WorkspacePreferencesProvider";

const READER_LEVEL_LABEL: Record<ReaderLevel, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
};

/** Matches only a real (UUID-shaped) work id segment, e.g. `/works/<id>` or
 * `/works/<id>/roadmap` — deliberately excludes non-id siblings like
 * `/works/trash` and the bare `/works` listing, which have no "current
 * work" for the global RAG sidebar to scope to. */
const WORK_ROUTE_PATTERN = /^\/works\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

interface NavItem { href: string; label: string }

export function AppShell({
  email,
  admin,
  writerEnabled,
  ragEnabled,
  initialPreferences,
  initialReaderLevel = null,
  children,
}: {
  email: string | null | undefined;
  admin: boolean;
  writerEnabled: boolean;
  ragEnabled: boolean;
  initialPreferences: WorkspacePreferences;
  initialReaderLevel?: ReaderLevel | null;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <WorkspacePreferencesProvider initialPreferences={initialPreferences}>
        <AppShellContents email={email} admin={admin} writerEnabled={writerEnabled} ragEnabled={ragEnabled} initialReaderLevel={initialReaderLevel}>{children}</AppShellContents>
      </WorkspacePreferencesProvider>
    </ToastProvider>
  );
}

function AppShellContents({ email, admin, writerEnabled, ragEnabled, initialReaderLevel, children }: { email: string | null | undefined; admin: boolean; writerEnabled: boolean; ragEnabled: boolean; initialReaderLevel: ReaderLevel | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [ragOpen, setRagOpen] = useState(false);
  const [headerCompact, setHeaderCompact] = useState(false);
  const [readerLevel, setReaderLevel] = useState<ReaderLevel | null>(initialReaderLevel);
  const drawerTriggerRef = useRef<HTMLButtonElement>(null);
  const preferencesTriggerRef = useRef<HTMLButtonElement>(null);
  const ragTriggerRef = useRef<HTMLButtonElement>(null);
  const focusModeExitRef = useRef<HTMLButtonElement>(null);
  const focusModeFocusRequestRef = useRef<"enter" | "exit" | null>(null);
  const preferencesMenuId = useId();
  const ragSidebarId = useId();
  const { preferences, updatePreferences } = useWorkspacePreferences();
  const routeWorkId = WORK_ROUTE_PATTERN.exec(pathname)?.[1] ?? null;
  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/graph", label: "Visualization" },
    { href: "/works", label: "Works" },
    { href: "/library", label: "Library" },
    ...(ragEnabled ? [{ href: "/ask-library", label: "Ask Library" }] : []),
    ...(writerEnabled ? [{ href: "/writer", label: "Writer" }] : []),
    { href: "/upload", label: "Upload" },
    ...(admin ? [{ href: "/admin", label: "Admin" }] : []),
  ];
  const focusMode = preferences.focusMode;
  useEffect(() => {
    const update = () => setHeaderCompact(window.scrollY > 18);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  useEffect(() => {
    const request = focusModeFocusRequestRef.current;
    if ((request === "enter" && !focusMode) || (request === "exit" && focusMode) || !request) return;
    focusModeFocusRequestRef.current = null;
    window.requestAnimationFrame(() => (request === "enter" ? focusModeExitRef.current : preferencesTriggerRef.current)?.focus());
  }, [focusMode]);

  function setFocusMode(enabled: boolean) {
    focusModeFocusRequestRef.current = enabled ? "enter" : "exit";
    if (enabled) setPreferencesOpen(false);
    updatePreferences({ focusMode: enabled });
  }

  // Distinct from `updatePreferences` above: this is the explicit,
  // account-level `users.readerLevel` (POST /api/reader-level), not a
  // local-storage-synced workspace preference. `router.refresh()` re-runs
  // every page's server component so pages seeded from `getUserReaderLevel()`
  // (Library, Curriculum, Roadmap, Reader) pick up the new default on their
  // next render, matching "browsing alone never silently changes a level" —
  // this only fires on an explicit selection here.
  async function updateReaderLevel(level: ReaderLevel) {
    const previous = readerLevel;
    setReaderLevel(level);
    try {
      const response = await fetch("/api/reader-level", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setReaderLevel(previous);
      toast("Your reader level could not be saved.", "error");
    }
  }

  function closeDrawer() {
    setDrawerOpen(false);
    window.requestAnimationFrame(() => drawerTriggerRef.current?.focus());
  }
  function closePreferences() {
    setPreferencesOpen(false);
    window.requestAnimationFrame(() => preferencesTriggerRef.current?.focus());
  }
  function closeRag() {
    setRagOpen(false);
    window.requestAnimationFrame(() => ragTriggerRef.current?.focus());
  }

  return (
    <div className="app-shell flex min-h-full min-w-0 flex-col overflow-x-clip">
      {focusMode && <button ref={focusModeExitRef} type="button" className="app-control fixed right-4 top-4 z-40 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm shadow-md" onClick={() => setFocusMode(false)}>Exit focus mode</button>}
      <header inert={focusMode} className={focusMode ? "sr-only" : `app-shell-header sticky top-0 z-30 w-full min-w-0 overflow-x-clip border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-background)_94%,transparent)] backdrop-blur ${headerCompact ? "header-compact" : ""}`}>
        <div className="mx-auto grid min-h-14 w-full min-w-0 max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Wordmark href="/dashboard" className="shrink-0 font-serif text-lg font-semibold tracking-tight text-[var(--color-text)]" />
            <BetaBadge />
          </div>
          {/* D-23-15: the middle `minmax(0,1fr)` grid track can be narrower than
              the nav's no-wrap content at tablet widths (768–~1000px), making the
              links overflow under the controls column (theme toggle over
              Writer/Upload). `flex-wrap` (+ `min-w-0` and a small vertical pad
              for the wrapped state) lets the nav break onto extra lines inside
              its own track instead — the row's `min-h-14` grows with it, so no
              two header controls can ever share the same pixels. */}
          <nav className="hidden min-w-0 flex-wrap items-center gap-1 py-1.5 md:flex" aria-label="Primary navigation">
            {navItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)}
          </nav>
            <div className="flex items-center gap-1.5">
            <SoundToggle enabled={preferences.soundEnabled} onChange={(soundEnabled) => updatePreferences({ soundEnabled })} />
            <button type="button" className="app-control app-icon-button hidden sm:inline-flex" data-tooltip="Search pages and works (⌘K)" aria-label="Search pages and works" onClick={(event) => window.dispatchEvent(new CustomEvent("palimnote:open-command-palette", { detail: event.currentTarget }))}>⌕</button>
            {/* Phase 23.2 (D-23-x): both toggle buttons and "Log out" bumped
                to the 44x44 touch-target floor via `min-h-11 min-w-11` —
                padding-only, no visual redesign; the header row (`min-h-14`)
                already has the vertical room. */}
            <div className="hidden items-center rounded-md border border-[var(--color-border)] p-0.5 sm:flex" aria-label="Quick light or dark switch">
              <button type="button" className={`app-control min-h-11 min-w-11 rounded px-2 py-1 text-xs ${preferences.theme === "light" ? "bg-[var(--color-surface)] font-medium" : "text-[var(--color-text-muted)]"}`} aria-pressed={preferences.theme === "light"} onClick={() => updatePreferences({ theme: "light" })}>Light</button>
              <button type="button" className={`app-control min-h-11 min-w-11 rounded px-2 py-1 text-xs ${preferences.theme === "dark" ? "bg-[var(--color-surface)] font-medium" : "text-[var(--color-text-muted)]"}`} aria-pressed={preferences.theme === "dark"} onClick={() => updatePreferences({ theme: "dark" })}>Dark</button>
            </div>
            <div className="relative">
              <button ref={preferencesTriggerRef} type="button" className="app-control app-icon-button" data-tooltip="Workspace preferences" aria-label="Workspace preferences" aria-expanded={preferencesOpen} aria-controls={preferencesMenuId} onClick={() => preferencesOpen ? closePreferences() : setPreferencesOpen(true)}>⚙</button>
              {preferencesOpen && <PreferencesMenu id={preferencesMenuId} preferences={preferences} onUpdate={updatePreferences} onFocusModeChange={setFocusMode} readerLevel={readerLevel} onReaderLevelChange={updateReaderLevel} onClose={closePreferences} />}
            </div>
            {ragEnabled && (
              <button
                ref={ragTriggerRef}
                type="button"
                className="app-control app-icon-button"
                data-tooltip="Library chat sidebar"
                aria-label="Library chat sidebar"
                aria-expanded={ragOpen}
                aria-controls={ragSidebarId}
                onClick={() => (ragOpen ? closeRag() : setRagOpen(true))}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 11.5 L4 14 L7 11.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                  <text x="8" y="9.2" fontFamily="Georgia, serif" fontSize="7.5" textAnchor="middle" fill="currentColor">§</text>
                </svg>
              </button>
            )}
            <form action={logoutAction} className="hidden lg:block">
              <button type="submit" className="app-control inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Log out</button>
            </form>
            <button ref={drawerTriggerRef} type="button" className="app-control app-icon-button md:hidden" data-tooltip="Open navigation" aria-label="Open navigation" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>☰</button>
          </div>
        </div>
      </header>
      {drawerOpen && <MobileDrawer items={navItems} pathname={pathname} email={email} onClose={closeDrawer} />}
      <main id="main-content" className="app-shell-main flex-1">{children}</main>
      <AppFooter />
      <CommandPalette items={navItems.map((item) => ({ ...item, shortcut: item.href === "/upload" ? "U" : undefined }))} />
      {ragEnabled && ragOpen && <GlobalRagSidebar id={ragSidebarId} contextWorkId={routeWorkId} onClose={closeRag} />}
    </div>
  );
}

function NavLink({ item, pathname, onClick }: { item: NavItem; pathname: string; onClick?: () => void }) {
  const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
  return <Link href={item.href} data-sound="click" onClick={onClick} aria-current={active ? "page" : undefined} className={`nav app-control whitespace-nowrap border-b-2 px-1 py-1.5 text-[11px] font-bold uppercase tracking-[.08em] ${active ? "border-[var(--color-accent-ink)] text-[var(--color-text)]" : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}>{item.label}</Link>;
}

function MobileDrawer({ items, pathname, email, onClose }: { items: NavItem[]; pathname: string; email: string | null | undefined; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  function keepFocusInDrawer(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const focusable = [...drawer.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      drawer.focus();
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

  return (
    <div className="fixed inset-0 z-40 bg-black/35 md:hidden" role="presentation" onMouseDown={onClose}>
      <aside ref={drawerRef} role="dialog" aria-modal="true" tabIndex={-1} className="app-panel-enter ms-auto flex h-full w-[min(20rem,86vw)] flex-col bg-[var(--color-background)] p-5 shadow-2xl" aria-label="Mobile navigation" onMouseDown={(event) => event.stopPropagation()} onKeyDown={keepFocusInDrawer}>
        <div className="flex items-center justify-between"><strong className="font-serif text-lg">Palimnote</strong><button ref={closeButtonRef} type="button" className="app-control app-icon-button" aria-label="Close navigation" onClick={onClose}>×</button></div>
        <nav className="mt-6 flex flex-col gap-1">{items.map((item) => <NavLink key={item.href} item={item} pathname={pathname} onClick={onClose} />)}</nav>
        <div className="mt-auto border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-text-muted)]"><p className="truncate">{email}</p><form action={logoutAction} className="mt-3"><button type="submit" className="app-control inline-flex min-h-11 items-center underline">Log out</button></form></div>
      </aside>
    </div>
  );
}

function PreferencesMenu({
  id,
  preferences,
  onUpdate,
  onFocusModeChange,
  readerLevel,
  onReaderLevelChange,
  onClose,
}: {
  id: string;
  preferences: WorkspacePreferences;
  onUpdate: (patch: Partial<WorkspacePreferences>) => void;
  onFocusModeChange: (enabled: boolean) => void;
  readerLevel: ReaderLevel | null;
  onReaderLevelChange: (level: ReaderLevel) => void;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <section id={id} role="dialog" className="app-panel-enter absolute end-0 top-11 z-40 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 shadow-xl" aria-label="Workspace preferences" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Workspace preferences</h2><button ref={closeButtonRef} type="button" className="app-control app-icon-button h-7 w-7" aria-label="Close preferences" onClick={onClose}>×</button></div>
      <PreferenceField label="Theme"><select className="app-control" value={preferences.theme} onChange={(event) => onUpdate({ theme: event.target.value as WorkspacePreferences["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></PreferenceField>
      <PreferenceField label="Text size"><select className="app-control" value={preferences.fontSize} onChange={(event) => onUpdate({ fontSize: event.target.value as WorkspacePreferences["fontSize"] })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></PreferenceField>
      <PreferenceField label="Reading width"><select className="app-control" value={preferences.readingWidth} onChange={(event) => onUpdate({ readingWidth: event.target.value as WorkspacePreferences["readingWidth"] })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="wide">Wide</option></select></PreferenceField>
      <PreferenceField label="Script display"><select className="app-control" value={preferences.scriptDisplay} onChange={(event) => onUpdate({ scriptDisplay: event.target.value as WorkspacePreferences["scriptDisplay"] })}><option value="original">Verified original script</option><option value="transliteration">Transliteration</option></select></PreferenceField>
      <label className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3 text-sm"><span>Interface sounds</span><input type="checkbox" checked={preferences.soundEnabled} onChange={(event) => onUpdate({ soundEnabled: event.target.checked })} /></label>
      <label className="mt-3 flex items-center justify-between gap-3 text-sm"><span>Motion</span><input type="checkbox" checked={preferences.motionEnabled} onChange={(event) => onUpdate({ motionEnabled: event.target.checked })} /></label>
      {/* Distinct from the four fields above: this writes the account-level
          `users.readerLevel` (POST /api/reader-level), not a local-storage
          workspace preference — it's the same default Library/Curriculum/
          Roadmap/Reader already read via `getUserReaderLevel()`, just now
          settable from one place instead of only at onboarding. */}
      <PreferenceField label="Reader level">
        <select className="app-control" value={readerLevel ?? ""} onChange={(event) => onReaderLevelChange(event.target.value as ReaderLevel)}>
          {readerLevel === null && <option value="" disabled>Not set</option>}
          {READER_LEVELS.map((level) => <option key={level} value={level}>{READER_LEVEL_LABEL[level]}</option>)}
        </select>
      </PreferenceField>
      <label className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3 text-sm"><span>Focus mode</span><input type="checkbox" checked={preferences.focusMode} onChange={(event) => onFocusModeChange(event.target.checked)} /></label>
    </section>
  );
}

function PreferenceField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mt-2 flex flex-col gap-1 text-xs text-[var(--color-text-muted)]"><span>{label}</span><span className="[&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-[var(--color-border)] [&_select]:bg-[var(--color-background)] [&_select]:px-2 [&_select]:py-1.5 [&_select]:text-sm [&_select]:text-[var(--color-text)]">{children}</span></label>;
}
