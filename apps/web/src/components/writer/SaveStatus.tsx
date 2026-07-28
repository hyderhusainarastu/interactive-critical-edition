"use client";

/**
 * Stage 6 spec §4.4: the exhaustive save-status states. The three base
 * strings ("Saved", "Saving…", "Save failed") are byte-for-byte unchanged
 * from pre-Stage-6 `WriterEditor.tsx` — `writer.spec.ts`'s existing
 * `getByRole("status")).toHaveText("Saved", ...)` assertions keep passing
 * against this component's rendered text with no edit needed, since no
 * button renders alongside the settled "Saved" state. "Editing" is an
 * internal state name that drives the autosave debounce gate elsewhere;
 * this component doesn't attach any extra affordance to it and renders it
 * exactly as today (spec §4.1: "stays that way").
 *
 * "Edited elsewhere" is new in this integration pass (§4.3's flagged
 * follow-up, now implemented as `saveWriterDocumentIfCurrent`'s real 409
 * contract): a DIFFERENT signal from "Edited in another tab" — the latter
 * is this browser's own same-origin `BroadcastChannel` catching a sibling
 * tab's save, while "Edited elsewhere" is the server itself reporting that
 * `expectedUpdatedAt` no longer matches, which can only happen from a
 * genuinely different browser/device (or a tab this `BroadcastChannel`
 * couldn't reach). Kept as a distinct string rather than reusing "Edited in
 * another tab" so the copy never claims more certainty about WHERE the
 * other edit came from than this tab can actually know — but both variants
 * share the identical recovery actions (§4.3), since the correct response
 * is the same either way.
 */
export type SaveState = "Saved" | "Saving…" | "Editing" | "Save failed" | "Edited in another tab" | "Edited elsewhere";

const CONFLICT_STATES: readonly SaveState[] = ["Edited in another tab", "Edited elsewhere"];

export function SaveStatus({
  status,
  onRetry,
  onKeepEditingHere,
  onReloadDocument,
}: {
  status: SaveState;
  /** §4.2: re-runs the identical `saveNow()` path with the draft's current
   *  (not stale) content — the caller is responsible for that freshness,
   *  this component just wires the click. */
  onRetry: () => void;
  /** §4.3: dismiss the conflict banner and resume plain last-write-wins —
   *  no capability regresses. Shared by both conflict variants. */
  onKeepEditingHere: () => void;
  /** §4.3: discard local edits and pick up the other tab's/device's saved
   *  content. Shared by both conflict variants. */
  onReloadDocument: () => void;
}) {
  const isConflict = CONFLICT_STATES.includes(status);
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]" role="status">
      <span>{status}</span>
      {status === "Save failed" && (
        <button type="button" className="app-control app-press min-h-11 rounded border border-[var(--color-border)] px-2" onClick={onRetry}>
          Retry
        </button>
      )}
      {isConflict && (
        <>
          <button type="button" className="app-control app-press underline" onClick={onKeepEditingHere}>
            Keep editing here
          </button>
          <button type="button" className="app-control app-press underline" onClick={onReloadDocument}>
            Reload this document
          </button>
        </>
      )}
    </span>
  );
}
