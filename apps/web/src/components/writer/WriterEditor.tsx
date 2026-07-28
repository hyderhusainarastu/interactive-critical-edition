"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { mlaParenthetical, plainTextToProseMirror, proseMirrorToPlainText, type CslJson } from "@/lib/writer";
import { formatInsertionExcerpt, takePendingWriterInsertion } from "@/lib/writer/insertionHandoff";
import { useRegisterContextBar } from "@/components/shell/ContextBarProvider";
import { useSecondaryPanel } from "@/components/primitives/useSecondaryPanel";
import { useToast } from "@/components/app/ToastProvider";
import { EmptyState } from "@/components/primitives/EmptyState";
import { ExportLinks } from "./ExportLinks";
import { CitationsHistoryPanel, type CitationExportFormat } from "./panels/CitationsHistoryPanel";
import { DEFAULT_WIDE_PANEL_STATE, toggleWidePanel, type WidePanelState } from "./panels/panelState";
import { SourcesEvidencePanel, type CitationImportKind } from "./panels/SourcesEvidencePanel";
import { useIsNarrowViewport } from "./panels/useIsNarrowViewport";
import { ProjectTitleField } from "./ProjectTitleField";
import { SaveStatus, type SaveState } from "./SaveStatus";
import { useDocumentBroadcast, type DocumentSavedMessage } from "./useDocumentBroadcast";
import type {
  EvidenceClaim,
  EvidenceView,
  ResearchProjectOption,
  WriterCitation as Citation,
  WriterDocument as Document,
  WriterRevision as Revision,
  WriterSource as Source,
} from "./writerTypes";

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 460;
const SIDEBAR_WIDTH_STEP = 20;

// Stage 6 layout spec §2.3: `localStorage`-only (not `WorkspacePreferences`)
// — viewport-chrome density, same precedent as `GlobalRagSidebar`'s stored
// width and `WorkspaceRail`'s stored collapse state.
const WIDE_PANELS_STORAGE_KEY = "palimnote:writer-panels";
const SOURCES_PANEL_ID = "writer-sources-panel";
const CITATIONS_PANEL_ID = "writer-citations-panel";

function readStoredWidePanels(): WidePanelState {
  try {
    const raw = window.localStorage.getItem(WIDE_PANELS_STORAGE_KEY);
    if (!raw) return DEFAULT_WIDE_PANEL_STATE;
    const parsed = JSON.parse(raw) as Partial<WidePanelState>;
    return {
      sources: typeof parsed.sources === "boolean" ? parsed.sources : true,
      citations: typeof parsed.citations === "boolean" ? parsed.citations : true,
    };
  } catch {
    return DEFAULT_WIDE_PANEL_STATE;
  }
}

function documentTimeKey(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}

/**
 * Stage 6 spec §4.3's "Reload this document" needs a real remount so the
 * inner session below re-initializes its `useState(initialDocuments)` from
 * fresh server data, not the stale in-memory draft — a plain prop update
 * alone would leave that existing state untouched (React only re-derives
 * state from new props across a `key` change, never automatically).
 *
 * This outer component is a thin wrapper for exactly that reason. Its own
 * `documentsFingerprint` (id + `updatedAt` per document) changes only when
 * `router.refresh()` (called from inside the session, on "Reload this
 * document") actually pulls fresher data from the server component this
 * page renders under (`(app)/writer/[projectId]/page.tsx` — untouched by
 * this stage). When the fingerprint changes, using it as `key` forces a
 * full remount of `WriterEditorSession` with the new `initialDocuments` as
 * its fresh starting state. Ordinary same-tab autosave never calls
 * `router.refresh()`, so this never remounts the session out from under a
 * normal editing session — only an explicit "Reload this document" click
 * can trigger it.
 */
export function WriterEditor({
  project,
  initialDocuments,
  initialCitations,
  evidenceEnabled = false,
}: {
  project: { id: string; title: string };
  initialDocuments: Document[];
  initialCitations: Citation[];
  evidenceEnabled?: boolean;
}) {
  const documentsFingerprint = initialDocuments.map((document) => `${document.id}:${documentTimeKey(document.updatedAt)}`).join("|");
  return (
    <WriterEditorSession
      key={documentsFingerprint}
      project={project}
      initialDocuments={initialDocuments}
      initialCitations={initialCitations}
      evidenceEnabled={evidenceEnabled}
    />
  );
}

function WriterEditorSession({
  project,
  initialDocuments,
  initialCitations,
  evidenceEnabled,
}: {
  project: { id: string; title: string };
  initialDocuments: Document[];
  initialCitations: Citation[];
  evidenceEnabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  // Stage 6 spec §4.3: when "Reload this document" remounts this session
  // (via the outer wrapper's `key` change), the fresh `initialDocuments[0]`
  // is not necessarily the document the user was actually looking at —
  // stash which one that was here, right before triggering the reload, and
  // consume it once on the way back in. Self-cleaning (removed as soon as
  // it's read) so a later, unrelated remount never picks up a stale value.
  const activeDocSessionKey = `palimnote:writer-active-document:${project.id}`;
  const [documents, setDocuments] = useState(initialDocuments);
  const [projectTitle, setProjectTitle] = useState(project.title);
  const [activeId, setActiveId] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = window.sessionStorage.getItem(activeDocSessionKey);
        if (stored) {
          window.sessionStorage.removeItem(activeDocSessionKey);
          if (initialDocuments.some((document) => document.id === stored)) return stored;
        }
      } catch {
        /* sessionStorage unavailable — fall through to the default below */
      }
    }
    return initialDocuments[0]?.id ?? "";
  });
  const active = documents.find((document) => document.id === activeId) ?? documents[0];
  const [title, setTitle] = useState(active?.title ?? "Untitled document");
  const [text, setText] = useState(active ? proseMirrorToPlainText(active.content) : "");
  const [citations, setCitations] = useState(initialCitations);
  const [sources, setSources] = useState<Source[]>([]);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [status, setStatus] = useState<SaveState>("Saved");
  // Autosave can be requested again while the previous PATCH is still in
  // flight (for example, a late input event arriving during the debounce
  // hand-off). Both requests would otherwise carry the same
  // `expectedUpdatedAt`: the first correctly advances the row, while the
  // second falsely looks like a different-device edit and receives 409.
  // Serialize local saves and schedule one follow-up after a successful
  // response; genuine remote writes still produce the existing 409 state.
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  // §4.3's now-implemented 409 contract: the last known-good `updated_at`
  // for the active document, sent as `expectedUpdatedAt` on every save.
  // Reset whenever the active document changes (the effect below, keyed on
  // `activeDocumentId`) and advanced to the server's own confirmed value on
  // every successful save (`saveNow`) — never a client-generated timestamp.
  // State updates do not change this render's `saveNow` closure. A locally
  // queued follow-up must therefore read the server-confirmed revision from a
  // ref, rather than sending the preceding request's `expectedUpdatedAt` and
  // mistaking its own successful save for a remote conflict. The initial
  // token is safe too: the server serializes its row lock and comparison, so
  // PostgreSQL's sub-millisecond timestamp precision cannot turn it into a
  // false conflict.
  const activeUpdatedAtRef = useRef<string | undefined>(active ? documentTimeKey(active.updatedAt) : undefined);
  // Stashed the moment either conflict variant (same-tab broadcast or
  // cross-device 409) first surfaces — the one piece of information
  // "Keep editing here" needs to make the very next save succeed instead of
  // 409-ing again against the same now-stale `expectedUpdatedAt` (§4.3: "no
  // capability regresses").
  const [pendingConflictUpdatedAt, setPendingConflictUpdatedAt] = useState<string | null>(null);
  // Integration step "writer-insertion-dialogs": set once, right after this
  // session consumes a pending cross-surface insertion handoff (Reader's
  // Claims tab or the Knowledge Map inspector) — renders a dismissible
  // "Inserted from ..." notice with a real link back to exactly where the
  // user came from, keeping the round trip reversible (charter §16 journey 5).
  const [insertionNotice, setInsertionNotice] = useState<{ sourceHref: string; sourceLabel: string } | null>(null);
  const [importValue, setImportValue] = useState("");
  const [importKind, setImportKind] = useState<CitationImportKind>("doi");
  const [citationExportFormat, setCitationExportFormat] = useState<CitationExportFormat>("bibtex");
  const citationList = useMemo(() => citations.map((citation) => citation.cslJson as CslJson), [citations]);
  const activeDocumentId = active?.id;

  // Phase 28.5 (Writer evidence insertion).
  const [researchLink, setResearchLink] = useState<ResearchProjectOption | null>(null);
  const [researchOptions, setResearchOptions] = useState<ResearchProjectOption[]>([]);
  const [selectedResearchProjectId, setSelectedResearchProjectId] = useState("");
  const [evidence, setEvidence] = useState<EvidenceView | null>(null);
  const [evidenceWorkFilter, setEvidenceWorkFilter] = useState("");
  const [evidenceNatureFilter, setEvidenceNatureFilter] = useState("");
  const [linkingResearch, setLinkingResearch] = useState(false);
  const [insertingClaimId, setInsertingClaimId] = useState<string | null>(null);

  // Stage 6 layout spec §2.2/§2.3: wide-mode panel state is independent
  // per panel and persists across reloads; narrow-mode state is the shell's
  // shared `SecondaryPanelProvider` singleton and never persists (§2.1 —
  // both default closed on a fresh narrow mount).
  const [widePanels, setWidePanels] = useState<WidePanelState>(() => (typeof window === "undefined" ? DEFAULT_WIDE_PANEL_STATE : readStoredWidePanels()));
  const isNarrow = useIsNarrowViewport();
  const sourcesSecondaryPanel = useSecondaryPanel("writer-sources");
  const citationsSecondaryPanel = useSecondaryPanel("writer-citations");
  const sourcesToggleRef = useRef<HTMLButtonElement>(null);
  const citationsToggleRef = useRef<HTMLButtonElement>(null);

  const sourcesOpen = isNarrow ? sourcesSecondaryPanel.isOpen : widePanels.sources;
  const citationsOpen = isNarrow ? citationsSecondaryPanel.isOpen : widePanels.citations;
  const bothWideCollapsed = !isNarrow && !widePanels.sources && !widePanels.citations;

  // Memoized on `projectTitle` alone (not a fresh `<ProjectTitleField>`
  // element every render): `useRegisterContextBar`'s own effect keys off
  // `state.title`'s referential identity, and a JSX element is a brand-new
  // object on every render — without this memo, the effect would re-fire on
  // every WriterEditor render, which re-triggers `ContextBarProvider`'s
  // state (a new `title`), which re-renders every context consumer
  // (WriterEditor included, since `useRegisterContextBar` itself reads the
  // context) — an infinite loop. `setProjectTitle` is the `useState` setter
  // (referentially stable by React's own guarantee); `saveProjectTitle` is
  // recreated each render but is only ever captured here when `projectTitle`
  // itself changes, which is exactly when its closure needs to be fresh.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const titleField = useMemo(() => <ProjectTitleField value={projectTitle} onChange={setProjectTitle} onBlur={saveProjectTitle} />, [projectTitle]);
  // Integration pass (stage6-write-spec.md §3's flagged follow-up, now
  // built): `ContextBar.tsx` renders its `actions` slot, so the save
  // status + Archive control move out of `WriterEditor`'s own local chrome
  // row entirely — no more local row stacked directly under the immersive
  // ContextBar. Memoized on `status` alone (not a fresh element every
  // render) for the exact same reason `titleField` above is memoized on
  // `projectTitle` alone: `useRegisterContextBar`'s effect keys off
  // `state.actions`'s referential identity, and re-firing on every
  // WriterEditor render would re-trigger `ContextBarProvider`'s state,
  // which re-renders every context consumer (WriterEditor included) — an
  // infinite loop. `saveNow`/`keepEditingHere`/`reloadDocument`/
  // `archiveProject` are ordinary function declarations (hoisted within
  // this component body, defined further below) — always current by the
  // time this memo's callback actually runs during render, exactly like
  // `titleField`'s own `saveProjectTitle` reference above.
  const actionsField = useMemo(
    () => (
      <>
        <SaveStatus status={status} onRetry={saveNow} onKeepEditingHere={keepEditingHere} onReloadDocument={reloadDocument} />
        <button type="button" className="app-control app-press text-sm text-[var(--color-text-muted)] underline" onClick={archiveProject}>Archive</button>
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status],
  );
  useRegisterContextBar({ title: titleField, actions: actionsField });

  // Stage 6 spec §4.3: a same-browser, cross-tab conflict signal. `postSaved`
  // is called from `saveNow()` below on every successful save with the
  // SERVER's own confirmed `updatedAt` (never a client-generated timestamp);
  // `onConflict` shows the "Edited in another tab" status variant instead of
  // continuing the normal Saving/Saved cycle, but only while this tab itself
  // has unsaved-or-unconfirmed local edits (the hook's own predicate).
  // `message.updatedAt` is also stashed so "Keep editing here" can adopt it
  // as this tab's next `expectedUpdatedAt` (integration pass, §4.3).
  const { postSaved } = useDocumentBroadcast({
    activeDocumentId,
    status,
    onConflict: (message: DocumentSavedMessage) => {
      setStatus("Edited in another tab");
      setPendingConflictUpdatedAt(message.updatedAt);
    },
  });

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      setTitle(active.title);
      let nextText = proseMirrorToPlainText(active.content);
      // Integration step "writer-insertion-dialogs": a pending cross-surface
      // handoff (Reader's Claims tab or the Knowledge Map inspector) is
      // consumed here, inside the SAME `requestAnimationFrame` callback that
      // otherwise resets the draft from the active document — consuming it
      // in a separate effect risked a real race, since a second effect's own
      // deferred update could fire after this one and silently clobber the
      // just-inserted excerpt back to the document's plain saved content.
      // `takePendingWriterInsertion` is self-cleaning (removed the instant
      // it's read), so this only ever fires once per real handoff, never on
      // a later document switch within the same session.
      const pendingInsertion = takePendingWriterInsertion(project.id);
      if (pendingInsertion) {
        const excerpt = formatInsertionExcerpt(pendingInsertion);
        nextText = `${nextText}${nextText && !nextText.endsWith(" ") && !nextText.endsWith("\n") ? " " : ""}${excerpt} `;
        setInsertionNotice({ sourceHref: pendingInsertion.sourceHref, sourceLabel: pendingInsertion.sourceLabel });
      }
      setText(nextText);
      // A consumed insertion leaves the draft with real unsaved content —
      // "Editing" (not "Saved") so the normal autosave debounce picks it up
      // and actually persists it, exactly like any other keystroke.
      setStatus(pendingInsertion ? "Editing" : "Saved");
      // §4.3: a freshly-switched-to document's own `updatedAt` is the only
      // correct starting point for the next save's `expectedUpdatedAt` —
      // never the previous document's value, and never stale across a
      // conflict banner this switch just silently left behind.
      const updatedAt = documentTimeKey(active.updatedAt);
      activeUpdatedAtRef.current = updatedAt;
      setPendingConflictUpdatedAt(null);
    });
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
    if (!evidenceEnabled) return;
    fetch(`/api/writer/projects/${project.id}/research-link`)
      .then((response) => (response.ok ? response.json() : { linked: null, options: [] }))
      .then((data) => { setResearchLink(data.linked ?? null); setResearchOptions(data.options ?? []); });
  }, [project.id, evidenceEnabled]);
  useEffect(() => {
    // `unlinkResearchProject` already clears `evidence` itself when the link
    // is removed — this effect only ever needs to FETCH, never reset, so it
    // never calls setState on its own early-return branch (react-hooks/set-state-in-effect).
    if (!evidenceEnabled || !researchLink) return;
    const query = new URLSearchParams();
    if (evidenceWorkFilter) query.set("workId", evidenceWorkFilter);
    if (evidenceNatureFilter) query.set("claimNature", evidenceNatureFilter);
    fetch(`/api/writer/projects/${project.id}/evidence?${query.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setEvidence(data && data.researchProject ? data : null));
  }, [project.id, evidenceEnabled, researchLink, evidenceWorkFilter, evidenceNatureFilter]);
  // Stage 6 spec §4.2: `saveNow()` is the one save path both the debounce
  // timer below AND the "Retry" control call — no duplicated fetch logic.
  // It reads `title`/`text` from this render's own closure, which is always
  // the draft's current content (not a stale snapshot from a past failure):
  // every keystroke re-renders the component, so by the time a user clicks
  // Retry the in-scope `saveNow` already closes over whatever they typed
  // since the failure.
  async function saveNow() {
    if (!activeDocumentId) return;
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    setStatus("Saving…");
    // A network-level failure (offline, DNS, an aborted request) makes
    // `fetch` itself reject rather than resolve with a non-ok response —
    // the pre-Stage-6 code had no `catch` here, so that case left `status`
    // stuck at "Saving…" forever with no Retry ever offered, which is
    // exactly the kind of dishonest failure state §4 exists to fix.
    let result: "ok" | "failed" | "conflict" = "failed";
    let savedUpdatedAt: string | null = null;
    let conflictLatestUpdatedAt: string | null = null;
    try {
      const response = await fetch(`/api/writer/projects/${project.id}/documents/${activeDocumentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // §4.3's now-implemented 409 contract: `activeUpdatedAt` is this
        // tab's last known-good version of the row. It is initialized from
        // the server-rendered active document and refreshed on each switch;
        // an absent value is reserved only for an older client that cannot
        // supply an optimistic-concurrency token.
        body: JSON.stringify({ title, content: plainTextToProseMirror(text), reason: "autosave", expectedUpdatedAt: activeUpdatedAtRef.current }),
      });
      if (response.status === 409) {
        const body = await response.json().catch(() => null) as { latest?: { updatedAt?: unknown } } | null;
        const latestUpdatedAt = body?.latest?.updatedAt;
        conflictLatestUpdatedAt = typeof latestUpdatedAt === "string" ? latestUpdatedAt : latestUpdatedAt instanceof Date ? latestUpdatedAt.toISOString() : null;
        result = "conflict";
      } else if (response.ok) {
        const updated = await response.json() as { updatedAt?: unknown };
        savedUpdatedAt = typeof updated.updatedAt === "string" ? updated.updatedAt : updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : null;
        result = "ok";
      } else {
        result = "failed";
      }
    } catch {
      result = "failed";
    }
    // A functional update, not a plain `setStatus(...)`: a fresher conflict
    // signal (either variant) can arrive from `useDocumentBroadcast` while
    // this fetch is still in flight, and this save's own (now-stale) result
    // must not clobber whichever conflict banner is already showing.
    setStatus((current) => {
      if (current === "Edited in another tab" || current === "Edited elsewhere") return current;
      if (result === "conflict") return "Edited elsewhere";
      return result === "ok" ? "Saved" : "Save failed";
    });
    if (result === "ok" && savedUpdatedAt) {
      activeUpdatedAtRef.current = savedUpdatedAt;
      postSaved(activeDocumentId, savedUpdatedAt);
    } else if (result === "conflict" && conflictLatestUpdatedAt) {
      setPendingConflictUpdatedAt(conflictLatestUpdatedAt);
    }
    saveInFlightRef.current = false;
    // Only replay a locally queued autosave after a confirmed local write.
    // Retrying after a real 409 would weaken the cross-device conflict
    // boundary by silently overwriting the other device's work.
    if (saveQueuedRef.current && result === "ok") {
      saveQueuedRef.current = false;
      setStatus((current) => current === "Edited in another tab" || current === "Edited elsewhere" ? current : "Editing");
    } else {
      saveQueuedRef.current = false;
    }
  }
  useEffect(() => {
    if (!activeDocumentId || status !== "Editing") return;
    const timeout = window.setTimeout(() => { saveNow(); }, 750);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, text, activeDocumentId, project.id, status]);
  // Stage 6 spec §4.2: warn on tab close/navigation only while there is real
  // unsaved-or-unconfirmed content — never while settled ("Saved") or during
  // the cross-tab conflict banner, where a native "leave site?" prompt would
  // be redundant or actively misleading.
  useEffect(() => {
    const hasUnconfirmedContent = status === "Editing" || status === "Saving…" || status === "Save failed";
    if (!hasUnconfirmedContent) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [status]);
  function updateDraft(next: string) { setText(next); setStatus("Editing"); }
  // Stage 6 spec §4.3: "Keep editing here" dismisses the conflict banner and
  // resumes plain last-write-wins — identical to today's behavior, no
  // capability regresses. Flipping to "Editing" (rather than leaving the
  // banner up) both clears the variant and, since the debounce effect above
  // depends on `status`, immediately schedules a fresh save of whatever this
  // tab already has, with no further keystroke required.
  //
  // Integration pass addition: with the real 409 contract now in place,
  // "no capability regresses" requires actually adopting the other tab's/
  // device's confirmed `updatedAt` as this tab's next `expectedUpdatedAt` —
  // without this, the very next autosave would still carry the stale value
  // and 409 again, turning "Keep editing here" into a dead end instead of
  // the last-write-wins override it promises.
  function keepEditingHere() {
    setStatus("Editing");
    if (pendingConflictUpdatedAt) {
      activeUpdatedAtRef.current = pendingConflictUpdatedAt;
      setPendingConflictUpdatedAt(null);
    }
  }
  // Stage 6 spec §4.3: "Reload this document" discards local edits and
  // picks up the other tab's saved content. `router.refresh()` re-runs this
  // route's server component with fresh data; the outer `WriterEditor`
  // wrapper's `documentsFingerprint`-keyed remount (see its own comment)
  // is what actually re-initializes state from that fresh data once it
  // arrives — this handler's job is only to request it and remember which
  // document to land back on.
  function reloadDocument() {
    try { window.sessionStorage.setItem(activeDocSessionKey, activeDocumentId ?? ""); } catch { /* best-effort only */ }
    router.refresh();
  }
  async function newDocument() {
    const nextTitle = window.prompt("Document title", "Untitled document"); if (!nextTitle?.trim()) return;
    const response = await fetch(`/api/writer/projects/${project.id}/documents`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: nextTitle }) });
    const document = await response.json(); if (!response.ok) return toast(document.error ?? "Could not create document.", "error");
    setDocuments((items) => [...items, document]); setActiveId(document.id);
  }
  async function saveProjectTitle() {
    const next = projectTitle.trim();
    if (!next || next === project.title) return;
    const response = await fetch(`/api/writer/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: next }) });
    if (!response.ok) { setProjectTitle(project.title); toast("Could not rename project.", "error"); }
  }
  async function archiveProject() {
    if (!window.confirm("Archive this private project? You can restore it later from the archived-projects API.")) return;
    const response = await fetch(`/api/writer/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived: true, confirmArchive: true }) });
    if (response.ok) window.location.assign("/writer");
    else toast("Could not archive project.", "error");
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
    const data = await response.json(); if (!response.ok) return toast(data.error ?? "Could not import citation.", "error");
    setCitations((items) => [...items, ...data.citations.filter((candidate: Citation) => !items.some((item) => item.id === candidate.id))]); setImportValue("");
  }
  async function restore(revisionId: string) {
    if (!active || !window.confirm("Restore this revision? Your current draft will be saved as a new recoverable revision.")) return;
    const response = await fetch(`/api/writer/projects/${project.id}/documents/${active.id}/revisions/${revisionId}/restore`, { method: "POST" });
    const document = await response.json(); if (!response.ok) return toast(document.error ?? "Could not restore revision.", "error");
    setText(proseMirrorToPlainText(document.content)); setStatus("Saved");
  }
  function insertCitation(citation: CslJson) { updateDraft(`${text}${text && !text.endsWith(" ") ? " " : ""}${mlaParenthetical(citation)} `); }
  // Phase 28.5 (Writer evidence insertion).
  async function linkResearchProject() {
    if (!selectedResearchProjectId) return;
    setLinkingResearch(true);
    try {
      const response = await fetch(`/api/writer/projects/${project.id}/research-link`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ researchProjectId: selectedResearchProjectId }) });
      const data = await response.json();
      if (!response.ok) return toast(data.error ?? "Could not link that research project.", "error");
      setResearchLink(data.linked);
    } finally { setLinkingResearch(false); }
  }
  async function unlinkResearchProject() {
    if (!window.confirm("Unlink this research project? The Evidence panel will hide its claims until you link a project again.")) return;
    const response = await fetch(`/api/writer/projects/${project.id}/research-link`, { method: "DELETE" });
    if (response.ok) { setResearchLink(null); setEvidence(null); }
    else toast("Could not unlink the research project.", "error");
  }
  async function insertEvidence(claim: EvidenceClaim) {
    if (!activeDocumentId) return;
    setInsertingClaimId(claim.id);
    try {
      const response = await fetch(`/api/writer/projects/${project.id}/documents/${activeDocumentId}/evidence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claimId: claim.id }) });
      const data = await response.json();
      if (!response.ok) return toast(data.error ?? "Could not insert this evidence.", "error");
      setDocuments((items) => items.map((document) => (document.id === data.document.id ? { ...document, content: data.document.content } : document)));
      if (data.document.id === activeDocumentId) {
        // Rehydrate the visible draft from the server's authoritative
        // content (which now carries the inserted blockquote + any marker
        // paragraphs), but land on "Saved" — NOT "Editing" — so the
        // autosave effect above does not immediately re-run
        // `plainTextToProseMirror` over it. That round trip flattens every
        // block back to a plain paragraph (the textarea has no concept of a
        // `blockquote` node), which would silently destroy the structured
        // node's `attrs` the moment it fired. Landing on "Saved" defers that
        // loss until the user's own next real edit — a documented trade-off
        // of this editor being a plain textarea, not a rich ProseMirror view.
        setText(proseMirrorToPlainText(data.document.content));
        setStatus("Saved");
      }
      const citationsResponse = await fetch(`/api/writer/projects/${project.id}/citations`);
      if (citationsResponse.ok) setCitations((await citationsResponse.json()).citations ?? []);
    } finally { setInsertingClaimId(null); }
  }
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
  function persistWidePanels(next: WidePanelState) {
    try { window.localStorage.setItem(WIDE_PANELS_STORAGE_KEY, JSON.stringify(next)); } catch { /* won't survive a reload in this browser */ }
    return next;
  }
  function toggleSourcesPanel() {
    if (isNarrow) { if (sourcesSecondaryPanel.isOpen) sourcesSecondaryPanel.close(); else sourcesSecondaryPanel.open(); }
    else setWidePanels((current) => persistWidePanels(toggleWidePanel(current, "sources")));
  }
  function toggleCitationsPanel() {
    if (isNarrow) { if (citationsSecondaryPanel.isOpen) citationsSecondaryPanel.close(); else citationsSecondaryPanel.open(); }
    else setWidePanels((current) => persistWidePanels(toggleWidePanel(current, "citations")));
  }
  // Stage 6 verification round 1 §4.2 fix: on wide (>=1024px) viewports the
  // Sources panel is an inline `<aside>` rendered as a flex sibling of
  // `<main>`, positioned before it in the DOM so it appears visually to the
  // left — but both toggle buttons live inside `<main>`'s own toolbar row,
  // which is later in DOM/tab order than the aside. A plain forward Tab from
  // the (focused, open) Sources toggle therefore lands on the very next
  // toolbar control (the Citations toggle) instead of the Sources panel's
  // own content, which is unreachable by forward-tabbing once you're past
  // it. Rather than restructure the panel/toolbar DOM layout (risking the
  // §2.5 resize/collapse mechanics and the narrow-viewport sheet, both of
  // which already work correctly), this redirects a plain Tab press on the
  // toggle straight into the panel's own first focusable control — the
  // same "disclosure trigger hands off to its own disclosed content" pattern
  // already used by the narrow-viewport sheet (which auto-focuses its own
  // close button on open). Only intercepts a plain forward Tab (not
  // Shift+Tab) while wide and the panel is actually open; narrow mode is
  // untouched (its sheet already traps focus correctly via `useFocusTrap`).
  function handleSourcesToggleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "Tab" || event.shiftKey || isNarrow || !sourcesOpen) return;
    const panel = document.getElementById(SOURCES_PANEL_ID);
    const firstFocusable = panel?.querySelector<HTMLElement>(
      "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    if (!firstFocusable) return;
    event.preventDefault();
    firstFocusable.focus();
  }
  if (!active) {
    return (
      <div className="app-mount p-6">
        <EmptyState heading="No documents in this project" body="This project has no active documents to display." />
      </div>
    );
  }
  return (
    <section className="app-mount min-h-[calc(100vh-3.5rem)]" aria-label="Writer workspace">
      {/* Stage 6 layout spec §3 + this integration pass: the project title
          AND the save status/Archive controls now both live in ContextBar's
          title/actions slots (registered above via `useRegisterContextBar`)
          — no more local chrome row stacked under the immersive ContextBar
          at all. DOCX/PDF export stays in the central document toolbar
          below (document-scoped, not project-scoped, so it belongs beside
          the document switcher rather than project-level chrome). */}
      <div className="flex flex-col lg:flex-row">
        <SourcesEvidencePanel
          mode={isNarrow ? "sheet" : "inline"}
          open={sourcesOpen}
          onCloseSheet={sourcesSecondaryPanel.close}
          triggerRef={sourcesToggleRef}
          panelId={SOURCES_PANEL_ID}
          sidebarWidth={sidebarWidth}
          onResizeStart={startResize}
          onResizeKeyDown={resizeWithKeyboard}
          sources={sources}
          onCite={(resourceId) => importCitation("library", "", resourceId)}
          importKind={importKind}
          onImportKindChange={setImportKind}
          importValue={importValue}
          onImportValueChange={setImportValue}
          onAddCitation={() => importCitation(importKind === "bibtex" ? "bibtex" : importKind === "ris" ? "ris" : "identifier", importValue)}
          evidenceEnabled={evidenceEnabled}
          researchLink={researchLink}
          researchOptions={researchOptions}
          selectedResearchProjectId={selectedResearchProjectId}
          onSelectedResearchProjectIdChange={setSelectedResearchProjectId}
          onLinkResearchProject={linkResearchProject}
          linkingResearch={linkingResearch}
          onUnlinkResearchProject={unlinkResearchProject}
          evidence={evidence}
          evidenceWorkFilter={evidenceWorkFilter}
          onEvidenceWorkFilterChange={setEvidenceWorkFilter}
          evidenceNatureFilter={evidenceNatureFilter}
          onEvidenceNatureFilterChange={setEvidenceNatureFilter}
          insertingClaimId={insertingClaimId}
          onInsertEvidence={insertEvidence}
        />
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          {/* §2.5's "freed-space rule": the draft only widens when both
              panels are collapsed AND the viewport is wide — a narrow
              viewport's single-sheet-at-a-time layout has no inline panels
              to free space from, so it never applies there.

              Deliberately NOT `app-mount` (Stage 6 verification round 1
              §4.1 fix, second half): `.app-mount`'s keyframes only define a
              `from` step, so once its one-shot entrance animation settles
              browsers report the completed `transform` as the identity
              matrix (`matrix(1,0,0,1,0,0)`), not the literal keyword
              `none` — and per the CSS stacking spec, ANY non-`none`
              transform value (identity or not) makes the element establish
              its own stacking context permanently, forever after the
              animation ends. That silently traps the toolbar's own
              `z-50` toggle buttons (below) one level too deep: their
              elevated z-index only ever gets to outrank siblings *within*
              this div's own stacking context, never the narrow-viewport
              sheet's `z-40` backdrop, which is a sibling of `<main>` two
              levels up — confirmed by walking `getComputedStyle` up the
              real ancestor chain in a live repro. Dropping `app-mount` here
              removes that intermediate stacking context so the buttons'
              own z-index is compared directly against the backdrop's,
              which is what actually lets the fix below work; the entrance
              animation this card loses is cosmetic (a one-time fade/slide
              on first mount) and asserted by no test. */}
          <div
            data-panels-collapsed={bothWideCollapsed || undefined}
            className={`app-card mx-auto rounded-xl p-4 sm:p-6 ${bothWideCollapsed ? "max-w-4xl" : "max-w-3xl"}`}
          >
            {/* Integration step "writer-insertion-dialogs": a real,
                reversible-navigation link back to exactly where the just-
                inserted excerpt came from (charter §16 journey 5), not just
                a bare confirmation. Dismissible — this is a one-time
                notice about what just happened, not persistent chrome. */}
            {insertionNotice && (
              <div className="app-panel-enter mb-4 flex flex-wrap items-center gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
                <span>Inserted from {insertionNotice.sourceLabel}.</span>
                <Link href={insertionNotice.sourceHref} className="underline">Return to source</Link>
                <button type="button" className="app-control app-press ml-auto" aria-label="Dismiss" onClick={() => setInsertionNotice(null)}>×</button>
              </div>
            )}
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <select aria-label="Active document" className="app-control app-select" value={active.id} onChange={(event) => setActiveId(event.target.value)}>{documents.map((document) => <option key={document.id} value={document.id}>{document.title}</option>)}</select>
              <button type="button" className="app-control app-press text-sm underline" onClick={() => moveDocument(-1)} disabled={documents[0]?.id === active.id}>Move earlier</button>
              <button type="button" className="app-control app-press text-sm underline" onClick={() => moveDocument(1)} disabled={documents.at(-1)?.id === active.id}>Move later</button>
              <button type="button" className="app-control app-press text-sm underline" onClick={newDocument}>New document</button>
              {/* Stage 6 verification round 1 §4.1 fix: on narrow (<1024px)
                  viewports, `WriterPanelSheet`'s full-screen `fixed inset-0
                  z-40` backdrop sits above this toolbar (neither button had
                  a stacking context of its own, so both painted below any
                  `fixed`+`z-index` sibling regardless of DOM order). A tap
                  on the OTHER toggle while a sheet was open therefore hit
                  the backdrop instead of the button, closing the current
                  sheet without opening the other one — the spec's §2.1
                  "opening Citations closes Sources first" single-action
                  promise was unreachable. `relative z-50` lifts just these
                  two trigger buttons above the backdrop (z-40) so a tap
                  always reaches the intended button; the backdrop still
                  blocks every other click on the page behind it, which is
                  the correct modal behavior everywhere except this one
                  documented cross-toggle affordance. This alone wasn't
                  enough, though — see the `app-mount`-removal comment on
                  this card's wrapping `<div>` above for the second half of
                  this same fix (an intermediate ancestor's stacking context
                  was silently trapping these buttons' z-index below the
                  backdrop no matter how high it was set). */}
              <button
                ref={sourcesToggleRef}
                type="button"
                className="app-control app-press relative z-50 min-h-11 rounded border border-[var(--color-border)] px-3 text-sm"
                aria-expanded={sourcesOpen}
                aria-controls={SOURCES_PANEL_ID}
                onClick={toggleSourcesPanel}
                onKeyDown={handleSourcesToggleKeyDown}
              >
                Sources and evidence
              </button>
              <button
                ref={citationsToggleRef}
                type="button"
                className="app-control app-press relative z-50 min-h-11 rounded border border-[var(--color-border)] px-3 text-sm"
                aria-expanded={citationsOpen}
                aria-controls={CITATIONS_PANEL_ID}
                onClick={toggleCitationsPanel}
              >
                Citations and history
              </button>
              <ExportLinks projectId={project.id} documentId={active.id} />
            </div>
            <input aria-label="Document title" value={title} onChange={(event) => { setTitle(event.target.value); setStatus("Editing"); }} className="app-control w-full border-b border-[var(--color-border)] bg-transparent pb-2 font-serif text-2xl font-semibold" />
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">MLA 9 layout: one-inch export margins, double-spaced body, and hanging Works Cited entries.</p>
            <textarea aria-label="Draft" value={text} onChange={(event) => updateDraft(event.target.value)} className="app-control mt-5 min-h-[50vh] w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-background)] p-4 font-serif leading-8 shadow-inner" />
          </div>
        </main>
        <CitationsHistoryPanel
          mode={isNarrow ? "sheet" : "inline"}
          open={citationsOpen}
          onCloseSheet={citationsSecondaryPanel.close}
          triggerRef={citationsToggleRef}
          panelId={CITATIONS_PANEL_ID}
          projectId={project.id}
          citationList={citationList}
          onInsertCitation={insertCitation}
          citationExportFormat={citationExportFormat}
          onCitationExportFormatChange={setCitationExportFormat}
          revisions={revisions}
          onRestore={restore}
        />
      </div>
    </section>
  );
}
