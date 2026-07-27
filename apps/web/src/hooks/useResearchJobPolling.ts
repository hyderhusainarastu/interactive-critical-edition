"use client";

import { useEffect, useRef } from "react";

/**
 * Item 1(b) of the Research-workspace live-updates lane: while at least one
 * tracked `research_job_request` row is non-terminal (planned/queued/
 * running), poll a fresh copy every ~3s; stop once every tracked row is
 * terminal (complete/failed/cancelled). Visibility-aware the same way
 * `KnowledgeGraph3D.tsx` already pauses its own render loop — `document.hidden`
 * / `visibilitychange` — so a backgrounded tab doesn't keep firing requests.
 */

export interface PollableJobRow {
  id: string;
  status: string;
}

const TERMINAL_STATUSES = new Set(["complete", "failed", "cancelled"]);

export function isTerminalJobStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

const DEFAULT_INTERVAL_MS = 3000;

export function useResearchJobPolling<T extends PollableJobRow>({
  rows,
  fetchRows,
  onUpdate,
  onComplete,
  intervalMs = DEFAULT_INTERVAL_MS,
}: {
  /** The caller's current snapshot of tracked job rows — read once per
   *  render only to decide whether polling should be running at all. */
  rows: T[];
  /** Fetches a fresh copy of (at least) the tracked rows. Returning `null`
   *  (e.g. a failed fetch) is treated as "try again next tick," not a
   *  terminal state. */
  fetchRows: () => Promise<T[] | null>;
  /** Called with every freshly fetched batch. */
  onUpdate: (rows: T[]) => void;
  /** Called with just the rows OBSERVED transitioning into "complete" this
   *  tick (never on an already-complete row simply being re-fetched) — the
   *  signal callers use to `router.refresh()` the whole route only when
   *  there's genuinely new output to show. */
  onComplete?: (justCompleted: T[]) => void;
  intervalMs?: number;
}) {
  const lastStatusById = useRef(new Map<string, string>());
  const fetchRowsRef = useRef(fetchRows);
  const onUpdateRef = useRef(onUpdate);
  const onCompleteRef = useRef(onComplete);

  // Keep the "latest callback" refs fresh, and seed the known-status map
  // from whatever rows the caller currently has, AFTER every render — never
  // during render itself (mutating a ref's `.current` while rendering is
  // disallowed; this must run as an effect). Seeding on every render (not
  // just once) is what keeps a freshly-dispatched job (e.g. right after a
  // "queued" POST lands in the caller's own state) from being misread as
  // already known the first time the poll loop below observes it.
  useEffect(() => {
    fetchRowsRef.current = fetchRows;
    onUpdateRef.current = onUpdate;
    onCompleteRef.current = onComplete;
    for (const row of rows) {
      if (!lastStatusById.current.has(row.id)) lastStatusById.current.set(row.id, row.status);
    }
  });

  const hasNonTerminal = rows.some((row) => !isTerminalJobStatus(row.status));

  useEffect(() => {
    if (!hasNonTerminal) return;

    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      if (document.hidden) return;
      const next = await fetchRowsRef.current();
      if (cancelled || !next) return;
      const justCompleted: T[] = [];
      for (const row of next) {
        const previous = lastStatusById.current.get(row.id);
        if (previous && previous !== "complete" && row.status === "complete") justCompleted.push(row);
        lastStatusById.current.set(row.id, row.status);
      }
      onUpdateRef.current(next);
      if (justCompleted.length > 0) onCompleteRef.current?.(justCompleted);
    }

    function start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
    }
    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    function handleVisibility() {
      if (document.hidden) stop();
      else start();
    }

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [hasNonTerminal, intervalMs]);
}
