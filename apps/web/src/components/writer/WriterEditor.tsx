"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { mlaParenthetical, mlaWorksCited, plainTextToProseMirror, proseMirrorToPlainText, sortMlaCitations, type CslJson } from "@/lib/writer";

type Document = { id: string; title: string; content: unknown; sortOrder: number };
type Citation = { id: string; cslJson: unknown; source: string };
type Source = { id: string; title: string; workId: string; workTitle: string; url: string | null; doi: string | null };
type Revision = { id: string; revision: number; reason: string; createdAt: string };

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 460;
const SIDEBAR_WIDTH_STEP = 20;

export function WriterEditor({ project, initialDocuments, initialCitations }: { project: { id: string; title: string }; initialDocuments: Document[]; initialCitations: Citation[] }) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [projectTitle, setProjectTitle] = useState(project.title);
  const [activeId, setActiveId] = useState(initialDocuments[0]?.id ?? "");
  const active = documents.find((document) => document.id === activeId) ?? documents[0];
  const [title, setTitle] = useState(active?.title ?? "Untitled document");
  const [text, setText] = useState(active ? proseMirrorToPlainText(active.content) : "");
  const [citations, setCitations] = useState(initialCitations);
  const [sources, setSources] = useState<Source[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [status, setStatus] = useState("Saved");
  const [importValue, setImportValue] = useState("");
  const [importKind, setImportKind] = useState<"doi" | "isbn" | "title" | "bibtex" | "ris">("doi");
  const citationList = useMemo(() => citations.map((citation) => citation.cslJson as CslJson), [citations]);
  const activeDocumentId = active?.id;

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => { setTitle(active.title); setText(proseMirrorToPlainText(active.content)); setStatus("Saved"); });
    fetch(`/api/writer/projects/${project.id}/documents/${active.id}/revisions`).then((response) => response.ok ? response.json() : { revisions: [] }).then((data) => setRevisions(data.revisions ?? []));
    return () => window.cancelAnimationFrame(frame);
    // Deliberately keyed on the stable activeDocumentId, not the `active`
    // object itself: `active` is a fresh object literal (`documents.find(...)`)
    // on every `documents` state update, including a pure reorder that never
    // actually switches documents. Depending on `active` made this effect
    // spuriously re-fire on reorder, resetting the draft's status back to
    // "Saved" out of band with (and sometimes ahead of) the reorder's own
    // real PATCH persistence — masking a race where a reload right after
    // reordering could observe the pre-persisted order (D-19-25).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDocumentId, project.id]);
  useEffect(() => { fetch(`/api/writer/projects/${project.id}/sources`).then((response) => response.ok ? response.json() : { sources: [] }).then((data) => setSources(data.sources ?? [])); }, [project.id]);
  useEffect(() => {
    if (!activeDocumentId || status !== "Editing") return;
    const timeout = window.setTimeout(async () => {
      setStatus("Saving…");
      const response = await fetch(`/api/writer/projects/${project.id}/documents/${activeDocumentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content: plainTextToProseMirror(text), reason: "autosave" }) });
      setStatus(response.ok ? "Saved" : "Save failed");
    }, 750);
    return () => window.clearTimeout(timeout);
  }, [title, text, activeDocumentId, project.id, status]);
  function updateDraft(next: string) { setText(next); setStatus("Editing"); }
  async function newDocument() {
    const nextTitle = window.prompt("Document title", "Untitled document"); if (!nextTitle?.trim()) return;
    const response = await fetch(`/api/writer/projects/${project.id}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: nextTitle }) });
    const document = await response.json(); if (!response.ok) return window.alert(document.error ?? "Could not create document.");
    setDocuments((items) => [...items, document]); setActiveId(document.id);
  }
  async function saveProjectTitle() {
    const next = projectTitle.trim();
    if (!next || next === project.title) return;
    const response = await fetch(`/api/writer/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: next }) });
    if (!response.ok) { setProjectTitle(project.title); window.alert("Could not rename project."); }
  }
  async function archiveProject() {
    if (!window.confirm("Archive this private project? You can restore it later from the archived-projects API.")) return;
    const response = await fetch(`/api/writer/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true, confirmArchive: true }) });
    if (response.ok) window.location.assign("/writer");
    else window.alert("Could not archive project.");
  }
  async function moveDocument(direction: -1 | 1) {
    const index = documents.findIndex((document) => document.id === activeId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= documents.length) return;
    const reordered = [...documents];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setDocuments(reordered.map((document, sortOrder) => ({ ...document, sortOrder })));
    // The reorder is applied optimistically above, but with no status signal a
    // reload or navigation immediately afterward could race the still-in-flight
    // PATCH requests and silently discard the new order — the same "Saving…"/
    // "Saved"/"Save failed" contract the draft autosave already gives the user
    // makes reorder persistence observable instead of silent (D-19-25).
    setStatus("Saving…");
    const responses = await Promise.all(reordered.map((document, sortOrder) => fetch(`/api/writer/projects/${project.id}/documents/${document.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sortOrder }) })));
    setStatus(responses.every((response) => response.ok) ? "Saved" : "Save failed");
  }
  async function importCitation(kind: "library" | "identifier" | "bibtex" | "ris", value: string, resourceId?: string) {
    const body = kind === "library" ? { kind, resourceId } : kind === "identifier" ? { kind, identifierType: importKind, value } : { kind, value };
    const response = await fetch(`/api/writer/projects/${project.id}/citations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json(); if (!response.ok) return window.alert(data.error ?? "Could not import citation.");
    setCitations((items) => [...items, ...data.citations.filter((candidate: Citation) => !items.some((item) => item.id === candidate.id))]); setImportValue("");
  }
  async function restore(revisionId: string) {
    if (!active || !window.confirm("Restore this revision? Your current draft will be saved as a new recoverable revision.")) return;
    const response = await fetch(`/api/writer/projects/${project.id}/documents/${active.id}/revisions/${revisionId}/restore`, { method: "POST" });
    const document = await response.json(); if (!response.ok) return window.alert(document.error ?? "Could not restore revision.");
    setText(proseMirrorToPlainText(document.content)); setStatus("Saved");
  }
  function insertCitation(citation: CslJson) { updateDraft(`${text}${text && !text.endsWith(" ") ? " " : ""}${mlaParenthetical(citation)} `); }
  function boundedSidebarWidth(width: number) { return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width)); }
  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    const startX = event.clientX; const initial = sidebarWidth;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => setSidebarWidth(boundedSidebarWidth(initial + moveEvent.clientX - startX));
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop);
  }
  function resizeWithKeyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = sidebarWidth - SIDEBAR_WIDTH_STEP;
    if (event.key === "ArrowRight") next = sidebarWidth + SIDEBAR_WIDTH_STEP;
    if (event.key === "Home") next = MIN_SIDEBAR_WIDTH;
    if (event.key === "End") next = MAX_SIDEBAR_WIDTH;
    if (next !== null) {
      event.preventDefault();
      setSidebarWidth(boundedSidebarWidth(next));
    }
  }
  if (!active) return <p className="p-6">This project has no active documents.</p>;
  return (
    <section className="min-h-[calc(100vh-3.5rem)]" aria-label="Writer workspace">
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3"><Link href="/writer" className="text-sm text-[var(--color-text-muted)] hover:underline">← Projects</Link><input aria-label="Project title" value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} onBlur={saveProjectTitle} className="min-w-0 flex-1 bg-transparent font-serif text-lg font-semibold" /><span className="text-xs text-[var(--color-text-muted)]" role="status">{status}</span><button type="button" className="text-sm text-[var(--color-text-muted)] underline" onClick={archiveProject}>Archive</button><a className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" href={`/api/writer/projects/${project.id}/export?documentId=${active.id}&format=docx`}>DOCX</a><a className="rounded border border-[var(--color-border)] px-2 py-1 text-sm" href={`/api/writer/projects/${project.id}/export?documentId=${active.id}&format=pdf`}>PDF</a></header>
      <div className="flex flex-col lg:flex-row">
        <aside className="relative shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:border-b-0 lg:border-r" style={{ width: `${sidebarWidth}px` }} aria-label="Library source sidebar">
          <h2 className="font-medium">Library sources</h2><p className="mt-1 text-xs text-[var(--color-text-muted)]">Only sources connected to your own uploaded works appear here.</p>
          <ul className="mt-3 max-h-52 space-y-2 overflow-auto">{sources.map((source) => <li key={source.id} className="rounded border border-[var(--color-border)] p-2 text-sm"><strong className="block">{source.title}</strong><span className="block text-xs text-[var(--color-text-muted)]">for {source.workTitle}</span><div className="mt-1 flex gap-2"><button type="button" className="underline" onClick={() => importCitation("library", "", source.id)}>Cite</button><Link className="underline" href={`/works/${source.workId}/reader`}>Read</Link></div></li>)}</ul>
          <div className="mt-5 border-t border-[var(--color-border)] pt-3"><h3 className="text-sm font-medium">Add citation</h3><div className="mt-2 flex gap-1"><select aria-label="Citation import format" value={importKind} onChange={(event) => setImportKind(event.target.value as typeof importKind)}><option value="doi">DOI</option><option value="isbn">ISBN</option><option value="title">Title</option><option value="bibtex">BibTeX</option><option value="ris">RIS</option></select><button type="button" className="rounded border px-2 text-sm" onClick={() => importCitation(importKind === "bibtex" ? "bibtex" : importKind === "ris" ? "ris" : "identifier", importValue)}>Add</button></div><textarea aria-label="Citation metadata" value={importValue} onChange={(event) => setImportValue(event.target.value)} className="mt-2 min-h-20 w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm" placeholder="DOI, ISBN, title, BibTeX, or RIS" /></div>
          <div
            role="separator"
            aria-label="Resize Library source sidebar"
            aria-orientation="vertical"
            aria-valuemin={MIN_SIDEBAR_WIDTH}
            aria-valuemax={MAX_SIDEBAR_WIDTH}
            aria-valuenow={sidebarWidth}
            aria-valuetext={`${sidebarWidth} pixels wide`}
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={resizeWithKeyboard}
            className="absolute right-0 top-0 hidden h-full w-2 cursor-col-resize lg:block focus-visible:bg-[var(--color-accent-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-ink)]"
          />
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6"><div className="mx-auto max-w-3xl"><div className="mb-4 flex items-center gap-2"><select aria-label="Active document" value={active.id} onChange={(event) => setActiveId(event.target.value)}>{documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select><button type="button" className="text-sm underline" onClick={() => moveDocument(-1)} disabled={documents[0]?.id === active.id}>Move earlier</button><button type="button" className="text-sm underline" onClick={() => moveDocument(1)} disabled={documents.at(-1)?.id === active.id}>Move later</button><button type="button" className="text-sm underline" onClick={newDocument}>New document</button></div><input aria-label="Document title" value={title} onChange={(event) => { setTitle(event.target.value); setStatus("Editing"); }} className="w-full border-b border-[var(--color-border)] bg-transparent pb-2 font-serif text-2xl font-semibold" /><p className="mt-3 text-xs text-[var(--color-text-muted)]">MLA 9 layout: one-inch export margins, double-spaced body, and hanging Works Cited entries.</p><textarea aria-label="Draft" value={text} onChange={(event) => updateDraft(event.target.value)} className="mt-5 min-h-[50vh] w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-background)] p-4 font-serif leading-8" /></div></main>
        <aside className="w-full border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:w-80 lg:border-l lg:border-t-0" aria-label="Citations and revision recovery"><h2 className="font-medium">Citations</h2><ul className="mt-2 space-y-3">{sortMlaCitations(citationList).map((citation, index) => <li key={`${citationKey(citation)}-${index}`} className="text-sm"><button type="button" className="mr-1 underline" onClick={() => insertCitation(citation)}>Insert</button>{mlaWorksCited(citation)}</li>)}</ul><h2 className="mt-6 font-medium">Revision recovery</h2><ul className="mt-2 space-y-2 text-sm">{revisions.slice(0, 8).map((revision) => <li key={revision.id} className="flex items-center justify-between gap-2"><span>v{revision.revision} · {revision.reason}</span><button type="button" className="underline" onClick={() => restore(revision.id)}>Restore</button></li>)}</ul></aside>
      </div>
    </section>
  );
}

function citationKey(citation: CslJson) { return citation.DOI ?? citation.ISBN ?? `${citation.title}-${citation.author?.[0]?.family ?? ""}`; }
