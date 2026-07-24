"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { STAGE_LABEL, stageSequenceForPipeline } from "@ice/config";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/status";

type Status = "uploaded" | "processing" | "needs_review" | "ready" | "failed";

interface StatusPayload {
  title: string;
  authorName: string | null;
  status: Status;
  extractedTitle: string | null;
  extractedAuthor: string | null;
  processingError: string | null;
  /** Non-null when this work is trashed (plan §34.4 9.7). */
  deletedAt: string | null;
  processingRun: {
    version: number;
    pipelineVersion: string;
    stage: string | null;
    /** Non-null only while `stage` is inside the per-source discovery/
     * classification loop (up to ~120 sources) — lets the active step show
     * "source 3 of 12" instead of the checklist un-ticking and re-ticking
     * once per source. Optional — the server-rendered initial payload omits
     * it and the 2-second poll fills it in, same precedent as `stalled`. */
    stageSourceIndex?: number | null;
    stageSourceTotal?: number | null;
    structureState: "full" | "limited";
    runStatus: "pending" | "running" | "complete" | "failed";
    published: boolean;
    note: string | null;
  } | null;
  /** Phase 20.5: true when the latest run has stopped making progress (the
   * worker heartbeats it every minute while alive), so "processing" is
   * actually a dead run needing recovery. Optional — the server-rendered
   * initial payload omits it and the 2-second poll fills it in. */
  stalled?: boolean;
}

/**
 * Discrete, honest step list for server-side edition processing (plan §36
 * 11.3) — never a fake percentage. Driven by the real ordered stage
 * sequence the worker actually sets on `processing_run.stage`
 * (`@ice/config`'s `stageSequenceForPipeline`, shared with the worker so
 * this list can never promise a stage that isn't really emitted).
 */
function StageProgress({
  pipelineVersion,
  currentStage,
  stageSourceIndex,
  stageSourceTotal,
}: {
  pipelineVersion: string;
  currentStage: string | null;
  stageSourceIndex?: number | null;
  stageSourceTotal?: number | null;
}) {
  const sequence = stageSequenceForPipeline(pipelineVersion);
  const currentIndex = currentStage ? sequence.indexOf(currentStage) : -1;
  // Also require a real active step: during the sweep's non-transactional
  // window (processing_run already "failed", documents.processingStatus
  // still briefly "processing") stale, non-null counters must not render the
  // explainer detached from any highlighted step. "failed" isn't in the
  // sequence, so currentIndex is -1 there and this gate correctly suppresses it.
  const hasSourceProgress = currentIndex >= 0 && Boolean(stageSourceIndex) && Boolean(stageSourceTotal);
  return (
    <>
      <ol className="mt-2 flex flex-col gap-1 text-sm">
        {sequence.map((stage, i) => {
          const done = currentIndex >= 0 && i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={stage} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[0.6rem]"
                style={{
                  borderColor: done || active ? "var(--color-accent-ink)" : "var(--color-border)",
                  background: done ? "var(--color-accent-ink)" : "transparent",
                  color: done ? "var(--color-background)" : "var(--color-text-muted)",
                }}
              >
                {done ? "✓" : ""}
              </span>
              <span
                className={active ? "font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}
              >
                {STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage}
                {active ? "…" : ""}
                {active && hasSourceProgress ? ` — source ${stageSourceIndex} of ${stageSourceTotal}` : ""}
              </span>
            </li>
          );
        })}
      </ol>
      {hasSourceProgress && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          These steps repeat once per discovered source.
        </p>
      )}
    </>
  );
}

const POLLING_STATUSES: Status[] = ["uploaded", "processing"];

export function WorkStatusPanel({
  workId,
  initial,
}: {
  workId: string;
  initial: StatusPayload;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [confirmingTrash, setConfirmingTrash] = useState(false);
  const [trashing, setTrashing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleTrash() {
    setTrashing(true);
    const res = await fetch(`/api/works/${workId}`, { method: "DELETE" });
    setTrashing(false);
    setConfirmingTrash(false);
    if (res.ok) setData((current) => ({ ...current, deletedAt: new Date().toISOString() }));
    else setError((await res.json().catch(() => ({}))).error ?? "Couldn't move this to trash.");
  }

  async function handleRestore() {
    const res = await fetch(`/api/works/${workId}/restore`, { method: "POST" });
    if (res.ok) setData((current) => ({ ...current, deletedAt: null }));
    else setError((await res.json().catch(() => ({}))).error ?? "Couldn't restore this work.");
  }

  useEffect(() => {
    if (data.deletedAt || !POLLING_STATUSES.includes(data.status)) return;

    // setInterval, not setTimeout: a one-shot timeout only re-arms when the
    // effect re-runs, but the effect's deps ([data.status]) don't change
    // while a work sits in "processing" — so the old code polled exactly
    // once and then froze until a manual refresh. An interval keeps firing
    // every 2s; when the status finally reaches a terminal state the effect
    // re-runs, the cleanup clears the interval, and polling stops.
    const id = setInterval(async () => {
      const res = await fetch(`/api/works/${workId}/status`);
      if (res.ok) {
        const next = (await res.json()) as StatusPayload;
        setData(next);
      }
    }, 2000);

    return () => clearInterval(id);
  }, [data.status, data.deletedAt, workId]);

  async function handleConfirm(formData: FormData) {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/works/${workId}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: formData.get("title"),
        authorName: formData.get("authorName"),
      }),
    });
    if (!res.ok) {
      setError("Couldn't save — try again.");
      setSaving(false);
      return;
    }
    router.refresh();
    setData((d) => ({ ...d, status: "ready" }));
  }

  async function handleReprocess() {
    setReprocessing(true);
    setError(null);
    const response = await fetch(`/api/works/${workId}/reprocess`, { method: "POST" });
    // 202 covers "queued", "already queued" (deduplicated repeat click), and
    // stale-job recovery alike — all mean an attempt is now pending, so show
    // the polling state and let the status endpoint report real progress.
    if (response.ok) setData((current) => ({ ...current, status: "uploaded", stalled: false }));
    else setError((await response.json().catch(() => ({}))).error ?? "Couldn’t start reprocessing.");
    setReprocessing(false);
  }

  if (data.deletedAt) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-4 py-3">
        <div>
          <p className="font-medium text-[var(--color-accent-burgundy)]">In trash</p>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            The reader, roadmap, curriculum, and graph for this work are unavailable while trashed. Restore it, or
            manage it from the{" "}
            <Link href="/works/trash" className="underline">
              Trash
            </Link>
            .
          </p>
          {error && <p className="mt-1 text-sm text-[var(--color-accent-burgundy)]">{error}</p>}
        </div>
        <button
          type="button"
          onClick={handleRestore}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
        >
          Undo move to trash
        </button>
      </div>
    );
  }

  if (POLLING_STATUSES.includes(data.status)) {
    return (
      <div className="rounded-md border border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            className="h-2 w-2 flex-none animate-pulse rounded-full"
            style={{ background: STATUS_COLOR[data.status] }}
          />
          <span className="text-[var(--color-text)]">
            {STATUS_LABEL[data.status]} — this page updates automatically.
          </span>
        </div>
        {data.processingRun && (
          <StageProgress
            pipelineVersion={data.processingRun.pipelineVersion}
            currentStage={data.processingRun.stage}
            stageSourceIndex={data.processingRun.stageSourceIndex}
            stageSourceTotal={data.processingRun.stageSourceTotal}
          />
        )}
        {data.stalled && (
          <div className="mt-3 border-t border-[var(--color-border)] pt-3">
            <p className="text-sm font-medium text-[var(--color-accent-burgundy)]">Processing appears to have stalled</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              The run has stopped reporting progress — the worker likely restarted mid-run. Your original
              uploaded file is retained unchanged; retrying starts a fresh run from it, and any previously
              published edition stays available until the new run succeeds.
            </p>
            {error && <p className="mt-1 text-sm text-[var(--color-accent-burgundy)]">{error}</p>}
            <button
              type="button"
              onClick={handleReprocess}
              disabled={reprocessing}
              className="mt-2 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] disabled:opacity-60"
            >
              {reprocessing ? "Retrying…" : "Retry processing"}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (data.status === "failed") {
    return (
      <div className="rounded-md border border-[var(--color-border)] px-4 py-3">
        <p className="font-medium text-[var(--color-accent-burgundy)]">
          Processing failed
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {data.processingError ?? "An unknown error occurred."}
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Your original uploaded file is retained unchanged. Retrying restarts processing from it, and any
          previously published edition stays available until a new run succeeds.
        </p>
        {error && <p className="mt-1 text-sm text-[var(--color-accent-burgundy)]">{error}</p>}
        <button
          type="button"
          onClick={handleReprocess}
          disabled={reprocessing}
          className="mt-3 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] disabled:opacity-60"
        >
          {reprocessing ? "Retrying…" : "Retry processing"}
        </button>
      </div>
    );
  }

  if (data.status === "needs_review") {
    return (
      <form
        action={handleConfirm}
        className="flex flex-col gap-4 rounded-md border border-[var(--color-border)] p-4"
      >
        <p className="text-sm text-[var(--color-text-muted)]">
          Confirm or correct the detected metadata before this work is added
          to your library.
        </p>
        <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
          Title
          <input
            name="title"
            defaultValue={data.extractedTitle ?? data.title}
            required
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--color-text)]">
          Author
          <input
            name="authorName"
            defaultValue={data.extractedAuthor ?? data.authorName ?? ""}
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2"
          />
        </label>
        {error && (
          <p className="text-sm text-[var(--color-accent-burgundy)]">{error}</p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="w-fit rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)] disabled:opacity-60"
        >
          {saving ? "Saving…" : "Confirm and add to library"}
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-4 py-3">
      <div>
        <p className="font-medium text-[var(--color-accent-green)]">Ready</p>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {data.authorName ? `${data.title} — ${data.authorName}` : data.title}
        </p>
        {data.processingRun && (
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Edition run v{data.processingRun.version} · {data.processingRun.structureState === "full" ? "full structure" : "structure-limited fallback"}
          </p>
        )}
        {error && <p className="mt-1 text-sm text-[var(--color-accent-burgundy)]">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex flex-col items-start">
          <button type="button" onClick={handleReprocess} disabled={reprocessing} className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] disabled:opacity-60">
            {reprocessing ? "Reprocessing…" : "Reprocess edition"}
          </button>
          {/* Static, honest range from the plan's own cost posture (§34.5) —
           *  not a per-work prediction, since nothing exists to predict a
           *  specific work's cost before a run actually happens. */}
          <span className="mt-0.5 text-xs text-[var(--color-text-muted)]">Typically $0.50–$2, hard cap $5</span>
        </span>
        <Link
          href={`/works/${workId}/roadmap`}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
        >
          Reading roadmap
        </Link>
        <Link
          href={`/works/${workId}/diagnostic`}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
        >
          Concept check
        </Link>
        <Link
          href={`/works/${workId}/curriculum`}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
        >
          Curriculum
        </Link>
        <Link
          href={`/works/${workId}/graph`}
          aria-label={`Visualization for ${data.title}`}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
        >
          Visualization
        </Link>
        <Link
          href={`/works/${workId}/reader`}
          className="rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)]"
        >
          Open reader
        </Link>
        {confirmingTrash ? (
          <span className="flex items-center gap-2 text-sm">
            <span className="text-[var(--color-text-muted)]">Move to trash? Restorable for 30 days.</span>
            <button
              type="button"
              onClick={handleTrash}
              disabled={trashing}
              className="rounded-md border border-[var(--color-accent-burgundy)] px-3 py-1.5 text-[var(--color-accent-burgundy)] disabled:opacity-60"
            >
              {trashing ? "Moving…" : "Yes, move to trash"}
            </button>
            <button type="button" onClick={() => setConfirmingTrash(false)} className="underline">
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingTrash(true)}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)]"
          >
            Move to trash
          </button>
        )}
      </div>
    </div>
  );
}
