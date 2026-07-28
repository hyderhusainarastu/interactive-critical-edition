"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/status";
import { queueGroupFor, tabDisabledReason, type WorkProcessingStatus, type WorkQueueGroup } from "@/components/read/workAttention";

export interface QueueWorkItem {
  workId: string;
  title: string;
  authorName: string | null;
  status: WorkProcessingStatus;
  updatedAt: string | null;
  stalled: boolean;
}

type SortMode = "recent" | "title" | "author";

const GROUP_LABEL: Record<WorkQueueGroup, string> = {
  attention: "Needs your attention",
  in_progress: "In progress",
  ready: "Ready to read",
};
const GROUP_ORDER: WorkQueueGroup[] = ["attention", "in_progress", "ready"];

/**
 * Reading Queue rendering (Stage 4 spec §2.2). The server component
 * (`page.tsx`) fetches the same base query as before, plus the
 * stall-detection this file's own doc comment on `workAttention.ts`
 * explains; every grouping/search/sort/retry decision below is client-side
 * display state over that one fetch — a display list, not a second
 * server-authoritative search surface the way `/library`'s own richer
 * search is.
 */
export function ReadingQueueView({ items }: { items: QueueWorkItem[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [collapsed, setCollapsed] = useState<Partial<Record<WorkQueueGroup, boolean>>>({});
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [retryError, setRetryError] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) || (item.authorName ?? "").toLowerCase().includes(needle),
    );
  }, [items, query]);

  const grouped = useMemo(() => {
    const groups: Record<WorkQueueGroup, QueueWorkItem[]> = { attention: [], in_progress: [], ready: [] };
    for (const item of filtered) groups[queueGroupFor(item)].push(item);
    if (sort === "title") groups.ready.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "author") groups.ready.sort((a, b) => (a.authorName ?? "").localeCompare(b.authorName ?? ""));
    else groups.ready.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return groups;
  }, [filtered, sort]);

  async function retry(workId: string) {
    setRetrying((current) => ({ ...current, [workId]: true }));
    setRetryError((current) => ({ ...current, [workId]: "" }));
    const res = await fetch(`/api/works/${workId}/reprocess`, { method: "POST" });
    setRetrying((current) => ({ ...current, [workId]: false }));
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setRetryError((current) => ({ ...current, [workId]: body.error ?? "Couldn't start reprocessing." }));
    }
  }

  if (items.length === 0) {
    return (
      <p className="app-empty app-mount rounded-lg px-5 py-8 text-[var(--color-text-muted)]">
        Nothing uploaded yet.{" "}
        <Link href="/upload" className="underline">
          Upload your first work
        </Link>{" "}
        to get started.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex-1 min-w-[12rem]">
          <span className="sr-only">Search your uploaded works</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by title or author…"
            className="app-control w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortMode)}
            className="app-control app-select rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
          >
            <option value="recent">Recent</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
          </select>
        </label>
      </div>

      {filtered.length === 0 && (
        <p className="app-empty app-mount rounded-lg px-5 py-8 text-[var(--color-text-muted)]">
          No uploaded works match &ldquo;{query}&rdquo;.
        </p>
      )}

      {GROUP_ORDER.map((group) => {
        const groupItems = grouped[group];
        if (groupItems.length === 0) return null;
        const isCollapsed = collapsed[group] ?? false;
        return (
          <section key={group}>
            <button
              type="button"
              onClick={() => setCollapsed((current) => ({ ...current, [group]: !isCollapsed }))}
              aria-expanded={!isCollapsed}
              className="app-control flex w-full items-center gap-2 border-b border-[var(--color-border)] pb-2 text-left text-sm font-semibold uppercase tracking-wide text-[var(--color-text)]"
            >
              <span aria-hidden>{isCollapsed ? "▸" : "▾"}</span>
              {GROUP_LABEL[group]} ({groupItems.length})
            </button>
            {!isCollapsed && (
              <ul className="app-reveal-stagger mt-3 flex flex-col gap-3">
                {groupItems.map((item) => (
                  <QueueRow
                    key={item.workId}
                    item={item}
                    retrying={Boolean(retrying[item.workId])}
                    error={retryError[item.workId]}
                    onRetry={() => retry(item.workId)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function QueueRow({
  item,
  retrying,
  error,
  onRetry,
}: {
  item: QueueWorkItem;
  retrying: boolean;
  error?: string;
  onRetry: () => void;
}) {
  const group = queueGroupFor(item);
  const reason = tabDisabledReason({ status: item.status, deletedAt: null });
  const canRetry = item.status === "failed" || (item.status === "processing" && item.stalled);

  return (
    <li className="app-card app-lift app-mount overflow-hidden rounded-lg">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link
          href={group === "ready" ? `/works/${item.workId}/reader` : `/works/${item.workId}`}
          className="app-press min-w-0 flex-1"
        >
          <span className="font-medium text-[var(--color-text)]">{item.title}</span>
          {item.authorName && <span className="text-[var(--color-text-muted)]"> — {item.authorName}</span>}
        </Link>
        <span className="text-sm font-medium" style={{ color: STATUS_COLOR[item.status] }}>
          {item.stalled && item.status === "processing" ? "Stalled" : STATUS_LABEL[item.status]}
        </span>
        {canRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="app-control rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] disabled:opacity-60"
          >
            {retrying ? "Retrying…" : "Retry"}
          </button>
        ) : reason && group !== "ready" ? (
          <Link href={`/works/${item.workId}`} className="app-control text-xs underline text-[var(--color-text-muted)]">
            {group === "attention" ? "Review" : reason}
          </Link>
        ) : null}
      </div>
      {error && <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-accent-burgundy)]">{error}</p>}
    </li>
  );
}
