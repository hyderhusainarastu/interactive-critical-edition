"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ReaderLevel } from "@ice/roadmap";
import { AppFooter } from "@/components/app/AppFooter";
import { CommandPalette } from "@/components/app/CommandPalette";
import { GlobalRagSidebar } from "@/components/app/GlobalRagSidebar";
import { useToast } from "@/components/app/ToastProvider";
import { useWorkspacePreferences } from "@/components/app/WorkspacePreferencesProvider";
import { useFocusRestoration } from "@/components/primitives/useFocusRestoration";
import { SecondaryPanelProvider, useSecondaryPanel } from "@/components/primitives/useSecondaryPanel";
import { PageTransition } from "@/components/shared/PageTransition";
import { ContextBar, RAG_SIDEBAR_ID } from "./ContextBar";
import { ContextBarProvider } from "./ContextBarProvider";
import { isImmersiveRoute } from "./immersive";
import { MobileBottomNav } from "./MobileBottomNav";
import { buildCommandPaletteNavItems } from "./navItems";
import { WorkspaceRail } from "./WorkspaceRail";

/** Matches only a real (UUID-shaped) work id segment, e.g. `/works/<id>` or
 * `/works/<id>/roadmap` — deliberately excludes non-id siblings like
 * `/works/trash` and the bare `/works` listing, which have no "current
 * work" for the global RAG sidebar to scope to. Unchanged from the
 * pre-Stage-1 `AppShell.tsx`. */
const WORK_ROUTE_PATTERN = /^\/works\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

interface AppShellRootProps {
  userId: string;
  email: string | null | undefined;
  name: string | null | undefined;
  image: string | null | undefined;
  admin: boolean;
  writerEnabled: boolean;
  ragEnabled: boolean;
  researchEnabled: boolean;
  askResearchModesEnabled: boolean;
  initialReaderLevel: ReaderLevel | null;
  children: React.ReactNode;
}

/**
 * Composition root for the redesigned shell (redesign-shell-spec.md §2.2/
 * §2.3). Replaces the pre-Stage-1 `AppShellContents` — every piece of its
 * behavior is accounted for in the spec's own "behavior-preservation
 * ledger" (§2.2), redistributed across `WorkspaceRail`/`ContextBar`/
 * `MobileBottomNav` rather than dropped.
 */
export function AppShellRoot(props: AppShellRootProps) {
  return (
    <SecondaryPanelProvider>
      <ContextBarProvider>
        <AppShellLayout {...props} />
      </ContextBarProvider>
    </SecondaryPanelProvider>
  );
}

function AppShellLayout({
  userId,
  email,
  name,
  image,
  admin,
  writerEnabled,
  ragEnabled,
  researchEnabled,
  askResearchModesEnabled,
  initialReaderLevel,
  children,
}: AppShellRootProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const { preferences, updatePreferences } = useWorkspacePreferences();
  const ragPanel = useSecondaryPanel("rag");
  const [readerLevel, setReaderLevel] = useState<ReaderLevel | null>(initialReaderLevel);
  const focusModeExitRef = useRef<HTMLButtonElement>(null);
  // Owned here, not inside `ContextBar`: `GlobalRagSidebar` is mounted as a
  // sibling of `ContextBar` at THIS level, so a dialog-initiated close
  // (Escape, its own close button — anything other than re-clicking the
  // trigger button, which `ContextBar` already restores focus for itself)
  // needs this same ref to restore focus, or the "Library chat sidebar"
  // trigger is silently left unfocused. Passed down into `ContextBar` so
  // there is exactly one ref, not two independently-created ones.
  const ragTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreRagFocus = useFocusRestoration(ragTriggerRef);

  const focusMode = preferences.focusMode;
  const immersive = isImmersiveRoute(pathname);
  const routeWorkId = WORK_ROUTE_PATTERN.exec(pathname)?.[1] ?? null;

  // Entering focus mode moves focus to the Exit control — split from the
  // pre-Stage-1 single `focusModeFocusRequestRef` (which also handled the
  // "exiting" direction) because that ref's OTHER target, the preferences
  // trigger, now lives inside `ContextBar` rather than this component;
  // `ContextBar` runs the mirror-image effect for the "exiting" direction
  // itself. Each effect only reacts to its own transition, keyed off the
  // previous render's value, so the two stay independent without needing a
  // ref shared across components.
  const previousFocusModeRef = useRef(focusMode);
  useEffect(() => {
    if (focusMode && !previousFocusModeRef.current) {
      window.requestAnimationFrame(() => focusModeExitRef.current?.focus());
    }
    previousFocusModeRef.current = focusMode;
  }, [focusMode]);

  function setFocusMode(enabled: boolean) {
    updatePreferences({ focusMode: enabled });
  }

  // Distinct from `updatePreferences` above: this is the explicit,
  // account-level `users.readerLevel` (POST /api/reader-level), not a
  // local-storage-synced workspace preference. `router.refresh()` re-runs
  // every page's server component so pages seeded from `getUserReaderLevel()`
  // pick up the new default on their next render.
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

  const paletteItems = buildCommandPaletteNavItems({ writerEnabled, researchEnabled, ragEnabled, admin });

  return (
    <div className="app-shell flex min-h-full min-w-0 overflow-x-clip" data-immersive={immersive} data-focus-mode={focusMode}>
      {focusMode && (
        <button ref={focusModeExitRef} type="button" className="app-control fixed right-4 top-4 z-40 rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm shadow-md" onClick={() => setFocusMode(false)}>
          Exit focus mode
        </button>
      )}
      {!focusMode && <WorkspaceRail writerEnabled={writerEnabled} researchEnabled={researchEnabled} immersive={immersive} />}
      <div className="app-shell-content-column flex min-h-full min-w-0 flex-1 flex-col overflow-x-clip">
        <ContextBar
          userId={userId}
          email={email}
          name={name}
          image={image}
          admin={admin}
          ragEnabled={ragEnabled}
          writerEnabled={writerEnabled}
          researchEnabled={researchEnabled}
          readerLevel={readerLevel}
          onReaderLevelChange={updateReaderLevel}
          onFocusModeChange={setFocusMode}
          immersive={immersive}
          focusMode={focusMode}
          ragTriggerRef={ragTriggerRef}
        />
        {/* `PageTransition` wraps ONLY routed content, not any persistent
            chrome above/below it — see `PageTransition.tsx`'s own comment
            for the production incident (menus opening then instantly
            closing) this avoids. */}
        <main id="main-content" className="app-shell-main flex-1">
          <PageTransition>{children}</PageTransition>
        </main>
        {!immersive && <AppFooter />}
      </div>
      {!focusMode && <MobileBottomNav writerEnabled={writerEnabled} researchEnabled={researchEnabled} />}
      <CommandPalette items={paletteItems} />
      {ragEnabled && ragPanel.isOpen && (
        <GlobalRagSidebar
          id={RAG_SIDEBAR_ID}
          contextWorkId={routeWorkId}
          onClose={() => {
            ragPanel.close();
            restoreRagFocus();
          }}
          enableResearchModes={askResearchModesEnabled}
        />
      )}
    </div>
  );
}
