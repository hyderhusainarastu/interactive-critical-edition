"use client";

import Link from "next/link";
import type { EvidenceClaim, EvidenceView, ResearchProjectOption, WriterSource } from "../writerTypes";
import { WriterPanelSheet } from "./WriterPanelSheet";

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 460;

export type CitationImportKind = "doi" | "isbn" | "title" | "bibtex" | "ris";

/**
 * Stage 6 layout spec §2.4/§5.1/§8: the extracted "Sources and evidence
 * panel" (renamed from "Library source sidebar" — the aside already
 * contained both the Library-sources list and the flag-gated
 * Research-evidence sub-section, just not in name). Every handler/JSX below
 * is unchanged from the pre-Stage-6 `WriterEditor.tsx` — this is a pure
 * container change (inline `<aside>` on wide viewports, the shared
 * `WriterPanelSheet` on narrow ones), not a behavior change.
 */
export function SourcesEvidencePanel({
  mode,
  open,
  onCloseSheet,
  triggerRef,
  panelId,
  sidebarWidth,
  onResizeStart,
  onResizeKeyDown,
  sources,
  onCite,
  importKind,
  onImportKindChange,
  importValue,
  onImportValueChange,
  onAddCitation,
  evidenceEnabled,
  researchLink,
  researchOptions,
  selectedResearchProjectId,
  onSelectedResearchProjectIdChange,
  onLinkResearchProject,
  linkingResearch,
  onUnlinkResearchProject,
  evidence,
  evidenceWorkFilter,
  onEvidenceWorkFilterChange,
  evidenceNatureFilter,
  onEvidenceNatureFilterChange,
  insertingClaimId,
  onInsertEvidence,
}: {
  mode: "inline" | "sheet";
  open: boolean;
  onCloseSheet: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  /** Links the toolbar toggle button's `aria-controls` to whichever variant
   *  actually renders (the inline `<aside>`'s own `id`, or the sheet
   *  dialog's `id` — same value either way, so the toggle button never
   *  needs to know which mode is active). */
  panelId: string;
  sidebarWidth: number;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  sources: WriterSource[];
  onCite: (resourceId: string) => void;
  importKind: CitationImportKind;
  onImportKindChange: (kind: CitationImportKind) => void;
  importValue: string;
  onImportValueChange: (value: string) => void;
  onAddCitation: () => void;
  evidenceEnabled: boolean;
  researchLink: ResearchProjectOption | null;
  researchOptions: ResearchProjectOption[];
  selectedResearchProjectId: string;
  onSelectedResearchProjectIdChange: (value: string) => void;
  onLinkResearchProject: () => void;
  linkingResearch: boolean;
  onUnlinkResearchProject: () => void;
  evidence: EvidenceView | null;
  evidenceWorkFilter: string;
  onEvidenceWorkFilterChange: (value: string) => void;
  evidenceNatureFilter: string;
  onEvidenceNatureFilterChange: (value: string) => void;
  insertingClaimId: string | null;
  onInsertEvidence: (claim: EvidenceClaim) => void;
}) {
  const label = "Sources and evidence panel";

  const content = (
    <>
      <h2 className="font-medium">Library sources</h2>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">Only sources connected to your own uploaded works appear here.</p>
      <ul className="app-reveal-stagger mt-3 max-h-52 space-y-2 overflow-auto">
        {sources.map((source) => (
          <li key={source.id} className="app-card app-lift app-mount rounded p-2 text-sm">
            <strong className="block">{source.title}</strong>
            <span className="block text-xs text-[var(--color-text-muted)]">for {source.workTitle}</span>
            <div className="mt-1 flex gap-2">
              <button type="button" className="app-control app-press underline" onClick={() => onCite(source.id)}>
                Cite
              </button>
              <Link className="app-control app-press underline" href={`/works/${source.workId}/reader`}>
                Read
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-5 border-t border-[var(--color-border)] pt-3">
        <h3 className="text-sm font-medium">Add citation</h3>
        <div className="mt-2 flex gap-1">
          <select aria-label="Citation import format" className="app-control" value={importKind} onChange={(event) => onImportKindChange(event.target.value as CitationImportKind)}>
            <option value="doi">DOI</option>
            <option value="isbn">ISBN</option>
            <option value="title">Title</option>
            <option value="bibtex">BibTeX</option>
            <option value="ris">RIS</option>
          </select>
          <button type="button" className="app-control rounded border px-2 text-sm" onClick={onAddCitation}>
            Add
          </button>
        </div>
        <textarea
          aria-label="Citation metadata"
          value={importValue}
          onChange={(event) => onImportValueChange(event.target.value)}
          className="app-control mt-2 min-h-20 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm"
          placeholder="DOI, ISBN, title, BibTeX, or RIS"
        />
      </div>
      {evidenceEnabled && (
        <section className="mt-5 border-t border-[var(--color-border)] pt-3" aria-label="Research evidence">
          <h3 className="text-sm font-medium">Research evidence</h3>
          {!researchLink ? (
            <div className="mt-2">
              <p className="text-xs text-[var(--color-text-muted)]">Link a research project to bring in its claims, debates, and evidence chambers.</p>
              {researchOptions.length ? (
                <div className="mt-2 flex gap-1">
                  <label htmlFor="research-link-select" className="sr-only">
                    Research project to link
                  </label>
                  {/* `min-w-0` is load-bearing, not decorative — see the
                      original comment in `WriterEditor.tsx`'s pre-Stage-6
                      history: a plain `<select>` sizes itself to its
                      selected option's text, and without `min-w-0` a long
                      research-project title can push the sibling "Link"
                      button outside this fixed-width panel's flex row. */}
                  <select id="research-link-select" aria-label="Research project to link" className="app-control min-w-0 flex-1" value={selectedResearchProjectId} onChange={(event) => onSelectedResearchProjectIdChange(event.target.value)}>
                    <option value="">Select a research project…</option>
                    {researchOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="app-control app-press shrink-0 rounded border px-2 text-sm disabled:opacity-50" onClick={onLinkResearchProject} disabled={!selectedResearchProjectId || linkingResearch}>
                    {linkingResearch ? "Linking…" : "Link"}
                  </button>
                </div>
              ) : (
                <p className="app-empty mt-2 rounded p-2 text-xs text-[var(--color-text-muted)]">No research projects yet. Create one in the Research workspace first.</p>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>
                  Linked: <strong>{researchLink.title}</strong>
                </span>
                <button type="button" className="app-control app-press text-xs underline" onClick={onUnlinkResearchProject}>
                  Unlink
                </button>
              </div>
              {evidence && (
                <>
                  <div className="mt-2 flex gap-1">
                    <label htmlFor="evidence-work-filter" className="sr-only">
                      Filter evidence by work
                    </label>
                    <select id="evidence-work-filter" aria-label="Filter evidence by work" className="app-control min-w-0 flex-1 text-xs" value={evidenceWorkFilter} onChange={(event) => onEvidenceWorkFilterChange(event.target.value)}>
                      <option value="">All works</option>
                      {[...new Map(evidence.claims.filter((claim) => claim.workId).map((claim) => [claim.workId as string, claim.workTitle ?? "Untitled work"])).entries()].map(([workId, workTitle]) => (
                        <option key={workId} value={workId}>
                          {workTitle}
                        </option>
                      ))}
                    </select>
                    <label htmlFor="evidence-nature-filter" className="sr-only">
                      Filter evidence by claim nature
                    </label>
                    <select id="evidence-nature-filter" aria-label="Filter evidence by claim nature" className="app-control min-w-0 flex-1 text-xs" value={evidenceNatureFilter} onChange={(event) => onEvidenceNatureFilterChange(event.target.value)}>
                      <option value="">All natures</option>
                      {[...new Set(evidence.claims.map((claim) => claim.claimNature))].map((nature) => (
                        <option key={nature} value={nature}>
                          {nature}
                        </option>
                      ))}
                    </select>
                  </div>
                  <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Claims</h4>
                  <ul className="app-reveal-stagger mt-1 max-h-64 space-y-2 overflow-auto">
                    {evidence.claims.map((claim) => (
                      <li key={claim.id} className="app-card app-mount rounded p-2 text-sm">
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {claim.workTitle ?? "Untitled source"} · {claim.claimNature} · {claim.verificationStatus}
                          {claim.anchorState === "unanchored" ? " · unanchored" : ""}
                        </p>
                        <p className="mt-1">“{claim.supportingExcerpt}”</p>
                        <button type="button" className="app-control app-press mt-1 rounded border px-2 py-1 text-xs disabled:opacity-50" onClick={() => onInsertEvidence(claim)} disabled={insertingClaimId === claim.id}>
                          {insertingClaimId === claim.id ? "Inserting…" : "Insert"}
                        </button>
                      </li>
                    ))}
                    {!evidence.claims.length && <li className="app-empty rounded p-2 text-xs text-[var(--color-text-muted)]">No claims match the current filters.</li>}
                  </ul>
                  <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Debates</h4>
                  <ul className="mt-1 space-y-1 text-xs">
                    {evidence.debateClusters.map((cluster) => (
                      <li key={cluster.id}>
                        <Link className="underline" href={`/research/${researchLink.id}/debates/${cluster.id}`}>
                          {cluster.name}
                        </Link>
                      </li>
                    ))}
                    {!evidence.debateClusters.length && <li className="text-[var(--color-text-muted)]">No debates yet.</li>}
                  </ul>
                  <h4 className="mt-3 text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Evidence chambers</h4>
                  <ul className="mt-1 space-y-1 text-xs">
                    {evidence.chambers.map((chamber) => (
                      <li key={chamber.id}>
                        <Link className="underline" href={`/research/chambers/${chamber.id}`}>
                          {chamber.question}
                        </Link>
                      </li>
                    ))}
                    {!evidence.chambers.length && <li className="text-[var(--color-text-muted)]">No evidence chambers yet.</li>}
                  </ul>
                </>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );

  if (mode === "sheet") {
    return (
      <WriterPanelSheet open={open} onClose={onCloseSheet} triggerRef={triggerRef} label={label} id={panelId}>
        {content}
      </WriterPanelSheet>
    );
  }

  if (!open) return null;

  return (
    <aside
      id={panelId}
      className="relative shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:border-b-0 lg:border-r"
      style={{ width: `${sidebarWidth}px` }}
      aria-label={label}
    >
      {content}
      <div
        role="separator"
        aria-label="Resize Sources and evidence panel"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={MAX_SIDEBAR_WIDTH}
        aria-valuenow={sidebarWidth}
        aria-valuetext={`${sidebarWidth} pixels wide`}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
        className="absolute right-0 top-0 hidden h-full w-2 cursor-col-resize lg:block focus-visible:bg-[var(--color-accent-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-ink)]"
      />
    </aside>
  );
}
