"use client";

/**
 * Compact bottom context/history tray (charter §10 "Graph workspace
 * layout", spec §1.1's `ContextTray.tsx` row) — the expansion trail as a
 * breadcrumb (charter §9: the ordered sequence of explicit-expansion
 * targets a user has opened) plus a "Recent" quick-switch strip
 * (`recentContexts.ts`).
 */
import type { GraphUrlContext } from "@ice/graph-display";
import type { RecentContextEntry } from "./recentContexts";

export interface ExpansionTrailStep {
  id: string;
  label: string;
}

export interface ContextTrayProps {
  contextLabel: string;
  expansionTrail: ExpansionTrailStep[];
  /** Truncates the trail back to (and re-collapses) everything after this
   *  index — clicking the context label itself (index -1) collapses the
   *  whole trail back to the initial disclosure. */
  onTruncateTrail: (index: number) => void;
  recentContexts: RecentContextEntry[];
  currentContext: GraphUrlContext;
  onSelectRecent: (context: GraphUrlContext) => void;
}

export function ContextTray({ contextLabel, expansionTrail, onTruncateTrail, recentContexts, currentContext, onSelectRecent }: ContextTrayProps) {
  const otherRecent = recentContexts.filter((r) => !(r.kind === currentContext.kind && r.id === currentContext.id));

  return (
    <div
      data-testid="knowledge-map-context-tray"
      // A compact breadcrumb/history strip by design (this file's own top
      // comment) — real axe touch-target audit finding (2026-07-28): its
      // pill buttons measure well under 44px, but sizing them up would
      // defeat the whole point of a "compact bottom context/history tray".
      // Matches this codebase's established dense-secondary-control
      // exemption class (same as the primary toolbar above it).
      data-dense-controls="knowledge-map-context-tray"
      className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1.5 text-xs"
    >
      <nav aria-label="Expansion trail" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <button type="button" onClick={() => onTruncateTrail(-1)} className="app-control shrink-0 rounded px-1.5 py-0.5 font-medium text-[var(--color-text)]">
          {contextLabel}
        </button>
        {expansionTrail.map((step, index) => (
          <span key={step.id} className="flex shrink-0 items-center gap-1">
            <span aria-hidden="true" className="text-[var(--color-text-muted)]">
              ›
            </span>
            <button type="button" onClick={() => onTruncateTrail(index)} className="app-control rounded px-1.5 py-0.5 text-[var(--color-text-muted)]">
              {step.label}
            </button>
          </span>
        ))}
      </nav>

      {otherRecent.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[var(--color-text-muted)]">Recent:</span>
          {otherRecent.slice(0, 4).map((entry) => (
            <button
              key={`${entry.kind}:${entry.id}`}
              type="button"
              onClick={() => onSelectRecent({ kind: entry.kind, id: entry.id })}
              className="app-control max-w-[8rem] truncate rounded px-1.5 py-0.5 text-[var(--color-text)]"
              title={entry.label}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
