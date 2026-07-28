/**
 * Stage 6 layout spec §5.2: the two DOCX/PDF document-export anchors,
 * relocated from the old project-level header into the central document
 * toolbar (document-scoped chrome next to document-scoped controls) —
 * markup and `href`s unchanged. Neither format nor scope changed: still the
 * active document only, still `GET /api/writer/projects/:id/export`.
 */
export function ExportLinks({ projectId, documentId }: { projectId: string; documentId: string }) {
  return (
    <>
      <a className="app-control app-press rounded border border-[var(--color-border)] px-2 py-1 text-sm" href={`/api/writer/projects/${projectId}/export?documentId=${documentId}&format=docx`}>
        DOCX
      </a>
      <a className="app-control app-press rounded border border-[var(--color-border)] px-2 py-1 text-sm" href={`/api/writer/projects/${projectId}/export?documentId=${documentId}&format=pdf`}>
        PDF
      </a>
    </>
  );
}
