"use client";

import { mlaWorksCited, sortMlaCitations, type CslJson } from "@/lib/writer";
import type { WriterRevision } from "../writerTypes";
import { WriterPanelSheet } from "./WriterPanelSheet";

export type CitationExportFormat = "bibtex" | "ris" | "apa" | "chicago";

function citationKey(citation: CslJson) {
  return citation.DOI ?? citation.ISBN ?? `${citation.title}-${citation.author?.[0]?.family ?? ""}`;
}

/**
 * Stage 6 layout spec §2.4/§5.1/§8: the extracted "Citations and revision
 * history panel" (renamed from "Citations and revision recovery" — content
 * and handlers unchanged from the pre-Stage-6 `WriterEditor.tsx`).
 */
export function CitationsHistoryPanel({
  mode,
  open,
  onCloseSheet,
  triggerRef,
  panelId,
  projectId,
  citationList,
  onInsertCitation,
  citationExportFormat,
  onCitationExportFormatChange,
  revisions,
  onRestore,
}: {
  mode: "inline" | "sheet";
  open: boolean;
  onCloseSheet: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  panelId: string;
  projectId: string;
  citationList: CslJson[];
  onInsertCitation: (citation: CslJson) => void;
  citationExportFormat: CitationExportFormat;
  onCitationExportFormatChange: (format: CitationExportFormat) => void;
  revisions: WriterRevision[];
  onRestore: (revisionId: string) => void;
}) {
  const label = "Citations and revision history panel";

  const content = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Citations</h2>
        <div className="flex items-center gap-1">
          <label htmlFor="citation-export-format" className="sr-only">
            Citation export format
          </label>
          <select id="citation-export-format" aria-label="Citation export format" className="app-control app-select text-xs" value={citationExportFormat} onChange={(event) => onCitationExportFormatChange(event.target.value as CitationExportFormat)}>
            <option value="bibtex">BibTeX</option>
            <option value="ris">RIS</option>
            <option value="apa">APA</option>
            <option value="chicago">Chicago</option>
          </select>
          <a className="app-control app-press rounded border border-[var(--color-border)] px-2 py-1 text-xs" href={`/api/writer/projects/${projectId}/citations/export?format=${citationExportFormat}`}>
            Export
          </a>
        </div>
      </div>
      <ul className="mt-2 space-y-3">
        {sortMlaCitations(citationList).map((citation, index) => (
          <li key={`${citationKey(citation)}-${index}`} className="text-sm">
            <button type="button" className="app-control mr-1 underline" onClick={() => onInsertCitation(citation)}>
              Insert
            </button>
            {mlaWorksCited(citation)}
          </li>
        ))}
        {!citationList.length && <li className="app-empty rounded p-2 text-xs text-[var(--color-text-muted)]">No citations yet. Import one from the panel on the left, or from a Library source.</li>}
      </ul>
      <h2 className="mt-6 font-medium">Revision recovery</h2>
      <ul className="mt-2 space-y-2 text-sm">
        {revisions.slice(0, 8).map((revision) => (
          <li key={revision.id} className="flex items-center justify-between gap-2">
            <span>
              v{revision.revision} · {revision.reason}
            </span>
            <button type="button" className="app-control underline" onClick={() => onRestore(revision.id)}>
              Restore
            </button>
          </li>
        ))}
        {!revisions.length && <li className="app-empty rounded p-2 text-xs text-[var(--color-text-muted)]">No saved revisions yet.</li>}
      </ul>
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
    <aside id={panelId} className="w-full border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:w-80 lg:border-l lg:border-t-0" aria-label={label}>
      {content}
    </aside>
  );
}
