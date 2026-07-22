"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/app/PageHeader";
import { PermanentDeleteDialog } from "./PermanentDeleteDialog";

interface TrashedWork {
  workId: string;
  title: string;
  authorName: string | null;
  deletedAt: string;
  daysRemaining: number;
  requiresTypedConfirmation: boolean;
  cleanupStatus: "in_progress" | "storage_failed" | null;
}

/**
 * The 30-day work trash (plan §34.4 9.7, permanent delete hardened in Phase
 * 20.3): trashed works with days-until-purge, Restore, and "Delete
 * permanently now" behind a named, typed-title-confirming dialog. Purging
 * expired entries — and retrying any unfinished deletion — happens
 * opportunistically server-side on every load of this page
 * (`GET /api/works/trash`, see `apps/web/src/lib/trash.ts`) — no scheduled
 * job, retry-safe by construction. A permanent delete's response is honest:
 * anything short of "every byte confirmed gone" keeps the work listed with
 * its retryable cleanup state instead of pretending success.
 */
export function TrashView() {
  const [items, setItems] = useState<TrashedWork[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingPurge, setConfirmingPurge] = useState<TrashedWork | null>(null);
  const [purging, setPurging] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const purgeTriggerRef = useRef<HTMLElement | null>(null);

  // `load` is used by `restore`/`purgeNow` to refetch after a mutation; the
  // initial load below is inlined with the `.then` pattern instead of
  // calling this from the effect directly (calling a state-setting async
  // function synchronously in an effect body is flagged by the
  // set-state-in-effect rule — same convention as RoadmapView/CurriculumView).
  const load = useCallback(async () => {
    const res = await fetch("/api/works/trash");
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load trash");
    const data = await res.json();
    setItems(data.items);
    setError(null);
  }, []);

  useEffect(() => {
    let ignore = false;
    fetch("/api/works/trash")
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load trash");
        return res.json();
      })
      .then((data) => {
        if (!ignore) {
          setItems(data.items);
          setError(null);
        }
      })
      .catch((e) => {
        if (!ignore) setError(e instanceof Error ? e.message : "Failed to load trash");
      });
    return () => {
      ignore = true;
    };
  }, []);

  async function restore(workId: string) {
    await fetch(`/api/works/${workId}/restore`, { method: "POST" });
    await load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load trash"));
  }

  function openPurgeDialog(item: TrashedWork, trigger: HTMLElement | null) {
    purgeTriggerRef.current = trigger;
    setStatusMessage(null);
    setConfirmingPurge(item);
  }

  function closePurgeDialog() {
    setConfirmingPurge(null);
    const trigger = purgeTriggerRef.current;
    purgeTriggerRef.current = null;
    window.requestAnimationFrame(() => trigger?.focus());
  }

  async function purgeNow(workId: string) {
    setPurging(true);
    try {
      const res = await fetch(`/api/works/${workId}/purge`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.ok) {
        setStatusMessage(null);
      } else {
        // Honest partial-failure status (Phase 20.3): never claim the
        // deletion finished when Storage cleanup did not.
        setStatusMessage(body.message ?? body.error ?? "Deletion could not finish. It is recorded and will be retried.");
      }
    } catch {
      setStatusMessage("Deletion could not finish. It is recorded and will be retried.");
    } finally {
      setPurging(false);
      setConfirmingPurge(null);
      purgeTriggerRef.current = null;
      await load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load trash"));
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-12">
      <PageHeader title="Trash" description="Restore a work within 30 days before its reader data, analysis, and uploaded file are permanently deleted." actions={<Link href="/works" className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)]">
          Your works
        </Link>} />

      {error && <p className="text-[var(--color-accent-burgundy)]">{error}</p>}
      {statusMessage && (
        <p role="status" className="rounded-md border border-[var(--color-credibility-warning)] px-4 py-3 text-sm text-[var(--color-text)]">
          {statusMessage}
        </p>
      )}
      {!items && !error && <p className="text-[var(--color-text-muted)]">Loading…</p>}

      {items && items.length === 0 && <p className="text-[var(--color-text-muted)]">Nothing in the trash.</p>}

      {items && items.length > 0 && (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
          {items.map((item) => (
            <li key={item.workId} data-trash-item={item.workId} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="font-medium text-[var(--color-text)]">
                  {item.title}
                  {item.authorName && <span className="font-normal text-[var(--color-text-muted)]"> — {item.authorName}</span>}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {item.daysRemaining > 0
                    ? `Permanently deleted in ${item.daysRemaining} day${item.daysRemaining === 1 ? "" : "s"}`
                    : "Eligible for permanent deletion"}
                </p>
                {item.cleanupStatus && (
                  <p className="text-xs text-[var(--color-credibility-warning)]">
                    Deletion incomplete — file cleanup pending. It will be retried automatically.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => restore(item.workId)}
                  className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text)]"
                >
                  Restore
                </button>
                <button
                  type="button"
                  onClick={(event) => openPurgeDialog(item, event.currentTarget)}
                  className="rounded-md border border-[var(--color-accent-burgundy)] px-3 py-1.5 text-sm text-[var(--color-accent-burgundy)]"
                >
                  Delete permanently now
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmingPurge && (
        <PermanentDeleteDialog
          title={confirmingPurge.title}
          requiresTypedConfirmation={confirmingPurge.requiresTypedConfirmation}
          busy={purging}
          onCancel={closePurgeDialog}
          onConfirm={() => purgeNow(confirmingPurge.workId)}
        />
      )}
    </div>
  );
}
