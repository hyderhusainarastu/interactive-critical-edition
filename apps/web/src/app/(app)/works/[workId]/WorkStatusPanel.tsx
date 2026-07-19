"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/status";

type Status = "uploaded" | "processing" | "needs_review" | "ready" | "failed";

interface StatusPayload {
  title: string;
  authorName: string | null;
  status: Status;
  extractedTitle: string | null;
  extractedAuthor: string | null;
  processingError: string | null;
  processingRun: {
    version: number;
    stage: string | null;
    structureState: "full" | "limited";
    runStatus: "pending" | "running" | "complete" | "failed";
    published: boolean;
    note: string | null;
  } | null;
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!POLLING_STATUSES.includes(data.status)) return;

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
  }, [data.status, workId]);

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
    const response = await fetch(`/api/works/${workId}/reprocess`, { method: "POST" });
    if (response.ok) setData((current) => ({ ...current, status: "uploaded" }));
    else setError((await response.json().catch(() => ({}))).error ?? "Couldn’t start reprocessing.");
    setReprocessing(false);
  }

  if (POLLING_STATUSES.includes(data.status)) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-[var(--color-border)] px-4 py-3">
        <span
          className="h-2 w-2 animate-pulse rounded-full"
          style={{ background: STATUS_COLOR[data.status] }}
        />
        <span className="text-[var(--color-text)]">
          {STATUS_LABEL[data.status]} — extracting text and detecting
          metadata{data.processingRun?.stage ? ` (${data.processingRun.stage})` : ""}. This page updates automatically.
        </span>
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
        <button type="button" onClick={handleReprocess} disabled={reprocessing} className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] disabled:opacity-60">
          {reprocessing ? "Reprocessing…" : "Reprocess edition"}
        </button>
        <Link
          href={`/works/${workId}/roadmap`}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
        >
          Reading roadmap
        </Link>
        <Link
          href={`/works/${workId}/graph`}
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]"
        >
          Knowledge graph
        </Link>
        <Link
          href={`/works/${workId}/reader`}
          className="rounded-md bg-[var(--color-accent-ink)] px-4 py-2 text-sm text-[var(--color-background)]"
        >
          Open reader
        </Link>
      </div>
    </div>
  );
}
