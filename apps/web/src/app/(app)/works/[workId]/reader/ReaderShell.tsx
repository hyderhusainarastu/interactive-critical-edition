"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HIGHLIGHT_COLORS,
  type AnnotationRecord,
  type FootnoteRecord,
  type HighlightColor,
  type Position,
  type ReaderData,
} from "./types";
import { AnnotationsPanel } from "./AnnotationsPanel";
import { PdfReader } from "./PdfReader";
import { TextReader } from "./TextReader";
import { NotesSidebar } from "./NotesSidebar";
import { WorkPicker } from "./WorkPicker";
import { EditionReader, type EditionPayload } from "./EditionReader";

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
export function ReaderShell({ workId, embedded = false }: { workId: string; embedded?: boolean }) {
  const [data, setData] = useState<ReaderData | null>(null);
  const [edition, setEdition] = useState<EditionPayload | null>(null);
  const [showEdition, setShowEdition] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);
  const [distractionReduced, setDistractionReduced] = useState(false);
  const [fontSize, setFontSize] = useState(1.05);
  const [lineWidth, setLineWidth] = useState(66);
  const [pendingColor, setPendingColor] = useState<HighlightColor>("gold");
  const [activeFootnote, setActiveFootnote] = useState<FootnoteRecord | null>(null);
  const [showNotes, setShowNotes] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [splitWorkId, setSplitWorkId] = useState<string | null>(null);

  const positionTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const currentPositionRef = useRef<{ page?: number; paragraphIndex?: number }>({});

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
      .then((response) => { if (!ignore) setEdition(response.edition); })
      .catch(() => { /* legacy reader remains fully available */ });
    return () => {
      ignore = true;
    };
  }, [workId]);

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [theme]);

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
    async (body: string, highlightId?: string) => {
      const created = await jsonFetch<{
        id: string;
        highlightId: string | null;
        body: string;
        createdAt: string;
        updatedAt: string;
      }>(`/api/works/${workId}/reader/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, highlightId }),
      });
      setData((d) => (d ? { ...d, notes: [created, ...d.notes] } : d));
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
    },
    [workId],
  );

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
  }, []);

  const initialPosition = useMemo(() => data?.lastPosition ?? null, [data]);

  if (error) {
    return <p className="mx-auto max-w-xl px-6 py-12 text-[var(--color-accent-burgundy)]">{error}</p>;
  }
  if (!data) {
    return <p className="mx-auto max-w-xl px-6 py-12 text-[var(--color-text-muted)]">Loading…</p>;
  }

  const isPdf = data.mimeType === "application/pdf";

  return (
    <div data-reading-mode={distractionReduced ? "distraction-reduced" : undefined} className="flex min-h-screen">
      <div className={splitWorkId ? "flex flex-1 divide-x divide-[var(--color-border)]" : "flex flex-1"}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-4 border-b border-[var(--color-border)] px-4 py-2 text-sm">
            <strong className="text-[var(--color-text)]">{data.title}</strong>
            <div className="flex items-center gap-1" role="group" aria-label="Text size">
              <button type="button" onClick={() => setFontSize((s) => Math.max(0.85, s - 0.1))} aria-label="Decrease text size">
                A−
              </button>
              <button type="button" onClick={() => setFontSize((s) => Math.min(1.6, s + 0.1))} aria-label="Increase text size">
                A+
              </button>
            </div>
            <div className="flex items-center gap-1" role="group" aria-label="Line width">
              <button type="button" onClick={() => setLineWidth((w) => Math.max(44, w - 6))} aria-label="Narrower lines">
                ↔−
              </button>
              <button type="button" onClick={() => setLineWidth((w) => Math.min(96, w + 6))} aria-label="Wider lines">
                ↔+
              </button>
            </div>
            <button type="button" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            <button type="button" onClick={() => setDistractionReduced((v) => !v)} aria-pressed={distractionReduced}>
              {distractionReduced ? "Exit focus mode" : "Focus mode"}
            </button>
            {edition && (
              <button type="button" onClick={() => setShowEdition((value) => !value)} aria-pressed={showEdition}>
                {showEdition ? "Interactive reader" : "Published edition"}
              </button>
            )}
            <div className="flex items-center gap-1" role="group" aria-label="Highlight color">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`${c} highlight`}
                  aria-pressed={pendingColor === c}
                  onClick={() => setPendingColor(c)}
                  className="h-4 w-4 rounded-full border"
                  style={{
                    background: `var(--color-${c === "gold" ? "highlight" : `accent-${c}`})`,
                    borderColor: pendingColor === c ? "var(--color-text)" : "transparent",
                  }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                addBookmark(
                  isPdf
                    ? { kind: "pdf", page: currentPositionRef.current.page ?? 1 }
                    : { kind: "text", paragraphIndex: currentPositionRef.current.paragraphIndex ?? 0 },
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
            <button
              type="button"
              className="ml-auto"
              onClick={() => setShowAnalysis((v) => !v)}
              aria-pressed={showAnalysis}
            >
              {showAnalysis ? "Hide analysis" : "Analysis"}
              {data.annotations.filter((a) => !a.hidden).length > 0 &&
                ` (${data.annotations.filter((a) => !a.hidden).length})`}
            </button>
            <button type="button" onClick={() => setShowNotes((v) => !v)}>
              {showNotes ? "Hide notes" : "Notes"}
            </button>
          </div>

          <div
            className="px-6 py-8"
            style={{
              ["--reader-font-size" as string]: `${fontSize}rem`,
              ["--reader-line-width" as string]: `${lineWidth}ch`,
            }}
          >
            {showEdition && edition ? <EditionReader edition={edition} /> : isPdf ? (
              data.fileUrl ? (
                <PdfReader
                  fileUrl={data.fileUrl}
                  highlights={data.highlights}
                  initialPage={initialPosition?.kind === "pdf" ? initialPosition.page : 1}
                  onPageChange={(page) => {
                    currentPositionRef.current = { page };
                    savePosition({ kind: "pdf", page });
                  }}
                  onCreateHighlight={(a) => createHighlight({ kind: "pdf", ...a })}
                />
              ) : (
                <p className="text-[var(--color-accent-burgundy)]">No file URL available.</p>
              )
            ) : (
              <TextReader
                text={data.extractedText ?? ""}
                footnotes={data.footnotes}
                highlights={data.highlights}
                annotations={data.annotations}
                activeParagraph={initialPosition?.kind === "text" ? initialPosition.paragraphIndex : null}
                onParagraphInView={(paragraphIndex) => {
                  currentPositionRef.current = { paragraphIndex };
                  savePosition({ kind: "text", paragraphIndex });
                }}
                onCreateHighlight={(a) => createHighlight({ kind: "text", ...a })}
                onOpenFootnote={setActiveFootnote}
                onOpenAnnotation={openAnnotation}
              />
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
            <ReaderShell workId={splitWorkId} embedded />
          </div>
        )}
      </div>

      {showAnalysis && !embedded && (
        <AnnotationsPanel
          annotations={data.annotations}
          analysisStatus={data.analysisStatus}
          analysisError={data.analysisError}
          activeId={activeAnnotationId}
          onUpdate={updateAnnotation}
          onReanalyze={reanalyze}
        />
      )}

      {showNotes && (
        <NotesSidebar
          highlights={data.highlights}
          notes={data.notes}
          bookmarks={data.bookmarks}
          onDeleteHighlight={deleteHighlight}
          onAddNote={addNote}
          onDeleteNote={deleteNote}
          onDeleteBookmark={deleteBookmark}
        />
      )}

      {activeFootnote && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/20 p-4 sm:items-center"
          onClick={() => setActiveFootnote(null)}
        >
          <div
            className="max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-xs font-medium text-[var(--color-accent-umber)]">
              Original note [{activeFootnote.marker}]
            </p>
            <p className="text-[var(--color-text)]">{activeFootnote.content}</p>
            <button type="button" className="mt-3 text-sm underline" onClick={() => setActiveFootnote(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type HighlightRecordAnchorInput =
  | { kind: "pdf"; page: number; quote: string; prefix: string; suffix: string }
  | { kind: "text"; paragraphIndex: number; quote: string; prefix: string; suffix: string };
