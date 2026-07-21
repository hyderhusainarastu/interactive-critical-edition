"use client";

import { useState } from "react";
import type { BookmarkRecord, HighlightRecord, NoteRecord } from "./types";

function positionLabel(p: BookmarkRecord["position"]) {
  return p.kind === "pdf" ? `Page ${p.page}` : p.kind === "processed" ? `Processed page ${p.pageIndex + 1}` : `Paragraph ${p.paragraphIndex + 1}`;
}

export function NotesSidebar({
  highlights,
  notes,
  bookmarks,
  onDeleteHighlight,
  onAddNote,
  onDeleteNote,
  onDeleteBookmark,
  pendingHighlightIds = [],
}: {
  highlights: HighlightRecord[];
  notes: NoteRecord[];
  bookmarks: BookmarkRecord[];
  onDeleteHighlight: (id: string) => void;
  onAddNote: (body: string, highlightIds?: string[]) => void;
  onDeleteNote: (id: string) => void;
  onDeleteBookmark: (id: string) => void;
  pendingHighlightIds?: string[];
}) {
  const [draft, setDraft] = useState("");

  return (
    <aside className="w-72 shrink-0 border-l border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm">
      <section className="mb-6">
        <h2 className="mb-2 font-semibold text-[var(--color-text)]">Add a note</h2>
        {pendingHighlightIds.length > 0 && <p className="mb-2 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)]">This note will link to {pendingHighlightIds.length} selected passage{pendingHighlightIds.length === 1 ? "" : "s"}.</p>}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] p-2 text-sm"
          placeholder="Write a note about this work…"
        />
        <button
          type="button"
          disabled={!draft.trim()}
          onClick={() => {
            onAddNote(draft.trim(), pendingHighlightIds);
            setDraft("");
          }}
          className="mt-2 rounded-md bg-[var(--color-accent-ink)] px-3 py-1 text-xs text-[var(--color-background)] disabled:opacity-40"
        >
          Save note
        </button>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold text-[var(--color-text)]">
          Highlights <span className="text-[var(--color-text-muted)]">({highlights.length})</span>
        </h2>
        <ul className="flex flex-col gap-2">
          {highlights.map((h) => (
            <li key={h.id} className="rounded-md border border-[var(--color-border)] p-2">
              <p
                className="reader-highlight line-clamp-2 text-xs"
                style={{ background: "transparent" }}
              >
                <mark className={`reader-highlight-${h.color}`}>&ldquo;{h.anchor.quote}&rdquo;</mark>
              </p>
              <div className="mt-1 flex items-center justify-between text-[var(--color-text-muted)]">
                <span>
                  {h.anchor.kind === "pdf" ? `Page ${h.anchor.page}` : h.anchor.kind === "processed" ? `Processed page ${h.anchor.pageIndex + 1}` : `¶${h.anchor.paragraphIndex + 1}`}
                </span>
                <button type="button" onClick={() => onDeleteHighlight(h.id)} className="underline">
                  Remove
                </button>
              </div>
            </li>
          ))}
          {highlights.length === 0 && (
            <li className="text-[var(--color-text-muted)]">Select text in the reader to highlight it.</li>
          )}
        </ul>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 font-semibold text-[var(--color-text)]">
          Notes <span className="text-[var(--color-text-muted)]">({notes.length})</span>
        </h2>
        <ul className="flex flex-col gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md border border-[var(--color-border)] p-2">
              <p className="whitespace-pre-wrap text-[var(--color-text)]">{n.body}</p>
              {n.highlightIds.length > 0 && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Linked to {n.highlightIds.length} highlight{n.highlightIds.length === 1 ? "" : "s"}</p>}
              <button
                type="button"
                onClick={() => onDeleteNote(n.id)}
                className="mt-1 text-[var(--color-text-muted)] underline"
              >
                Delete
              </button>
            </li>
          ))}
          {notes.length === 0 && <li className="text-[var(--color-text-muted)]">No notes yet.</li>}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-[var(--color-text)]">
          Bookmarks <span className="text-[var(--color-text-muted)]">({bookmarks.length})</span>
        </h2>
        <ul className="flex flex-col gap-2">
          {bookmarks.map((b) => (
            <li key={b.id} className="flex items-center justify-between rounded-md border border-[var(--color-border)] p-2">
              <span>{b.label || positionLabel(b.position)}</span>
              <button type="button" onClick={() => onDeleteBookmark(b.id)} className="text-[var(--color-text-muted)] underline">
                Remove
              </button>
            </li>
          ))}
          {bookmarks.length === 0 && <li className="text-[var(--color-text-muted)]">No bookmarks yet.</li>}
        </ul>
      </section>
    </aside>
  );
}
