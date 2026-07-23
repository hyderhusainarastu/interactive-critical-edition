"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import {
  TIER_LABEL,
  TIER_ORDER,
  type ReaderLevel,
  type ReaderLevelFilter,
  type ReaderLevelMatchMode,
  type ReadingStatus,
  type RoadmapItem,
  type RoadmapMode,
} from "@ice/roadmap";
import { TIER_COLOR, TierDot } from "@/components/shared/roadmapPrimitives";

interface RoadmapResponse {
  title: string;
  analysisStatus: string;
  rootWorkId: string;
  items: RoadmapItem[];
  totalReached: number;
  levelCounts: Record<ReaderLevelFilter, number>;
  hiddenItems: Array<{ bibId: string; title: string; authors: string | null; year: number | null }>;
}

interface SearchResult {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
}

const READER_LEVEL_LABEL: Record<ReaderLevelFilter, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
  all: "Show all levels",
};
const READER_LEVEL_OPTIONS: ReaderLevelFilter[] = ["beginner", "undergraduate", "advanced", "research", "all"];

// Tier → palette accent lives in the shared roadmap primitives module
// (Phase 22.1), so the landing showcase and this view use one mapping.

const READING_STATUSES: ReadingStatus[] = ["planned", "reading", "completed", "abandoned"];

export function RoadmapView({
  workId,
  title,
  initialReaderLevel = "research",
  enablePhase12Identity = false,
}: {
  workId: string;
  title: string;
  /** The reader's saved global level, or "research" (full view) if they
   *  never chose one. Selecting a different level here is a page-local view
   *  filter only — it never overwrites the saved global level (plan §34.4:
   *  "Browsing alone never silently changes a level"). */
  initialReaderLevel?: ReaderLevel;
  enablePhase12Identity?: boolean;
}) {
  const [data, setData] = useState<RoadmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<RoadmapMode>("comprehensive");
  const [readerLevel, setReaderLevel] = useState<ReaderLevelFilter>(initialReaderLevel);
  const [levelMode, setLevelMode] = useState<ReaderLevelMatchMode>("cumulative");
  const [maxMinutes, setMaxMinutes] = useState<string>("");
  // Manual add (D-22-3): a progressive-disclosure search box — collapsed
  // by default, revealed on request, matching the site-wide preference
  // for summary-first controls (owner directive B).
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [addResults, setAddResults] = useState<SearchResult[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const controlsRevealRef = useScrollReveal<HTMLDivElement>();
  const loadingRevealRef = useScrollReveal<HTMLParagraphElement>();

  // Used by `mutate` to refetch after a change. Not called from the effect
  // (the set-state-in-effect rule flags calling any state-setting function
  // directly in an effect), so the initial/filter-change load is inlined
  // below with the `.then` pattern the rule accepts.
  const load = useCallback(async () => {
    const qs = new URLSearchParams({ mode, readerLevel });
    if (enablePhase12Identity) qs.set("levelMode", levelMode);
    if (maxMinutes && Number(maxMinutes) > 0) qs.set("maxMinutes", String(Number(maxMinutes) * 60));
    try {
      const res = await fetch(`/api/works/${workId}/roadmap?${qs}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load roadmap");
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load roadmap");
    }
  }, [workId, mode, readerLevel, levelMode, maxMinutes, enablePhase12Identity]);

  useEffect(() => {
    let ignore = false;
    const qs = new URLSearchParams({ mode, readerLevel });
    if (enablePhase12Identity) qs.set("levelMode", levelMode);
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
  }, [workId, mode, readerLevel, levelMode, maxMinutes, enablePhase12Identity]);

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

  // Manual-add search (D-22-3): control -> URL query param -> matching
  // catalog rows -> rendered result list. Debounced so it isn't a request
  // per keystroke; a stale-response guard (`ignore`) keeps a fast-typed
  // later query from being clobbered by an earlier one that resolves late.
  useEffect(() => {
    // Below the query-length threshold there is nothing to fetch; the
    // render below already gates on the same threshold, so no reset
    // (setState) is needed here — avoids a synchronous setState in an
    // effect body (this codebase's own set-state-in-effect lint rule).
    if (!showAddSearch || addQuery.trim().length < 2) return;
    let ignore = false;
    const timer = setTimeout(() => {
      fetch(`/api/works/${workId}/roadmap/search?q=${encodeURIComponent(addQuery.trim())}`)
        .then(async (res) => {
          if (!res.ok) throw new Error("Search failed");
          return res.json();
        })
        .then((d: { results: SearchResult[] }) => {
          if (!ignore) {
            setAddResults(d.results);
            setAddError(null);
          }
        })
        .catch((e) => {
          if (!ignore) setAddError(e instanceof Error ? e.message : "Search failed");
        });
    }, 300);
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [workId, showAddSearch, addQuery]);

  const addManually = useCallback(
    async (bibId: string) => {
      await fetch(`/api/works/${workId}/roadmap/item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bibId, addedManually: true, hidden: false }),
      });
      setAddQuery("");
      setAddResults([]);
      setShowAddSearch(false);
      await load();
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
        Rate what you already know or hide items — the order updates to match. An automated ranking aid; verify against
        the sources.
      </p>

      {/* Controls */}
      <div ref={controlsRevealRef} className="app-reveal mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">Depth</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as RoadmapMode)} className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
            <option value="comprehensive">Comprehensive</option>
            <option value="concise">Concise (essential + high)</option>
          </select>
        </label>
        {enablePhase12Identity && readerLevel !== "all" && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--color-text-muted)]">Level match</span>
            <select
              value={levelMode}
              onChange={(event) => setLevelMode(event.target.value as ReaderLevelMatchMode)}
              className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
            >
              <option value="cumulative">Selected + foundations</option>
              <option value="exact">Exact level</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">
            Level
            {readerLevel !== "all" && (
              <span className="ml-1 text-[var(--color-text-muted)]">
                (never hides anything you can&rsquo;t also see — pick &ldquo;Show all levels&rdquo; anytime)
              </span>
            )}
          </span>
          <select
            value={readerLevel}
            onChange={(e) => setReaderLevel(e.target.value as ReaderLevelFilter)}
            className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
          >
            {READER_LEVEL_OPTIONS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {READER_LEVEL_LABEL[lvl]}
                {data ? ` (${data.levelCounts[lvl]})` : ""}
              </option>
            ))}
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
            className="app-control w-28 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
          />
        </label>
        <div className="ml-auto text-xs text-[var(--color-text-muted)]">
          {data ? `${visible.length} of ${data.totalReached} works` : ""}
        </div>
      </div>

      {/* Manual add (D-22-3): collapsed by default, revealed on request. */}
      <div className="mb-6">
        <button
          type="button"
          className="app-control text-sm underline"
          onClick={() => setShowAddSearch((v) => !v)}
          aria-expanded={showAddSearch}
        >
          {showAddSearch ? "Cancel adding a reference" : "+ Add a reference"}
        </button>
        {showAddSearch && (
          <div className="app-panel-enter mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-[var(--color-text-muted)]">
                Search the catalog by title — this puts it in your roadmap even though nothing detected a connection
                automatically.
              </span>
              <input
                type="text"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                placeholder="Title…"
                className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                aria-label="Search for a reference to add"
              />
            </label>
            {addError && <p className="mt-2 text-xs text-[var(--color-accent-burgundy)]">{addError}</p>}
            {addQuery.trim().length >= 2 && addResults.length === 0 && !addError && (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">No matches.</p>
            )}
            <ul className="mt-2 flex flex-col gap-1">
              {/* Below the 2-character threshold there's nothing fresh to
                  show, even if a longer earlier query left results in
                  state — gate the render on the same threshold the fetch
                  itself uses (owner directive C: control -> state -> output). */}
              {(addQuery.trim().length >= 2 ? addResults : []).map((r) => (
                <li key={r.id} data-search-result={r.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    {r.title}
                    {r.year ? ` (${r.year})` : ""}
                    {r.authors && <span className="text-[var(--color-text-muted)]"> — {r.authors}</span>}
                  </span>
                  <button type="button" className="app-control shrink-0 underline" onClick={() => addManually(r.id)}>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && <p className="text-[var(--color-accent-burgundy)]">{error}</p>}
      {!data && !error && <p ref={loadingRevealRef} className="app-reveal text-[var(--color-text-muted)]">Computing roadmap…</p>}

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
            <TierDot colorVar={TIER_COLOR[tier]} className="inline-block" />
            {TIER_LABEL[tier]}
          </h2>
          <ol className="flex flex-col gap-2">
            {items.map((item) => (
              <RoadmapCard key={item.bibId} item={item} onMutate={mutate} />
            ))}
          </ol>
        </section>
      ))}

      {/* Restore/un-hide (D-22-3): progressive disclosure — collapsed by
          default so hidden items don't flood the page (owner directive B). */}
      {data && data.hiddenItems.length > 0 && (
        <details className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <summary className="app-control cursor-pointer text-sm font-semibold text-[var(--color-text)]">
            Hidden items ({data.hiddenItems.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {data.hiddenItems.map((h) => (
              <li key={h.bibId} data-hidden-item={h.bibId} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {h.title}
                  {h.year ? ` (${h.year})` : ""}
                  {h.authors && <span className="text-[var(--color-text-muted)]"> — {h.authors}</span>}
                </span>
                <button type="button" className="app-control shrink-0 underline" onClick={() => mutate(h.bibId, { hidden: false })}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
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
            {item.workId ? (
              <Link href={`/works/${item.workId}`} className="underline">
                {item.title}
              </Link>
            ) : (
              item.title
            )}
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
            {item.mergedCount > 0 && (
              <span title="Other editions/reviews of this same work were folded into this one item">
                · {item.mergedCount} {item.mergedCount === 1 ? "edition" : "editions"} collapsed here
              </span>
            )}
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
                className="app-control rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5"
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
            <label className="flex items-center gap-1">
              <span className="text-[var(--color-text-muted)]">Pin position</span>
              <input
                type="number"
                min={1}
                defaultValue={item.sequence}
                className="app-control w-14 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5"
                aria-label={`Pin ${item.title} to position`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const value = Number((e.target as HTMLInputElement).value);
                    if (Number.isFinite(value) && value >= 1) onMutate(item.bibId, { manualPosition: value });
                  }
                }}
                onBlur={(e) => {
                  const value = Number(e.target.value);
                  if (Number.isFinite(value) && value >= 1) onMutate(item.bibId, { manualPosition: value });
                }}
              />
            </label>
            <button type="button" className="app-control underline" onClick={() => onMutate(item.bibId, { manualPosition: null })}>
              Clear pin
            </button>
            <button type="button" className="app-control underline" onClick={() => onMutate(item.bibId, { hidden: true })}>
              Hide
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
