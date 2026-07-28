"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDialogEscape } from "@/components/primitives/useDialogEscape";
import { useFocusRestoration } from "@/components/primitives/useFocusRestoration";
import { useFocusTrap } from "@/components/primitives/useFocusTrap";
import { storePendingWriterInsertion, type WriterInsertionPayload } from "@/lib/writer/insertionHandoff";

type WriterProjectOption = { id: string; title: string };

/**
 * Integration step "writer-insertion-dialogs" (charter §6 "Write":
 * context-preserving insertion from Reader and Knowledge Map — explicitly
 * deferred by stage6-write-spec.md §11 to this pass). Renders only where
 * real quotable content already exists on the caller's own data (a claim's
 * text/excerpt) — never fabricates one. Fetches the user's own Writer
 * projects (`GET /api/writer/projects`, already exists) so the user can
 * pick a target, or create one inline (`POST /api/writer/projects`, already
 * exists) — no new endpoint needed for either. Stores the handoff via
 * `sessionStorage` (`insertionHandoff.ts`) and navigates to
 * `/writer/[projectId]`, where `WriterEditor.tsx` consumes it once on
 * mount.
 */
export function InsertIntoWriterButton({
  quote,
  attribution,
  sourceLabel,
  label = "Insert into Writer",
  className,
}: {
  /** The real, already-loaded excerpt — never constructed here. */
  quote: string;
  attribution: string;
  sourceLabel: WriterInsertionPayload["sourceLabel"];
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<WriterProjectOption[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [newTitle, setNewTitle] = useState("Untitled research project");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  const selectId = useId();
  const titleId = useId();
  const restoreFocus = useFocusRestoration(triggerRef);

  function close() {
    setOpen(false);
    setError(null);
    restoreFocus();
  }

  useFocusTrap(dialogRef, open);
  useDialogEscape(open, close);

  // Initial focus lands on the dialog container itself (its own real
  // content varies: a radio group, a select, or a title field, depending on
  // whether the user already has any Writer projects and whether the fetch
  // has settled yet) — a plain `Tab` from there reaches whichever control is
  // actually first, rather than guessing a specific field that may not be
  // the one rendered. Re-focuses whenever `open`/`loading` transitions so a
  // slow project fetch doesn't leave focus stranded on nothing.
  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open, loading]);

  async function openDialog() {
    setOpen(true);
    setError(null);
    if (projects !== null) return; // already fetched this mount
    setLoading(true);
    try {
      const response = await fetch("/api/writer/projects");
      const body = await response.json().catch(() => ({ projects: [] }));
      const rows: WriterProjectOption[] = response.ok && Array.isArray(body.projects) ? body.projects.map((p: { id: string; title: string }) => ({ id: p.id, title: p.title })) : [];
      setProjects(rows);
      if (rows.length > 0) setSelectedProjectId(rows[0].id);
      else setCreatingNew(true);
    } finally {
      setLoading(false);
    }
  }

  function proceed(targetProjectId: string) {
    storePendingWriterInsertion({
      projectId: targetProjectId,
      quote,
      attribution,
      sourceHref: window.location.href,
      sourceLabel,
    });
    router.push(`/writer/${targetProjectId}`);
  }

  async function submit() {
    setError(null);
    if (creatingNew) {
      const trimmed = newTitle.trim();
      if (!trimmed) return;
      setSubmitting(true);
      try {
        const response = await fetch("/api/writer/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: trimmed }),
        });
        const body = await response.json();
        if (!response.ok) {
          setError(body.error ?? "Could not create project.");
          return;
        }
        proceed(body.project.id as string);
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (!selectedProjectId) return;
    proceed(selectedProjectId);
  }

  return (
    <>
      <button ref={triggerRef} type="button" onClick={openDialog} className={className ?? "app-control underline"}>
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={close}>
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            tabIndex={-1}
            className="app-panel-enter w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id={headingId} className="font-serif text-lg font-semibold text-[var(--color-text)]">
              Insert into Writer
            </h2>
            <p className="app-control mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm italic text-[var(--color-text-muted)]">
              “{quote}”
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{attribution}</p>

            {loading ? (
              <p className="mt-4 text-sm text-[var(--color-text-muted)]">Loading your Writer projects…</p>
            ) : (
              <div className="mt-4">
                {projects && projects.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="writer-insertion-target"
                        checked={!creatingNew}
                        onChange={() => setCreatingNew(false)}
                      />
                      An existing project
                    </label>
                    {!creatingNew && (
                      <label htmlFor={selectId} className="sr-only">
                        Writer project
                      </label>
                    )}
                    {!creatingNew && (
                      <select
                        id={selectId}
                        value={selectedProjectId}
                        onChange={(event) => setSelectedProjectId(event.target.value)}
                        className="app-control ml-6 rounded border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
                      >
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.title}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="mt-1 flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="writer-insertion-target"
                        checked={creatingNew}
                        onChange={() => setCreatingNew(true)}
                      />
                      A new project
                    </label>
                  </div>
                )}
                {creatingNew && (
                  <div className={projects && projects.length > 0 ? "ml-6 mt-1.5" : ""}>
                    <label htmlFor={titleId} className="sr-only">
                      New project title
                    </label>
                    <input
                      id={titleId}
                      type="text"
                      value={newTitle}
                      onChange={(event) => setNewTitle(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      className="app-control w-full rounded border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>
            )}

            {error && <p className="mt-2 text-sm text-[var(--color-error,#b3261e)]">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button ref={cancelRef} type="button" onClick={close} className="app-control rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]">
                Cancel
              </button>
              <button
                type="button"
                disabled={loading || submitting || (creatingNew ? !newTitle.trim() : !selectedProjectId)}
                onClick={() => void submit()}
                className="app-control rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Working…" : "Insert into Writer"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
