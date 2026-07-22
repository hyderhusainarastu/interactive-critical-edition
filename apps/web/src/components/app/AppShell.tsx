"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { WorkspacePreferences } from "@/lib/workspacePreferences";
import { logoutAction } from "@/lib/actions";
import { CommandPalette } from "./CommandPalette";
import { ToastProvider } from "./ToastProvider";
import { WorkspacePreferencesProvider, useWorkspacePreferences } from "./WorkspacePreferencesProvider";

interface NavItem { href: string; label: string }

export function AppShell({
  email,
  admin,
  writerEnabled,
  ragEnabled,
  initialPreferences,
  children,
}: {
  email: string | null | undefined;
  admin: boolean;
  writerEnabled: boolean;
  ragEnabled: boolean;
  initialPreferences: WorkspacePreferences;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <WorkspacePreferencesProvider initialPreferences={initialPreferences}>
        <AppShellContents email={email} admin={admin} writerEnabled={writerEnabled} ragEnabled={ragEnabled}>{children}</AppShellContents>
      </WorkspacePreferencesProvider>
    </ToastProvider>
  );
}

function AppShellContents({ email, admin, writerEnabled, ragEnabled, children }: { email: string | null | undefined; admin: boolean; writerEnabled: boolean; ragEnabled: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const { preferences, updatePreferences } = useWorkspacePreferences();
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

  return (
    <div className="app-shell flex min-h-full min-w-0 flex-col overflow-x-clip">
      {focusMode && <button type="button" className="fixed right-4 top-4 z-40 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm shadow-md" onClick={() => updatePreferences({ focusMode: false })}>Exit focus mode</button>}
      <header className={focusMode ? "sr-only" : "app-shell-header sticky top-0 z-30 w-full min-w-0 overflow-x-clip border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-background)_94%,transparent)] backdrop-blur"}>
        <div className="mx-auto grid min-h-14 w-full min-w-0 max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 sm:px-6">
          <Link href="/dashboard" className="shrink-0 font-serif text-lg font-semibold tracking-tight text-[var(--color-text)]">Palimnote</Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
            {navItems.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)}
          </nav>
          <div className="flex items-center gap-1.5">
            <button type="button" className="app-icon-button hidden sm:inline-flex" data-tooltip="Search pages and works (⌘K)" aria-label="Search pages and works" onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}>⌕</button>
            <div className="hidden items-center rounded-md border border-[var(--color-border)] p-0.5 sm:flex" aria-label="Quick light or dark switch">
              <button type="button" className={`rounded px-2 py-1 text-xs ${preferences.theme === "light" ? "bg-[var(--color-surface)] font-medium" : "text-[var(--color-text-muted)]"}`} aria-pressed={preferences.theme === "light"} onClick={() => updatePreferences({ theme: "light" })}>Light</button>
              <button type="button" className={`rounded px-2 py-1 text-xs ${preferences.theme === "dark" ? "bg-[var(--color-surface)] font-medium" : "text-[var(--color-text-muted)]"}`} aria-pressed={preferences.theme === "dark"} onClick={() => updatePreferences({ theme: "dark" })}>Dark</button>
            </div>
            <div className="relative">
              <button type="button" className="app-icon-button" data-tooltip="Workspace preferences" aria-label="Workspace preferences" aria-expanded={preferencesOpen} onClick={() => setPreferencesOpen((open) => !open)}>⚙</button>
              {preferencesOpen && <PreferencesMenu preferences={preferences} onUpdate={updatePreferences} onClose={() => setPreferencesOpen(false)} />}
            </div>
            <form action={logoutAction} className="hidden lg:block">
              <button type="submit" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">Log out</button>
            </form>
            <button type="button" className="app-icon-button md:hidden" data-tooltip="Open navigation" aria-label="Open navigation" aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>☰</button>
          </div>
        </div>
      </header>
      {drawerOpen && <MobileDrawer items={navItems} pathname={pathname} email={email} onClose={() => setDrawerOpen(false)} />}
      <main id="main-content" className="app-shell-main flex-1">{children}</main>
      <CommandPalette items={navItems.map((item) => ({ ...item, shortcut: item.href === "/upload" ? "U" : undefined }))} />
    </div>
  );
}

function NavLink({ item, pathname, onClick }: { item: NavItem; pathname: string; onClick?: () => void }) {
  const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
  return <Link href={item.href} onClick={onClick} aria-current={active ? "page" : undefined} className={`rounded-md px-2.5 py-1.5 text-sm ${active ? "bg-[var(--color-surface)] font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"}`}>{item.label}</Link>;
}

function MobileDrawer({ items, pathname, email, onClose }: { items: NavItem[]; pathname: string; email: string | null | undefined; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/35 md:hidden" role="presentation" onMouseDown={onClose}>
      <aside className="ms-auto flex h-full w-[min(20rem,86vw)] flex-col bg-[var(--color-background)] p-5 shadow-2xl" aria-label="Mobile navigation" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between"><strong className="font-serif text-lg">Palimnote</strong><button type="button" className="app-icon-button" aria-label="Close navigation" onClick={onClose}>×</button></div>
        <nav className="mt-6 flex flex-col gap-1">{items.map((item) => <NavLink key={item.href} item={item} pathname={pathname} onClick={onClose} />)}</nav>
        <div className="mt-auto border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-text-muted)]"><p className="truncate">{email}</p><form action={logoutAction} className="mt-3"><button type="submit" className="underline">Log out</button></form></div>
      </aside>
    </div>
  );
}

function PreferencesMenu({ preferences, onUpdate, onClose }: { preferences: WorkspacePreferences; onUpdate: (patch: Partial<WorkspacePreferences>) => void; onClose: () => void }) {
  return (
    <section className="absolute end-0 top-11 z-40 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 shadow-xl" aria-label="Workspace preferences" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">Workspace preferences</h2><button type="button" className="app-icon-button h-7 w-7" aria-label="Close preferences" onClick={onClose}>×</button></div>
      <PreferenceField label="Theme"><select value={preferences.theme} onChange={(event) => onUpdate({ theme: event.target.value as WorkspacePreferences["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></PreferenceField>
      <PreferenceField label="Text size"><select value={preferences.fontSize} onChange={(event) => onUpdate({ fontSize: event.target.value as WorkspacePreferences["fontSize"] })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></PreferenceField>
      <PreferenceField label="Reading width"><select value={preferences.readingWidth} onChange={(event) => onUpdate({ readingWidth: event.target.value as WorkspacePreferences["readingWidth"] })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="wide">Wide</option></select></PreferenceField>
      <PreferenceField label="Script display"><select value={preferences.scriptDisplay} onChange={(event) => onUpdate({ scriptDisplay: event.target.value as WorkspacePreferences["scriptDisplay"] })}><option value="original">Verified original script</option><option value="transliteration">Transliteration</option></select></PreferenceField>
      <label className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-3 text-sm"><span>Focus mode</span><input type="checkbox" checked={preferences.focusMode} onChange={(event) => onUpdate({ focusMode: event.target.checked })} /></label>
    </section>
  );
}

function PreferenceField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="mt-2 flex flex-col gap-1 text-xs text-[var(--color-text-muted)]"><span>{label}</span><span className="[&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-[var(--color-border)] [&_select]:bg-[var(--color-background)] [&_select]:px-2 [&_select]:py-1.5 [&_select]:text-sm [&_select]:text-[var(--color-text)]">{children}</span></label>;
}
