"use client";

/**
 * The 52px primary Knowledge Map toolbar (charter §10 "Graph workspace
 * layout", spec §1.1's `KnowledgeMapToolbar.tsx` row). Contains ONLY:
 * context/breadcrumb, search, `3D / 2D / List`, Focus neighborhood, Fit,
 * Home, Filters, Help — everything else (Arrange, orientation presets,
 * diagnostics, export) lives in the secondary "More" menu this component
 * owns, per the charter's explicit "put ... in secondary menus" instruction
 * — this directly replaces the baseline's >13-flat-control toolbar defect.
 */
import { useId, useRef, useState } from "react";
import type { GraphViewMode, OmittedEntry } from "@ice/graph-display";
import { useDialogEscape } from "@/components/primitives/useDialogEscape";
import type { OrientationPreset } from "./useKnowledgeMapCamera";

const VIEW_LABEL: Record<GraphViewMode, string> = { "3d": "3D", "2d": "2D", list: "List" };
const VIEW_MODES: GraphViewMode[] = ["3d", "2d", "list"];

export interface DiagnosticsSummary {
  structuralIssueCount: number;
  adapterIssueCount: number;
  omitted: OmittedEntry[];
}

export interface KnowledgeMapToolbarProps {
  contextLabel: string;
  breadcrumb?: string;
  onOpenContextChooser: () => void;

  searchValue: string;
  onSearchChange: (value: string) => void;

  view: GraphViewMode;
  onViewChange: (view: GraphViewMode) => void;

  onFocus: () => void;
  focusDisabled?: boolean;
  onFit: () => void;
  fitDisabled?: boolean;
  onHome: () => void;
  homeDisabled?: boolean;

  filtersOpen: boolean;
  onToggleFilters: () => void;
  activeFilterCount: number;

  onOpenHelp: () => void;

  arrangeMode: boolean;
  onToggleArrangeMode: () => void;
  onResetLayout: () => void;
  onOrientationPreset: (preset: OrientationPreset) => void;
  diagnostics: DiagnosticsSummary;
}

export function KnowledgeMapToolbar({
  contextLabel,
  breadcrumb,
  onOpenContextChooser,
  searchValue,
  onSearchChange,
  view,
  onViewChange,
  onFocus,
  focusDisabled,
  onFit,
  fitDisabled,
  onHome,
  homeDisabled,
  filtersOpen,
  onToggleFilters,
  activeFilterCount,
  onOpenHelp,
  arrangeMode,
  onToggleArrangeMode,
  onResetLayout,
  onOrientationPreset,
  diagnostics,
}: KnowledgeMapToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreMenuId = useId();
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  useDialogEscape(moreOpen, () => {
    setMoreOpen(false);
    moreButtonRef.current?.focus();
  });

  const diagnosticsTotal = diagnostics.structuralIssueCount + diagnostics.adapterIssueCount + diagnostics.omitted.length;

  return (
    <div
      role="toolbar"
      aria-label="Knowledge Map"
      data-testid="knowledge-map-toolbar"
      className="flex h-[52px] min-h-[52px] items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 text-sm"
    >
      <button
        type="button"
        onClick={onOpenContextChooser}
        className="app-control flex min-w-0 flex-col items-start rounded px-2 py-1 text-left hover:bg-[var(--color-surface-hover)]"
        aria-label={`Current context: ${contextLabel}. Open context chooser.`}
      >
        <span className="max-w-[16rem] truncate font-medium text-[var(--color-text)]">{contextLabel}</span>
        {breadcrumb && <span className="max-w-[16rem] truncate text-xs text-[var(--color-text-muted)]">{breadcrumb}</span>}
      </button>

      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="sr-only">Search this context</span>
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="app-control w-full min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1 text-sm"
        />
      </label>

      <div role="group" aria-label="View" className="flex items-center gap-1 rounded border border-[var(--color-border)] p-0.5">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onViewChange(mode)}
            aria-pressed={view === mode}
            className={`app-control rounded px-2 py-1 text-xs font-medium ${view === mode ? "bg-[var(--color-highlight)] text-[var(--color-accent-ink)]" : "text-[var(--color-text-muted)]"}`}
          >
            {VIEW_LABEL[mode]}
          </button>
        ))}
      </div>

      <button type="button" onClick={onFocus} disabled={focusDisabled} className="app-control rounded px-2 py-1 text-xs disabled:opacity-40">
        Focus
      </button>
      <button type="button" onClick={onFit} disabled={fitDisabled} className="app-control rounded px-2 py-1 text-xs disabled:opacity-40">
        Fit
      </button>
      <button type="button" onClick={onHome} disabled={homeDisabled} className="app-control rounded px-2 py-1 text-xs disabled:opacity-40">
        Home
      </button>

      <button
        type="button"
        onClick={onToggleFilters}
        aria-pressed={filtersOpen}
        className={`app-control rounded px-2 py-1 text-xs ${filtersOpen ? "bg-[var(--color-highlight)] text-[var(--color-accent-ink)]" : ""}`}
      >
        Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
      </button>

      <div className="relative">
        <button
          ref={moreButtonRef}
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-controls={moreMenuId}
          className="app-control rounded px-2 py-1 text-xs"
        >
          More…
        </button>
        {moreOpen && (
          <div
            id={moreMenuId}
            role="menu"
            aria-label="Arrange, orientation, and diagnostics"
            className="app-reveal absolute right-0 top-full z-20 mt-1 w-64 rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 shadow-lg"
          >
            <div className="border-b border-[var(--color-border)] pb-2">
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={arrangeMode}
                onClick={onToggleArrangeMode}
                className="app-control block w-full rounded px-2 py-1 text-left text-xs"
              >
                {arrangeMode ? "Exit Arrange mode" : "Arrange mode"}
              </button>
              {arrangeMode && (
                <button type="button" role="menuitem" onClick={onResetLayout} className="app-control block w-full rounded px-2 py-1 text-left text-xs text-[var(--color-text-muted)]">
                  Reset layout
                </button>
              )}
            </div>

            <div role="group" aria-label="Orientation" className="border-b border-[var(--color-border)] py-2">
              {(["front", "side", "top"] as OrientationPreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="menuitem"
                  onClick={() => onOrientationPreset(preset)}
                  className="app-control block w-full rounded px-2 py-1 text-left text-xs capitalize"
                >
                  {preset} view
                </button>
              ))}
            </div>

            <div className="py-2 text-xs text-[var(--color-text-muted)]">
              <p className="px-2 font-medium text-[var(--color-text)]">Diagnostics</p>
              <p className="px-2">
                {diagnosticsTotal === 0
                  ? "No structural issues detected."
                  : `${diagnostics.structuralIssueCount} structural, ${diagnostics.adapterIssueCount} classification, ${diagnostics.omitted.length} URL-state issue(s) — all dropped safely, never crashed.`}
              </p>
            </div>

            <div className="pt-2 text-xs text-[var(--color-text-muted)]">
              <p className="px-2">Export isn&rsquo;t available in this workspace yet.</p>
            </div>
          </div>
        )}
      </div>

      <button type="button" onClick={onOpenHelp} className="app-control rounded px-2 py-1 text-xs" aria-label="Help">
        Help
      </button>
    </div>
  );
}
