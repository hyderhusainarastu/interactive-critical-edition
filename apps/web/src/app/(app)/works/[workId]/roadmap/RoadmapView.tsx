"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  TIER_LABEL,
  TIER_ORDER,
  type Expertise,
  type PriorityTier,
  type ReadingStatus,
  type RoadmapItem,
  type RoadmapMode,
} from "@ice/roadmap";

interface RoadmapResponse {
  title: string;
  analysisStatus: string;
  rootWorkId: string;
  items: RoadmapItem[];
  totalReached: number;
}

// Tier → palette accent (shared with the reader's visual language).
const TIER_COLOR: Record<PriorityTier, string> = {
  essential: "--color-accent-burgundy",
  high: "--color-accent-ink",
  strongly_recommended: "--color-accent-green",
  contextual: "--color-accent-umber",
  interpretive_aid: "--color-accent-ink",
  comparative: "--color-accent-umber",
  optional: "--color-text-muted",
};

const READING_STATUSES: ReadingStatus[] = ["planned", "reading", "completed", "abandoned"];

export function RoadmapView({ workId, title }: { workId: string; title: string }) {
  const [data, setData] = useState<RoadmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RoadmapMode>("comprehensive");
  const [expertise, setExpertise] = useState<Expertise>("advanced");
  const [maxMinutes, setMaxMinutes] = useState<string>("");

  // Used by `mutate` to refetch after a change. Not called from the effect
  // (the set-state-in-effect rule flags calling any state-setting function
  // directly in an effect), so the initial/filter-change load is inlined
  // below with the `.then` pattern the rule accepts.
  const load = useCallback(async () => {
    const qs = new URLSearchParams({ mode, expertise });
    if (maxMinutes && Number(maxMinutes) > 0) qs.set("maxMinutes", String(Number(maxMinutes) * 60));
    try {
      const res = await fetch(`/api/works/${workId}/roadmap?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load roadmap");
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load roadmap");
    }
  }, [workId, mode, expertise, maxMinutes]);

  useEffect(() => {
    let ignore = false;
    const qs = new URLSearchParams({ mode, expertise });
    if (maxMinutes && Number(maxMinutes) > 0) qs.set("maxMinutes", String(Number(maxMinutes) * 60));
    fetch(`/api/works/${workId}/roadmap?${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load roadmap");
        return res.json();
      })
      .then((d) => {
        if (!ignore) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!ignore) setError(e instanceof Error ? e.message : "Failed to load roadmap");
      });
    return () => {
      ignore = true;
    };
  }, [workId, mode, expertise, maxMinutes]);

  const mutate = useCallback(
    async (bibId: string, patch: Record<string, unknown>) => {
      await fetch(`/api/works/${workId}/roadmap/item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bibId, ...patch }),
      });
      await load(); // recompute so the change is reflected in ranking/order
    },
    [workId, load],
  );

  const visible = data?.items ?? [];
  const byTier = TIER_ORDER.map((tier) => ({ tier, items: visible.filter((i) => i.tier === tier) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-1 flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
        <Link href={`/works/${workId}`} className="underline">
          ← {title}
        </Link>
      </div>
      <h1 className="mb-1 font-serif text-2xl font-semibold text-[var(--color-text)]">Reading roadmap</h1>
      <p className="mb-5 max-w-2xl text-sm text-[var(--color-text-muted)]">
        A dependency-ordered, priority-ranked plan built from this work&rsquo;s references and your knowledge profile.
        Rate what you already know or hide items — the order updates to match. An AI-assisted aid; verify against the
        sources.
      </p>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">Depth</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as RoadmapMode)} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
            <option value="comprehensive">Comprehensive</option>
            <option value="concise">Concise (essential + high)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">Level</span>
          <select value={expertise} onChange={(e) => setExpertise(e.target.value as Expertise)} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">Time budget (hours)</span>
          <input
            type="number"
            min={0}
            value={maxMinutes}
            onChange={(e) => setMaxMinutes(e.target.value)}
            placeholder="no limit"
            className="w-28 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
          />
        </label>
        <div className="ml-auto text-xs text-[var(--color-text-muted)]">
          {data ? `${visible.length} of ${data.totalReached} works` : ""}
        </div>
      </div>

      {error && <p className="text-[var(--color-accent-burgundy)]">{error}</p>}
      {!data && !error && <p className="text-[var(--color-text-muted)]">Computing roadmap…</p>}

      {data && data.analysisStatus !== "complete" && (
        <p className="mb-4 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          {data.analysisStatus === "analyzing"
            ? "Analysis is still running — the roadmap will fill in as references are classified."
            : "This work hasn't been analyzed yet, so there's nothing to build a roadmap from. Open the reader and run analysis first."}
        </p>
      )}

      {data && visible.length === 0 && data.analysisStatus === "complete" && (
        <p className="text-[var(--color-text-muted)]">
          No connected readings were found for this work{mode === "concise" ? " at this depth" : ""}.
        </p>
      )}

      {byTier.map(({ tier, items }) => (
        <section key={tier} className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide" style={{ color: `var(${TIER_COLOR[tier]})` }}>
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${TIER_COLOR[tier]})` }} />
            {TIER_LABEL[tier]}
          </h2>
          <ol className="flex flex-col gap-2">
            {items.map((item) => (
              <RoadmapCard key={item.bibId} item={item} onMutate={mutate} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function RoadmapCard({
  item,
  onMutate,
}: {
  item: RoadmapItem;
  onMutate: (bibId: string, patch: Record<string, unknown>) => void;
}) {
  const hours = Math.round(item.estimatedMinutes / 60);
  return (
    <li
      data-roadmap-item={item.bibId}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3"
      style={{ opacity: item.known || item.overBudget ? 0.6 : 1 }}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 min-w-6 text-sm font-semibold text-[var(--color-text-muted)]" aria-hidden>
          {item.sequence}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--color-text)]">
            {item.title}
            {item.year ? <span className="font-normal text-[var(--color-text-muted)]"> ({item.year})</span> : null}
          </p>
          {item.authors && <p className="text-xs text-[var(--color-text-muted)]">{item.authors}</p>}
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{item.reason}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span>~{hours > 0 ? `${hours}h` : `${item.estimatedMinutes}m`}</span>
            <span>·</span>
            <span>{Math.round(item.confidence * 100)}% confidence</span>
            {item.inLibrary ? (
              <span className="text-[var(--color-accent-green)]">· in your library</span>
            ) : (
              <span className="text-[var(--color-accent-burgundy)]">· not acquired</span>
            )}
            {item.known && <span className="text-[var(--color-accent-green)]">· review only</span>}
            {item.overBudget && <span>· over time budget</span>}
            {item.overridden && <span>· adjusted</span>}
          </div>

          {/* Controls */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1">
              <span className="text-[var(--color-text-muted)]">Understanding</span>
              <input
                type="range"
                min={0}
                max={100}
                step={10}
                defaultValue={item.known ? 80 : 0}
                onMouseUp={(e) => onMutate(item.bibId, { understandingScore: Number((e.target as HTMLInputElement).value) })}
                onTouchEnd={(e) => onMutate(item.bibId, { understandingScore: Number((e.target as HTMLInputElement).value) })}
                aria-label={`Understanding of ${item.title}`}
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-[var(--color-text-muted)]">Status</span>
              <select
                defaultValue={item.status ?? ""}
                onChange={(e) => onMutate(item.bibId, { readingStatus: e.target.value || null })}
                className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5"
                aria-label={`Reading status of ${item.title}`}
              >
                <option value="">—</option>
                {READING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="underline" onClick={() => onMutate(item.bibId, { hidden: true })}>
              Hide
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
