"use client";

import type { ReaderLevel } from "@ice/roadmap";
import type { WorkspacePreferences } from "@/lib/workspacePreferences";
import { AppShellRoot } from "@/components/shell/AppShellRoot";
import { ToastProvider } from "./ToastProvider";
import { WorkspacePreferencesProvider } from "./WorkspacePreferencesProvider";

/**
 * Thin composition root (redesign-shell-spec.md §2.2): keeps the exact
 * exported name and prop signature the pre-Stage-1 component had, so
 * `apps/web/src/app/(app)/layout.tsx`'s call site needs zero changes. All
 * actual chrome now lives in `AppShellRoot` and its children
 * (`WorkspaceRail`/`ContextBar`/`MobileBottomNav`/etc., under
 * `apps/web/src/components/shell/`) — this file only wires the two
 * providers every one of them depends on.
 */
export function AppShell({
  userId,
  email,
  name,
  image,
  admin,
  writerEnabled,
  ragEnabled,
  researchEnabled,
  askResearchModesEnabled = false,
  initialPreferences,
  initialReaderLevel = null,
  children,
}: {
  userId: string;
  email: string | null | undefined;
  name: string | null | undefined;
  image: string | null | undefined;
  admin: boolean;
  writerEnabled: boolean;
  ragEnabled: boolean;
  researchEnabled: boolean;
  /** Phase 28.6: threaded down to the global `GlobalRagSidebar`/`RagChatPanel`
   *  instance — behind `askResearchModes` (plan §"Web surfaces (Ask Library)"). */
  askResearchModesEnabled?: boolean;
  initialPreferences: WorkspacePreferences;
  initialReaderLevel?: ReaderLevel | null;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <WorkspacePreferencesProvider initialPreferences={initialPreferences}>
        <AppShellRoot
          userId={userId}
          email={email}
          name={name}
          image={image}
          admin={admin}
          writerEnabled={writerEnabled}
          ragEnabled={ragEnabled}
          researchEnabled={researchEnabled}
          askResearchModesEnabled={askResearchModesEnabled}
          initialReaderLevel={initialReaderLevel}
        >
          {children}
        </AppShellRoot>
      </WorkspacePreferencesProvider>
    </ToastProvider>
  );
}
