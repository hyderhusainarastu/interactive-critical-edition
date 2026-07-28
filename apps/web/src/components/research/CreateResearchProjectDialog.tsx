"use client";

import { useEffect, useId, useRef, useState } from "react";

type CreatedProject = { id: string; title: string };

/**
 * Stage 5 §5.1: replaces `ResearchProjectsView.tsx`'s `window.prompt` for
 * creating a project. Modeled directly on
 * `app/(app)/works/trash/PermanentDeleteDialog.tsx` — the existing,
 * already-tested hand-rolled dialog pattern this codebase uses everywhere a
 * headless-UI dependency would otherwise be reached for (no such dependency
 * exists here, see Stage 1 §5) — reusing the same Tab-cycle focus trap
 * inline (copying ~20 lines of already-working, already-reviewed logic
 * rather than extracting a shared hook outside this lane's file ownership).
 *
 * Unlike `PermanentDeleteDialog` (a destructive-confirmation flow whose
 * initial focus lands on the safe Cancel control), this is a creation flow:
 * initial focus lands on the title field itself. A submit failure renders
 * inline, inside the still-open dialog, with the typed title preserved —
 * nothing is lost and retry is just clicking Create again.
 */
export function CreateResearchProjectDialog({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (project: CreatedProject) => void;
}) {
  const [title, setTitle] = useState("Untitled research project");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const inputId = useId();

  const trimmedTitle = title.trim();
  const createEnabled = !creating && trimmedTitle.length > 0;

  useEffect(() => {
    // Initial focus on the field the user is about to type into — this is a
    // creation flow, not a destructive-confirmation one (see file comment).
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, []);

  async function submit() {
    if (!createEnabled) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/research/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create project.");
      onCreated(body.project as CreatedProject);
    } catch (err) {
      // Recoverable: the dialog stays open, the typed title is untouched,
      // and retry is just clicking Create again.
      setError(err instanceof Error ? err.message : "Could not create project.");
      setCreating(false);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])")]
      .filter((element) => !element.hidden && element.getClientRects().length > 0);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className="app-panel-enter w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 id={headingId} className="font-serif text-lg font-semibold text-[var(--color-text)]">
          New research project
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Give this project a working title — you can rename it later.</p>
        <div className="mt-4">
          <label htmlFor={inputId} className="block text-sm font-medium text-[var(--color-text)]">
            Project title
          </label>
          <input
            ref={titleInputRef}
            id={inputId}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
            autoComplete="off"
            spellCheck={false}
            className="app-control mt-1 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm text-[var(--color-text)]"
          />
        </div>
        {error && <p className="mt-2 text-sm text-[var(--color-error,#b3261e)]">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="app-control rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]">
            Cancel
          </button>
          <button
            type="button"
            disabled={!createEnabled}
            onClick={() => void submit()}
            className="app-control rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </section>
    </div>
  );
}
