"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { ReaderLevel } from "@ice/roadmap";
import { InitialsAvatar } from "@/components/charts";
import { PreferencesMenu } from "@/components/app/PreferencesMenu";
import { ProfileMenu } from "@/components/app/ProfileMenu";
import { useWorkspacePreferences } from "@/components/app/WorkspacePreferencesProvider";
import { useSecondaryPanel } from "@/components/primitives/useSecondaryPanel";
import { SoundToggle } from "@/components/site/SoundToggle";
import { useOutsideMenuClose } from "@/hooks/useOutsideMenuClose";
import { useReopenGuard } from "@/hooks/useReopenGuard";
import { useContextBarState } from "./ContextBarProvider";
import { buildWorkspaceNavItems, isNavItemActive, isReadSectionActive } from "./navItems";
import { ReadManagementSheet } from "./ReadManagementSheet";
import { UploadAction } from "./UploadAction";

/** Global stable id — exactly one `GlobalRagSidebar` is ever mounted at a
 * time, so a fixed id (rather than `useId()`) is enough to link the
 * trigger's `aria-controls` to it without lifting id state up to
 * `AppShellRoot`. */
const RAG_SIDEBAR_ID = "global-rag-sidebar";

export function ContextBar({
  userId,
  email,
  name,
  image,
  admin,
  ragEnabled,
  writerEnabled,
  researchEnabled,
  readerLevel,
  onReaderLevelChange,
  onFocusModeChange,
  immersive,
  focusMode,
  ragTriggerRef,
}: {
  userId: string;
  email: string | null | undefined;
  name: string | null | undefined;
  image: string | null | undefined;
  admin: boolean;
  ragEnabled: boolean;
  writerEnabled: boolean;
  researchEnabled: boolean;
  readerLevel: ReaderLevel | null;
  onReaderLevelChange: (level: ReaderLevel) => void;
  onFocusModeChange: (enabled: boolean) => void;
  immersive: boolean;
  /** Focus mode hides the ENTIRE shell chrome (charter's pre-existing
   *  behavior, unchanged by Stage 1) — the `<header>` stays mounted
   *  (`inert` + `sr-only`, matching the pre-Stage-1 `AppShell.tsx` exactly)
   *  rather than unmounting, since `workspace-shell.spec.ts` asserts on the
   *  `banner` landmark's `inert` attribute while focus mode is active. */
  focusMode: boolean;
  /** Owned by `AppShellRoot`, not this component — `GlobalRagSidebar` is
   *  mounted at the `AppShellRoot` level (a shell-root sibling, not a
   *  ContextBar child), so its own `onClose` needs the SAME ref this
   *  component's trigger button sets in order to restore focus on a
   *  dialog-initiated close (Escape, its own close button) — not just a
   *  trigger-button-initiated one. See `AppShellRoot.tsx`'s own comment. */
  ragTriggerRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const pathname = usePathname();
  const { preferences, updatePreferences } = useWorkspacePreferences();
  const { title } = useContextBarState();
  const [compact, setCompact] = useState(false);
  const preferencesPanel = useSecondaryPanel("preferences");
  const profilePanel = useSecondaryPanel("profile");
  const ragPanel = useSecondaryPanel("rag");
  const ragReopenGuard = useReopenGuard(450);
  const preferencesTriggerRef = useRef<HTMLButtonElement>(null);
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const preferencesContainerRef = useRef<HTMLDivElement>(null);
  const profileContainerRef = useRef<HTMLDivElement>(null);
  const preferencesMenuId = useId();
  const profileMenuId = useId();
  const previousFocusModeRef = useRef(focusMode);

  useEffect(() => {
    const update = () => setCompact(window.scrollY > 18);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  // Mirror image of `AppShellRoot`'s "entering focus mode" effect: exiting
  // focus mode returns focus to the preferences trigger (matching the
  // pre-Stage-1 `AppShell.tsx` exactly) — see that file's comment for why
  // this is split into two independent, transition-detecting effects rather
  // than one ref shared across components.
  useEffect(() => {
    if (!focusMode && previousFocusModeRef.current) {
      window.requestAnimationFrame(() => preferencesTriggerRef.current?.focus());
    }
    previousFocusModeRef.current = focusMode;
  }, [focusMode]);

  function closePreferences() {
    preferencesPanel.close();
    window.requestAnimationFrame(() => preferencesTriggerRef.current?.focus());
  }
  function closePreferencesFromOutside() {
    preferencesPanel.close();
  }
  function closeProfile() {
    profilePanel.close();
    window.requestAnimationFrame(() => profileTriggerRef.current?.focus());
  }
  function closeProfileFromOutside() {
    profilePanel.close();
  }
  function closeRag() {
    ragPanel.close();
    window.requestAnimationFrame(() => ragTriggerRef.current?.focus());
  }

  useOutsideMenuClose(preferencesPanel.isOpen, closePreferencesFromOutside, preferencesContainerRef);
  useOutsideMenuClose(profilePanel.isOpen, closeProfileFromOutside, profileContainerRef);

  const navItems = buildWorkspaceNavItems({ writerEnabled, researchEnabled });
  const fallbackTitle = navItems.find((item) => (item.key === "read" ? isReadSectionActive(pathname) : isNavItemActive(pathname, item.href)))?.label ?? "Palimnote";
  const showReadManagement = isReadSectionActive(pathname);

  return (
    <header
      inert={focusMode || undefined}
      data-immersive={immersive}
      className={focusMode ? "sr-only" : `app-shell-context-bar sticky top-0 z-30 w-full min-w-0 overflow-x-clip border-b border-[var(--color-border)] ${compact ? "header-compact" : ""}`}
    >
      {/* Same underlay-sibling technique as the pre-Stage-1 header (D-25-12):
          the blur lives on this non-ancestor `div`, never on `<header>`
          itself, so no positioned descendant (the preferences/account
          panels below) is ever clipped by a `backdrop-filter` ancestor in
          Safari. */}
      <div aria-hidden="true" className="context-bar-underlay pointer-events-none absolute inset-0 z-0 backdrop-blur" />
      <div className="app-shell-context-bar-content relative z-10 mx-auto flex w-full min-w-0 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {showReadManagement && (
            <span className="md:hidden">
              <ReadManagementSheet />
            </span>
          )}
          <span className="truncate font-serif text-base font-semibold text-[var(--color-text)]">{title ?? fallbackTitle}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="md:hidden"><UploadAction collapsed /></span>
          <Link href="/graph" data-sound="click" className="app-control app-icon-button hidden md:inline-flex" data-tooltip="Knowledge Map" aria-label="Knowledge Map">◈</Link>
          <SoundToggle enabled={preferences.soundEnabled} onChange={(soundEnabled) => updatePreferences({ soundEnabled })} />
          <button type="button" className="app-control app-icon-button hidden sm:inline-flex" data-tooltip="Search pages and works (⌘K)" aria-label="Search pages and works" onClick={(event) => window.dispatchEvent(new CustomEvent("palimnote:open-command-palette", { detail: event.currentTarget }))}>⌕</button>
          <div className="hidden items-center rounded-md border border-[var(--color-border)] p-0.5 sm:flex" aria-label="Quick light or dark switch">
            <button type="button" className={`app-control min-h-11 min-w-11 rounded px-2 py-1 text-xs ${preferences.theme === "light" ? "bg-[var(--color-surface)] font-medium" : "text-[var(--color-text-muted)]"}`} aria-pressed={preferences.theme === "light"} onClick={() => updatePreferences({ theme: "light" })}>Light</button>
            <button type="button" className={`app-control min-h-11 min-w-11 rounded px-2 py-1 text-xs ${preferences.theme === "dark" ? "bg-[var(--color-surface)] font-medium" : "text-[var(--color-text-muted)]"}`} aria-pressed={preferences.theme === "dark"} onClick={() => updatePreferences({ theme: "dark" })}>Dark</button>
          </div>
          <div className="relative" ref={preferencesContainerRef}>
            <button ref={preferencesTriggerRef} type="button" className="app-control app-icon-button" data-tooltip="Workspace preferences" aria-label="Workspace preferences" aria-expanded={preferencesPanel.isOpen} aria-controls={preferencesMenuId} onClick={(event) => { if (preferencesPanel.isOpen) { if (event.detail === 0) closePreferences(); return; } preferencesPanel.open(); }}>⚙</button>
            {preferencesPanel.isOpen && <PreferencesMenu id={preferencesMenuId} preferences={preferences} onUpdate={updatePreferences} onFocusModeChange={onFocusModeChange} readerLevel={readerLevel} onReaderLevelChange={onReaderLevelChange} onClose={closePreferences} />}
          </div>
          {ragEnabled && (
            <button
              ref={ragTriggerRef}
              type="button"
              className="app-control app-icon-button"
              data-tooltip="Library chat sidebar"
              aria-label="Library chat sidebar"
              aria-expanded={ragPanel.isOpen}
              aria-controls={RAG_SIDEBAR_ID}
              onClick={() => { if (ragPanel.isOpen) { if (ragReopenGuard.shouldIgnoreClose()) return; closeRag(); } else { ragPanel.open(); ragReopenGuard.markOpened(); } }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <rect x="1.5" y="2.5" width="13" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
                <path d="M4 11.5 L4 14 L7 11.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <text x="8" y="9.2" fontFamily="Georgia, serif" fontSize="7.5" textAnchor="middle" fill="currentColor">§</text>
              </svg>
            </button>
          )}
          <div className="relative" ref={profileContainerRef}>
            <button
              ref={profileTriggerRef}
              type="button"
              className="app-control app-icon-button p-0"
              data-tooltip="Account menu"
              aria-label="Account menu"
              aria-expanded={profilePanel.isOpen}
              aria-controls={profileMenuId}
              onClick={(event) => { if (profilePanel.isOpen) { if (event.detail === 0) closeProfile(); return; } profilePanel.open(); }}
            >
              <InitialsAvatar userId={userId} name={name} imageSrc={image} size={30} />
            </button>
            {profilePanel.isOpen && <ProfileMenu id={profileMenuId} userId={userId} name={name} email={email} image={image} admin={admin} onClose={closeProfile} />}
          </div>
        </div>
      </div>
    </header>
  );
}

export { RAG_SIDEBAR_ID };
