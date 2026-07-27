"use client";

import { useEffect, useRef } from "react";
import { READER_LEVELS, type ReaderLevel } from "@ice/roadmap";
import type { WorkspacePreferences } from "@/lib/workspacePreferences";

const READER_LEVEL_LABEL: Record<ReaderLevel, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
};

/**
 * Extracted verbatim from the pre-Stage-1 `AppShell.tsx` (redesign-shell-
 * spec.md §2.2 — "Existing files that move/adapt rather than get deleted
 * outright") so `ContextBar.tsx` can render it from one anchor point at
 * every viewport, with no behavior change: same fields, same Escape
 * handling, same focus-on-open.
 */
export function PreferencesMenu({
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
