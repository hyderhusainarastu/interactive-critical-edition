"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { matchesReaderLevel, type ReaderLevelFilter, type ReaderLevelMatchMode } from "@ice/roadmap";
import { useWorkspacePreferences } from "@/components/app/WorkspacePreferencesProvider";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import {
  type AnnotationRecord,
  type BookmarkRecord,
  type FootnoteRecord,
  type HighlightColor,
  type Position,
  type ReaderData,
} from "./types";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { PdfReader } from "./PdfReader";
import { OriginalTextReader } from "./OriginalTextReader";
import { NotesSidebar } from "./NotesSidebar";
import { WorkPicker } from "./WorkPicker";
import { EditionReader, computeOutline, type EditionPayload } from "./EditionReader";
import { EditionAnnotationsPanel, type EditionReaderFilters } from "./EditionAnnotationsPanel";
import { ReaderOutlineSidebar } from "./ReaderOutlineSidebar";
import { RagChatPanel } from "./RagChatPanel";
import { useNarrowViewport } from "@/hooks/useNarrowViewport";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Request failed");
  return res.json();
}

/**
 * `embedded` suppresses the split-view control — set when this instance
 * is already the second pane of a split view, so panes can't nest
 * (plan §16: split-pane is reader-level UI state, not a route — each
 * side is a fully functional independent reader, but only the primary
 * pane offers opening a second one).
 */
export function ReaderShell({
  workId,
  embedded = false,
  initialReaderLevel = "all",
  enablePhase12Identity = false,
  enablePhase12Reader = false,
  enablePhase18Rag = false,
}: {
  workId: string;
  embedded?: boolean;
  initialReaderLevel?: ReaderLevelFilter;
  enablePhase12Identity?: boolean;
  enablePhase12Reader?: boolean;
  enablePhase18Rag?: boolean;
}) {
  const { preferences } = useWorkspacePreferences();
  const [data, setData] = useState<ReaderData | null>(null);
  const [edition, setEdition] = useState<EditionPayload | null>(null);
  const [showInteractive, setShowInteractive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingColor, setPendingColor] = useState<HighlightColor>("gold");
  const [activeFootnote, setActiveFootnote] = useState<FootnoteRecord | null>(null);
  // D-23-51: at wide viewports the outline/analysis/notes rails are always-
  // open sticky columns (matches this app's existing default-open toolbar
  // toggles); at narrow viewports they're the drawer/dialog pattern instead
  // — three panels shouldn't all slam open over the reading text on a phone
  // on first load, so the initial value is seeded from the real viewport
  // width at mount rather than hardcoded `true` for every screen size.
  const narrow = useNarrowViewport();
  // D-23-51 follow-up (Phase 23 Lane D): the user-notes rail defaults
  // collapsed at every viewport width, not just narrow ones — it's a
  // reader-authored aside (highlights/notes/bookmarks), not primary reading
  // apparatus, so it shouldn't claim screen space unrequested the way
  // showAnalysis/showOutline (still `!narrow`-seeded) do.
  const [showNotes, setShowNotes] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(() => !narrow);
  const [showOutline, setShowOutline] = useState(() => !narrow);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [splitWorkId, setSplitWorkId] = useState<string | null>(null);
  const [editionReaderLevel, setEditionReaderLevel] = useState<ReaderLevelFilter>(initialReaderLevel);
  const [editionLevelMode, setEditionLevelMode] = useState<ReaderLevelMatchMode>("cumulative");
  const [editionFilters, setEditionFilters] = useState<EditionReaderFilters>({ annotationType: "all", relationship: "all", provenance: "all", apparatusKind: "all" });
  const [pendingNoteHighlightIds, setPendingNoteHighlightIds] = useState<string[]>([]);
  const [activeReaderBlockId, setActiveReaderBlockId] = useState<string | null>(null);
  const [showRagChat, setShowRagChat] = useState(false);

  const positionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const currentPositionRef = useRef<Position | null>(null);
  // Whatever had keyboard focus when a footnote marker was activated (the
  // marker itself) — restored once the footnote modal closes, matching the
  // trigger-focus-restoration pattern established for every other reader
  // shell disclosure (WorkPicker's split-view chooser, AppShell's
  // preferences/mobile-nav dialogs).
  const footnoteTriggerRef = useRef<HTMLElement | null>(null);
  // Same trigger-focus-restoration pattern, applied to this reader's own
  // contextual "Ask Library" drawer (D-22-9 — this instance previously had
  // no aria-expanded/aria-controls relationship and no focus restoration
  // on close, unlike every other reader-shell disclosure).
  const ragTriggerRef = useRef<HTMLButtonElement>(null);
  const ragPanelId = useId();
  // Same trigger-focus-restoration pattern, applied to the reader's own
  // outline/analysis/notes rails (D-23-51) — only exercised when a rail is
  // shown as a narrow-viewport dialog (`ReaderSidebarFrame`); at wide
  // viewports these are always-open sticky columns with no close control to
  // restore focus to.
  const outlineTriggerRef = useRef<HTMLButtonElement>(null);
  const analysisTriggerRef = useRef<HTMLButtonElement>(null);
  const notesTriggerRef = useRef<HTMLButtonElement>(null);
  const toolbarRevealRef = useScrollReveal<HTMLDivElement>();
  const loadingRevealRef = useScrollReveal<HTMLParagraphElement>();

  useEffect(() => {
    let ignore = false;
    jsonFetch<ReaderData>(`/api/works/${workId}/reader`)
      .then((d) => {
        if (!ignore) setData(d);
      })
      .catch((err) => {
        if (!ignore) setError(err instanceof Error ? err.message : "Failed to load.");
      });
    jsonFetch<{ edition: EditionPayload | null }>(`/api/works/${workId}/edition`)
      .then((response) => {
        if (ignore) return;
        setEdition(response.edition);
        // The interactive reader is the primary reading experience whenever
        // processing exists. Its explicitly separate companion is always the
        // immutable original source, never a second processed "edition".
        if (response.edition) setShowInteractive(true);
      })
      .catch(() => { /* legacy reader remains fully available */ });
    return () => {
      ignore = true;
    };
  }, [workId]);

  // D-23-51: a rail's `showX` boolean means two different things depending
  // on viewport — "always-open sticky column" (wide) vs. "drawer is open"
  // (narrow) — so if the window is resized (or rotated) from wide to narrow
  // while a rail was open, leaving `showX` untouched would make it snap
  // straight into an unrequested full-screen drawer instead of the closed
  // state a narrow reader always starts from. A one-shot sync off the
  // narrow-transition external signal, not a derived value (the reader must
  // still be free to open a drawer afterward without this fighting it) —
  // same precedent as `EditionAnnotationsPanel`'s activeId-driven tab sync.
  const wasNarrowRef = useRef(narrow);
  useEffect(() => {
    if (narrow && !wasNarrowRef.current) {
      setShowOutline(false);
      setShowAnalysis(false);
      setShowNotes(false);
    }
    wasNarrowRef.current = narrow;
  }, [narrow]);

  const savePosition = useCallback(
    (position: Position) => {
      clearTimeout(positionTimer.current);
      positionTimer.current = setTimeout(() => {
        void jsonFetch(`/api/works/${workId}/reader/position`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(position),
        });
      }, 800);
    },
    [workId],
  );

  const createHighlight = useCallback(
    async (anchor: HighlightRecordAnchorInput) => {
      const created = await jsonFetch<{ id: string }>(`/api/works/${workId}/reader/highlights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchor, color: pendingColor }),
      });
      setData((d) =>
        d
          ? {
              ...d,
              highlights: [
                { id: created.id, anchor, color: pendingColor, createdAt: new Date().toISOString() },
                ...d.highlights,
              ],
            }
          : d,
      );
      return created.id;
    },
    [workId, pendingColor],
  );

  const deleteHighlight = useCallback(
    async (id: string) => {
      await fetch(`/api/works/${workId}/reader/highlights/${id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, highlights: d.highlights.filter((h) => h.id !== id) } : d));
    },
    [workId],
  );

  const addNote = useCallback(
    async (body: string, highlightIds: string[] = []) => {
      const created = await jsonFetch<{
        id: string;
        highlightId: string | null;
        highlightIds: string[];
        body: string;
        createdAt: string;
        updatedAt: string;
      }>(`/api/works/${workId}/reader/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, highlightIds }),
      });
      setData((d) => (d ? { ...d, notes: [created, ...d.notes] } : d));
      setPendingNoteHighlightIds([]);
    },
    [workId],
  );

  const deleteNote = useCallback(
    async (id: string) => {
      await fetch(`/api/works/${workId}/reader/notes/${id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, notes: d.notes.filter((n) => n.id !== id) } : d));
    },
    [workId],
  );

  const addBookmark = useCallback(
    async (position: Position, label?: string) => {
      const created = await jsonFetch<{ id: string; position: Position; label: string | null; createdAt: string }>(
        `/api/works/${workId}/reader/bookmarks`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position, label }),
        },
      );
      setData((d) => (d ? { ...d, bookmarks: [created, ...d.bookmarks] } : d));
      setShowNotes(true);
    },
    [workId],
  );

  const selectBookmark = useCallback((bookmark: BookmarkRecord) => {
    if (bookmark.position.kind === "processed") setActiveReaderBlockId(bookmark.position.textBlockId);
  }, []);

  const deleteBookmark = useCallback(
    async (id: string) => {
      await fetch(`/api/works/${workId}/reader/bookmarks/${id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, bookmarks: d.bookmarks.filter((b) => b.id !== id) } : d));
    },
    [workId],
  );

  const updateAnnotation = useCallback(
    async (id: string, patch: Partial<Pick<AnnotationRecord, "verificationStatus" | "hidden" | "explanation">>) => {
      // Optimistic — reflect the correction immediately; the PATCH persists it.
      setData((d) =>
        d
          ? {
              ...d,
              annotations: d.annotations.map((a) =>
                a.id === id ? { ...a, ...patch, ...(patch.explanation ? { createdBy: "user" as const } : {}) } : a,
              ),
            }
          : d,
      );
      await fetch(`/api/works/${workId}/reader/annotations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    },
    [workId],
  );

  const refreshAnnotations = useCallback(async () => {
    const res = await jsonFetch<Pick<ReaderData, "analysisStatus" | "analysisError" | "annotations">>(
      `/api/works/${workId}/reader/annotations`,
    );
    setData((d) => (d ? { ...d, ...res } : d));
  }, [workId]);

  const reanalyze = useCallback(async () => {
    setData((d) => (d ? { ...d, analysisStatus: "analyzing", analysisError: null } : d));
    setShowAnalysis(true);
    await fetch(`/api/works/${workId}/analyze`, { method: "POST" });
  }, [workId]);

  // Poll while analysis is in a non-terminal state so results stream in
  // without a manual refresh. "not_started" is included because there's a
  // brief window right after confirm where the job is queued but the
  // worker hasn't yet flipped the status to "analyzing" — without this the
  // reader would sit on a stale status until reload.
  useEffect(() => {
    const status = data?.analysisStatus;
    if (status !== "analyzing" && status !== "not_started") return;
    const timer = setInterval(() => void refreshAnnotations(), 3000);
    return () => clearInterval(timer);
  }, [data?.analysisStatus, refreshAnnotations]);

  const openAnnotation = useCallback((id: string) => {
    setShowAnalysis(true);
    setActiveAnnotationId(id);
    const blockId = edition?.passageAnnotations.find((annotation) => annotation.id === id)?.textBlockId ?? null;
    if (blockId) setActiveReaderBlockId(blockId);
  }, [edition]);

  const createLinkedNote = useCallback(async (anchor: Omit<Extract<HighlightRecordAnchorInput, { kind: "processed" }>, "kind">) => {
    const highlightId = await createHighlight({ kind: "processed", ...anchor });
    if (highlightId) {
      setPendingNoteHighlightIds([highlightId]);
      setShowNotes(true);
    }
  }, [createHighlight]);

  const linkExistingNote = useCallback(async (noteId: string, anchor: Omit<Extract<HighlightRecordAnchorInput, { kind: "processed" }>, "kind">) => {
    const highlightId = await createHighlight({ kind: "processed", ...anchor });
    if (!highlightId) return;
    await jsonFetch(`/api/works/${workId}/reader/notes/${noteId}/highlights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ highlightId }),
    });
    setData((current) => current ? {
      ...current,
      notes: current.notes.map((note) => note.id === noteId ? { ...note, highlightIds: [...new Set([...note.highlightIds, highlightId])] } : note),
    } : current);
  }, [createHighlight, workId]);

  const closeFootnote = useCallback(() => {
    setActiveFootnote(null);
    window.requestAnimationFrame(() => footnoteTriggerRef.current?.focus());
  }, []);

  const closeRagChat = useCallback(() => {
    setShowRagChat(false);
    window.requestAnimationFrame(() => ragTriggerRef.current?.focus());
  }, []);

  const closeOutline = useCallback(() => {
    setShowOutline(false);
    window.requestAnimationFrame(() => outlineTriggerRef.current?.focus());
  }, []);

  const closeAnalysisPanel = useCallback(() => {
    setShowAnalysis(false);
    window.requestAnimationFrame(() => analysisTriggerRef.current?.focus());
  }, []);

  const closeNotesPanel = useCallback(() => {
    setShowNotes(false);
    window.requestAnimationFrame(() => notesTriggerRef.current?.focus());
  }, []);

  const approveTerm = useCallback(async (termId: string) => {
    await jsonFetch(`/api/works/${workId}/reader/terms/${termId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    const response = await jsonFetch<{ edition: EditionPayload | null }>(`/api/works/${workId}/edition`);
    setEdition(response.edition);
  }, [workId]);

  const initialPosition = useMemo(() => data?.lastPosition ?? null, [data]);
  const visibleEdition = useMemo(() => {
    if (!edition) return edition;
    // Must match `EditionAnnotationsPanel`'s `enableLevelFilter` render gate
    // below exactly — otherwise the level select can render (under
    // `enablePhase12Reader`) while this filter silently never applies,
    // leaving a control that visibly does nothing.
    const levelFilterEnabled = enablePhase12Identity || enablePhase12Reader;
    const visibleAtLevel = (annotation: EditionPayload["passageAnnotations"][number]) =>
      !levelFilterEnabled || editionReaderLevel === "all" || matchesReaderLevel(annotation.readerLevel, editionReaderLevel, editionLevelMode);
    const visibleByReaderFilter = (annotation: EditionPayload["passageAnnotations"][number]) =>
      !enablePhase12Reader
      || ((editionFilters.annotationType === "all" || annotation.annotationType === editionFilters.annotationType)
        && (editionFilters.relationship === "all" || annotation.relationship === editionFilters.relationship)
        && (editionFilters.provenance === "all" || (editionFilters.provenance === "ai" ? annotation.createdBy === "system" : annotation.createdBy !== "system")));
    return {
      ...edition,
      passageAnnotations: edition.passageAnnotations.filter((annotation) => visibleAtLevel(annotation) && visibleByReaderFilter(annotation)),
      wholeWorkGuidance: edition.wholeWorkGuidance.filter((annotation) => visibleAtLevel(annotation) && visibleByReaderFilter(annotation)),
    };
  }, [edition, editionFilters, editionLevelMode, editionReaderLevel, enablePhase12Identity, enablePhase12Reader]);

  // D-23-51: the same pure computation `EditionReader`'s own jump-to-block
  // navigation uses, so the persistent outline rail and the reader's
  // internal navigation can never disagree about section boundaries.
  const outline = useMemo(() => (visibleEdition ? computeOutline(visibleEdition.blocks) : []), [visibleEdition]);

  const visibleAnnotationIds = useMemo(() => visibleEdition?.passageAnnotations.map((annotation) => annotation.id) ?? [], [visibleEdition]);
  const moveAnnotation = useCallback((direction: -1 | 1) => {
    if (!visibleAnnotationIds.length) return;
    const activeIndex = activeAnnotationId ? visibleAnnotationIds.indexOf(activeAnnotationId) : direction === 1 ? -1 : 0;
    const nextIndex = (activeIndex + direction + visibleAnnotationIds.length) % visibleAnnotationIds.length;
    openAnnotation(visibleAnnotationIds[nextIndex]);
  }, [activeAnnotationId, openAnnotation, visibleAnnotationIds]);

  if (error) {
    return <p className="mx-auto max-w-xl px-6 py-12 text-[var(--color-accent-burgundy)]">{error}</p>;
  }
  if (!data) {
    return <p ref={loadingRevealRef} className="app-reveal mx-auto max-w-xl px-6 py-12 text-[var(--color-text-muted)]">Loading…</p>;
  }

  const isPdf = data.mimeType === "application/pdf";
  const effectiveShowInteractive = showInteractive || (enablePhase12Reader && preferences.focusMode && edition !== null);
  const readerFocus = enablePhase12Reader && preferences.focusMode && effectiveShowInteractive && visibleEdition !== null;
  const readerFontSize = preferences.fontSize === "small" ? 0.95 : preferences.fontSize === "large" ? 1.18 : 1.05;
  // D-22-6 (plan §22.2): reading width is no longer recomputed here — both
  // TextReader and EditionReader now consume the single global
  // --reading-measure token (globals.css, driven by
  // :root[data-reading-width]) instead of a second, disagreeing
  // --reader-line-width scale that used to live only in this component.

  const showOutlineRail = !readerFocus && effectiveShowInteractive && outline.length > 0;

  return (
    <div data-reading-mode={readerFocus ? "focus" : undefined} className="flex min-h-screen items-start">
      {showOutlineRail && showOutline && (
        <ReaderOutlineSidebar
          items={outline}
          onSelect={(blockId) => setActiveReaderBlockId(blockId)}
          onClose={closeOutline}
        />
      )}

      <div className={splitWorkId ? "flex min-w-0 flex-1 divide-x divide-[var(--color-border)]" : "flex min-w-0 flex-1"}>
        <div className="min-w-0 flex-1">
          {/* `data-dense-controls`: marks this toolbar for the Phase 23.2
              touch-target audit (accessibility-sweep.spec.ts) as an
              accepted, reported exception — a compact secondary-action
              toolbar row, not primary reading chrome; see that spec's
              docblock for the full rationale. Purely a test hook, no
              behavior/visual change.
              D-23-51: sticky (not just a plain border-b row) so its
              add-note/add-annotation entry points (Analysis, Notes,
              Outline, Ask Library, + Bookmark) stay reachable at any scroll
              depth, on every viewport — the toggle buttons are also each
              rail's ONLY way to reopen it once closed on a narrow screen. */}
          {!readerFocus && <div ref={toolbarRevealRef} data-dense-controls="reader-toolbar" className="app-reveal sticky top-14 z-20 flex flex-wrap items-center gap-4 border-b border-[var(--color-border)] bg-[var(--color-background)] px-4 py-2 text-sm">
            <strong className="text-[var(--color-text)]">{data.title}</strong>
            {edition && (
              // Landing-paradigm underline convention (`.work-tabs .active`)
              // replaces the previous filled-pill toggle — same group/button
              // names, aria-pressed state, and click handlers, purely a
              // border-bottom-2 accent swap instead of a background swap.
              <div className="flex items-center gap-4" role="group" aria-label="Reader view">
                <button
                  type="button"
                  aria-pressed={!effectiveShowInteractive}
                  onClick={() => setShowInteractive(false)}
                  className="app-control border-b-2 pb-0.5 font-medium"
                  style={{
                    borderColor: !effectiveShowInteractive ? "var(--color-accent-ink)" : "transparent",
                    color: !effectiveShowInteractive ? "var(--color-text)" : "var(--color-text-muted)",
                  }}
                >
                  Published edition
                </button>
                <button
                  type="button"
                  aria-pressed={effectiveShowInteractive}
                  onClick={() => setShowInteractive(true)}
                  className="app-control border-b-2 pb-0.5 font-medium"
                  style={{
                    borderColor: effectiveShowInteractive ? "var(--color-accent-ink)" : "transparent",
                    color: effectiveShowInteractive ? "var(--color-text)" : "var(--color-text-muted)",
                  }}
                >
                  Interactive reader
                </button>
              </div>
            )}
            <button
              type="button"
              className="app-control"
              onClick={() =>
                addBookmark(
                  currentPositionRef.current ?? (isPdf ? { kind: "pdf", page: 1 } : { kind: "text", paragraphIndex: 0 }),
                )
              }
            >
              + Bookmark
            </button>
            {!embedded && (
              <WorkPicker
                currentWorkId={workId}
                active={splitWorkId !== null}
                onSelect={setSplitWorkId}
                onClear={() => setSplitWorkId(null)}
              />
            )}
            {showOutlineRail && (
              <button
                ref={outlineTriggerRef}
                type="button"
                className="app-control ml-auto"
                onClick={() => setShowOutline((v) => !v)}
                aria-pressed={showOutline}
              >
                {showOutline ? "Hide outline" : "Outline"}
              </button>
            )}
            <button
              ref={analysisTriggerRef}
              type="button"
              className={showOutlineRail ? "app-control" : "app-control ml-auto"}
              onClick={() => setShowAnalysis((v) => !v)}
              aria-pressed={showAnalysis}
            >
              {showAnalysis ? "Hide analysis" : "Analysis"}
              {effectiveShowInteractive && visibleEdition
                ? visibleEdition.passageAnnotations.length + visibleEdition.wholeWorkGuidance.length > 0 &&
                  ` (${visibleEdition.passageAnnotations.length + visibleEdition.wholeWorkGuidance.length})`
                : data.annotations.filter((a) => !a.hidden).length > 0 &&
                  ` (${data.annotations.filter((a) => !a.hidden).length})`}
            </button>
            <button ref={notesTriggerRef} type="button" className="app-control" onClick={() => setShowNotes((v) => !v)} aria-pressed={showNotes}>
              {showNotes ? "Hide my notes" : "My notes"}
            </button>
            {enablePhase18Rag && !embedded && (
              <button
                ref={ragTriggerRef}
                type="button"
                className="app-control"
                aria-expanded={showRagChat}
                aria-controls={ragPanelId}
                onClick={() => setShowRagChat((v) => !v)}
              >
                Ask Library
              </button>
            )}
          </div>}

          <div
            className="px-6 py-8"
            style={{
              ["--reader-font-size" as string]: `${readerFontSize}rem`,
            }}
          >
            {effectiveShowInteractive && visibleEdition ? <EditionReader edition={visibleEdition} onOpenAnnotation={openAnnotation} activeAnnotationId={activeAnnotationId} activeBlockId={activeReaderBlockId} highlights={data.highlights} notes={data.notes} scriptDisplay={enablePhase12Reader ? preferences.scriptDisplay : "original"} focusMode={readerFocus} pendingColor={pendingColor} onColorChange={setPendingColor} onPositionChange={enablePhase12Reader ? (position) => { const saved: Position = { kind: "processed", ...position }; currentPositionRef.current = saved; savePosition(saved); } : undefined} onCreateHighlight={enablePhase12Reader ? (anchor) => createHighlight({ kind: "processed", ...anchor }) : undefined} onCreateLinkedNote={enablePhase12Reader ? createLinkedNote : undefined} onLinkExistingNote={enablePhase12Reader ? linkExistingNote : undefined} /> : isPdf ? (
              data.fileUrl ? (
                <section aria-label="Published edition — original PDF"><p className="mb-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">Published edition · original PDF · immutable source</p><PdfReader
                  fileUrl={data.fileUrl}
                  highlights={data.highlights}
                  initialPage={initialPosition?.kind === "pdf" ? initialPosition.page : 1}
                  onPageChange={(page) => {
                    const saved: Position = { kind: "pdf", page };
                    currentPositionRef.current = saved;
                    savePosition(saved);
                  }}
                  onCreateHighlight={(a) => createHighlight({ kind: "pdf", ...a })}
                /></section>
              ) : (
                <p className="text-[var(--color-accent-burgundy)]">No file URL available.</p>
              )
            ) : data.mimeType === "text/plain" || data.mimeType === "text/markdown" ? (
              <OriginalTextReader
                sourceUrl={data.fileUrl}
                fallbackText={data.extractedText ?? ""}
                footnotes={data.footnotes}
                highlights={data.highlights}
                annotations={data.annotations}
                activeParagraph={initialPosition?.kind === "text" ? initialPosition.paragraphIndex : null}
                onParagraphInView={(paragraphIndex) => {
                  const saved: Position = { kind: "text", paragraphIndex };
                  currentPositionRef.current = saved;
                  savePosition(saved);
                }}
                onCreateHighlight={(a) => createHighlight({ kind: "text", ...a })}
                onOpenFootnote={(footnote) => {
                  footnoteTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
                  setActiveFootnote(footnote);
                }}
                onOpenAnnotation={openAnnotation}
              />
            ) : (
              <section aria-label="Published edition — original source file"><p className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">Published edition · immutable original source file</p><p className="mt-4 text-sm text-[var(--color-text-muted)]">This source format is preserved without rewriting it in the browser.</p>{data.fileUrl && <a className="mt-3 inline-block underline" href={data.fileUrl} download>Open immutable source file</a>}</section>
            )}
          </div>
        </div>

        {splitWorkId && (
          <div className="min-w-0 flex-1 resize-x overflow-auto">
            <div className="flex items-center justify-end border-b border-[var(--color-border)] px-2 py-1">
              <button type="button" className="text-xs underline" onClick={() => setSplitWorkId(null)}>
                Close split
              </button>
            </div>
            <ReaderShell workId={splitWorkId} embedded initialReaderLevel={initialReaderLevel} enablePhase12Identity={enablePhase12Identity} enablePhase12Reader={enablePhase12Reader} enablePhase18Rag={enablePhase18Rag} />
          </div>
        )}
      </div>

      {effectiveShowInteractive && (showAnalysis || readerFocus) && !embedded && (
        visibleEdition ? (
          <EditionAnnotationsPanel
            edition={visibleEdition}
            activeId={activeAnnotationId}
            readerLevel={editionReaderLevel}
            levelMode={editionLevelMode}
            enableLevelFilter={enablePhase12Identity || enablePhase12Reader}
            enablePhase12Reader={enablePhase12Reader}
            filters={editionFilters}
            onReaderLevelChange={setEditionReaderLevel}
            onLevelModeChange={setEditionLevelMode}
            onFiltersChange={setEditionFilters}
            onPreviousAnnotation={() => moveAnnotation(-1)}
            onNextAnnotation={() => moveAnnotation(1)}
            onApproveTerm={enablePhase12Reader ? (termId) => void approveTerm(termId) : undefined}
            onSelectAnnotation={openAnnotation}
            onClose={closeAnalysisPanel}
            flushTop={readerFocus}
          />
        ) : (
          <AnnotationsPanel
            annotations={data.annotations}
            analysisStatus={data.analysisStatus}
            analysisError={data.analysisError}
            activeId={activeAnnotationId}
            onUpdate={updateAnnotation}
            onReanalyze={reanalyze}
            onClose={closeAnalysisPanel}
          />
        )
      )}

      {showNotes && !readerFocus && (
        <NotesSidebar
          highlights={data.highlights}
          notes={data.notes}
          bookmarks={data.bookmarks}
          onDeleteHighlight={deleteHighlight}
          onAddNote={addNote}
          onDeleteNote={deleteNote}
          onDeleteBookmark={deleteBookmark}
          onSelectBookmark={selectBookmark}
          pendingHighlightIds={pendingNoteHighlightIds}
          onClose={closeNotesPanel}
        />
      )}

      {activeFootnote && <FootnoteModal footnote={activeFootnote} onClose={closeFootnote} />}

      {showRagChat && enablePhase18Rag && !embedded && <RagChatPanel id={ragPanelId} contextWorkId={workId} onClose={closeRagChat} dialogLabel="Ask Library — Reader panel" />}
    </div>
  );
}

type HighlightRecordAnchorInput =
  | { kind: "pdf"; page: number; quote: string; prefix: string; suffix: string }
  | { kind: "text"; paragraphIndex: number; quote: string; prefix: string; suffix: string }
  | { kind: "processed"; pageIndex: number; textBlockId: string; quote: string; prefix: string; suffix: string };

/** The original-note popup, brought to the same keyboard-dialog standard as
 * every other reader-shell disclosure (D-19-18/19/20): labelled `dialog`
 * role, initial focus on its close control, and Escape closing it while
 * restoring focus to the footnote marker that opened it. */
function FootnoteModal({ footnote, onClose }: { footnote: FootnoteRecord; onClose: () => void }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/20 p-4 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Original note [${footnote.marker}]`}
        className="app-panel-enter max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <p className="mb-1 text-xs font-medium text-[var(--color-accent-umber)]">
          Original note [{footnote.marker}]
        </p>
        <p className="text-[var(--color-text)]">{footnote.content}</p>
        <button ref={closeButtonRef} type="button" className="app-control mt-3 text-sm underline" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
