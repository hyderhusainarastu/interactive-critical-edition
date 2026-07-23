"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  matchesReaderLevel,
  suggestReaderLevelFromCompletions,
  type ReaderLevel,
  type ReaderLevelFilter,
  type ReaderLevelMatchMode,
} from "@ice/roadmap";
import { CredibilityMeter } from "@/components/CredibilityMeter";
import { PageHeader } from "@/components/app/PageHeader";
import { useScrollReveal } from "@/hooks/useScrollReveal";
import type { LibraryItem, LibraryWork } from "@/lib/library";
import { SOURCE_TYPE_LABEL } from "@/lib/librarySearch";

/** Debounce delay (ms) before a typed search term triggers the
 *  server-authoritative `/api/library` fetch (plan §20.1). */
const SEARCH_DEBOUNCE_MS = 300;

const SUGGESTION_DISMISSED_KEY = "library-reader-level-suggestion-dismissed";

const RELATIONSHIP_LABEL: Record<string, string> = {
  explicit_reference: "Explicit reference",
  secondary_scholarly_recommendation: "Secondary scholarship",
  historical_context: "Historical context",
  prerequisite: "Prerequisite",
  conceptual_influence: "Conceptual influence",
  disagreement_polemical_target: "Disagreement",
  interpretive_aid: "Interpretive aid",
  parallel_comparison: "Parallel / comparison",
  optional_extension: "Optional extension",
  ai_inferred: "Inferred connection",
};

const READER_LEVEL_LABEL: Record<string, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
};

const READER_LEVEL_FILTER_LABEL: Record<ReaderLevelFilter, string> = {
  ...READER_LEVEL_LABEL,
  all: "Show all levels",
} as Record<ReaderLevelFilter, string>;
const READER_LEVEL_FILTER_OPTIONS: ReaderLevelFilter[] = ["beginner", "undergraduate", "advanced", "research", "all"];
const VERIFICATION_LABEL: Record<string, string> = {
  scholarly_record: "Scholarly record verified",
  institutional: "Institution verified",
  named: "Named creator",
  pseudonymous: "Pseudonymous creator",
  anonymous: "Anonymous creator",
};

type Tab = "all" | "to_read" | "reading" | "completed";
const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "to_read", label: "To read" },
  { key: "reading", label: "Reading" },
  { key: "completed", label: "Completed" },
];

type SortKey = "relevance" | "recency" | "title" | "credibility";
const READING_STATUSES = ["planned", "reading", "completed", "abandoned"] as const;
/** Phase 20.6: labels for records attached under their canonical work entry. */
const ATTACHED_ROLE_LABEL: Record<string, string> = {
  review: "Review",
  edition: "Edition",
  translation: "Translation",
  excerpt: "Excerpt",
  primary: "Primary text",
};
const AUTHORITY_RANK: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

function matchesTab(item: LibraryItem, tab: Tab): boolean {
  if (tab === "all") return true;
  if (tab === "to_read") return item.readingStatus === null || item.readingStatus === "planned";
  return item.readingStatus === tab;
}

export function LibraryView({
  initialItems,
  initialWorks,
  initialFocusWorkId,
  initialReaderLevel = "all",
  initialSearch = "",
  enablePhase12Identity = false,
}: {
  initialItems: LibraryItem[];
  initialWorks: LibraryWork[];
  initialFocusWorkId: string;
  /** The reader's saved global level, or "all" if they never chose one.
   *  Selecting a different level here is a page-local view filter only — it
   *  never overwrites the saved global level (plan §35.2: bringing Library
   *  in line with Roadmap/Curriculum's default-then-override pattern). */
  initialReaderLevel?: ReaderLevelFilter;
  /** The `?q=` deep-link search term the server already applied to
   *  `initialItems` (plan §20.1) — seeds the input so the first paint and
   *  the input's displayed value agree. */
  initialSearch?: string;
  enablePhase12Identity?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const focusRef = useScrollReveal<HTMLElement>();
  const controlsRef = useScrollReveal<HTMLDivElement>();
  const [items, setItems] = useState(initialItems);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [isSearching, setIsSearching] = useState(false);
  // The server already applied `initialSearch` when assembling
  // `initialItems`, so the first time `search` settles back to that same
  // value (typically immediately, before the user has typed anything) no
  // refetch is needed — only actual changes should hit the network.
  const searchAppliedRef = useRef<string | null>(initialSearch);
  const [tab, setTab] = useState<Tab>("all");
  const [relationship, setRelationship] = useState<string>("");
  const [resourceType, setResourceType] = useState<string>("");
  const [readerLevel, setReaderLevel] = useState<ReaderLevelFilter>(initialReaderLevel);
  const [levelMode, setLevelMode] = useState<ReaderLevelMatchMode>(enablePhase12Identity ? "cumulative" : "exact");
  const [workId, setWorkId] = useState<string>(initialFocusWorkId);
  const [sort, setSort] = useState<SortKey>("relevance");

  // Debounce typed input into a committed search term (plan §20.1). The
  // setState below runs inside the timeout callback, not synchronously
  // during the effect body, so it isn't the cascading-render pattern the
  // set-state-in-effect rule guards against — same shape as
  // WorkStatusPanel's existing setInterval-based polling.
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Server-authoritative search (plan §20.1): once the debounced term
  // settles, sync it to the URL (same `router.replace` pattern `selectFocus`
  // already uses for Focus) and — unless it's the same term the server
  // already applied for `initialItems` — fetch freshly search-filtered
  // items from `/api/library` rather than filtering the already-downloaded
  // list in the browser.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (search) params.set("q", search);
    else params.delete("q");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });

    if (searchAppliedRef.current === search) {
      searchAppliedRef.current = null;
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    fetch(`/api/library?q=${encodeURIComponent(search)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`search failed: ${res.status}`))))
      .then((data: { items: LibraryItem[] }) => {
        if (!cancelled) setItems(data.items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setIsSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search, pathname, router]);

  function clearSearch() {
    setSearchInput("");
  }

  // Suggested-reader-level nudge (plan §35.2): a pure inference over what the
  // reader has actually finished, never a silent write — "Switch" is the only
  // path that changes the saved profile level, and "Dismiss" is remembered so
  // the exact same suggestion doesn't keep reappearing.
  const [dismissedSuggestion, setDismissedSuggestion] = useState<ReaderLevel | null>(null);
  useEffect(() => {
    // Deliberately read after mount rather than in a lazy useState initializer:
    // the initializer would run during SSR too (window/localStorage absent),
    // so reading it there would make the server- and client-rendered markup
    // diverge and trigger a hydration mismatch. A same-render setState here
    // is the standard fix for "sync client-only storage into state safely".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissedSuggestion((localStorage.getItem(SUGGESTION_DISMISSED_KEY) as ReaderLevel | null) ?? null);
  }, []);
  const suggestedLevel = useMemo(() => {
    const completedLevels = items.filter((i) => i.readingStatus === "completed").map((i) => i.readerLevel as ReaderLevel | null);
    const currentLevel = initialReaderLevel === "all" ? null : initialReaderLevel;
    return suggestReaderLevelFromCompletions(completedLevels, currentLevel);
  }, [items, initialReaderLevel]);
  const showSuggestion = suggestedLevel !== null && suggestedLevel !== dismissedSuggestion;

  function dismissSuggestion() {
    if (!suggestedLevel) return;
    localStorage.setItem(SUGGESTION_DISMISSED_KEY, suggestedLevel);
    setDismissedSuggestion(suggestedLevel);
  }

  async function acceptSuggestion() {
    if (!suggestedLevel) return;
    setReaderLevel(suggestedLevel);
    await fetch("/api/reader-level", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level: suggestedLevel }),
    });
    dismissSuggestion();
  }

  const relationships = useMemo(() => [...new Set(items.flatMap((item) => item.roles.map((role) => role.relationship)))].sort(), [items]);
  const resourceTypes = useMemo(() => [...new Set(items.map((i) => i.resourceType))].sort(), [items]);

  const focusedWork = initialWorks.find((work) => work.id === workId) ?? null;

  // Per-level counts use exactly the selected matching rule, so a cumulative
  // Undergraduate view counts universal + Beginner + Undergraduate material.
  const levelCounts = useMemo(() => {
    const counts = {} as Record<ReaderLevelFilter, number>;
    for (const level of READER_LEVEL_FILTER_OPTIONS) {
      counts[level] = items.filter((item) => item.roles.some((role) => matchesReaderLevel(role.readerLevel, level, levelMode))).length;
    }
    return counts;
  }, [items, levelMode]);

  const tabCounts = useMemo(() => {
    const counts: Record<Tab, number> = { all: items.length, to_read: 0, reading: 0, completed: 0 };
    for (const item of items) {
      if (item.readingStatus === null || item.readingStatus === "planned") counts.to_read += 1;
      else if (item.readingStatus === "reading") counts.reading += 1;
      else if (item.readingStatus === "completed") counts.completed += 1;
    }
    return counts;
  }, [items]);

  const visible = useMemo(() => {
    let filtered = items.filter((i) => matchesTab(i, tab));
    if (relationship) filtered = filtered.filter((item) => item.roles.some((role) => role.relationship === relationship));
    if (resourceType) filtered = filtered.filter((i) => i.resourceType === resourceType);
    if (readerLevel !== "all") filtered = filtered.filter((item) => item.roles.some((role) => matchesReaderLevel(role.readerLevel, readerLevel, levelMode)));
    if (workId) filtered = filtered.filter((i) => i.focusMetrics.some((metric) => metric.workId === workId));
    const sorted = [...filtered];
    const metricFor = (item: LibraryItem) => {
      if (workId) return item.focusMetrics.find((metric) => metric.workId === workId) ?? null;
      return [...item.focusMetrics].sort((left, right) => right.relevance - left.relevance || (right.credibility?.score ?? -1) - (left.credibility?.score ?? -1))[0] ?? null;
    };
    const stableTitle = (left: LibraryItem, right: LibraryItem) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    const credibilityFor = (item: LibraryItem) => metricFor(item)?.credibility ?? item.credibility;
    const credibilityOrder = (left: LibraryItem, right: LibraryItem) => {
      const leftCredibility = credibilityFor(left);
      const rightCredibility = credibilityFor(right);
      const leftAuthority = AUTHORITY_RANK[leftCredibility?.authority ?? "E"] ?? 5;
      const rightAuthority = AUTHORITY_RANK[rightCredibility?.authority ?? "E"] ?? 5;
      return leftAuthority - rightAuthority || (rightCredibility?.score ?? -1) - (leftCredibility?.score ?? -1);
    };
    if (sort === "title") sorted.sort(stableTitle);
    else if (sort === "credibility") sorted.sort((left, right) => credibilityOrder(left, right) || stableTitle(left, right));
    else if (sort === "recency") sorted.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || stableTitle(left, right));
    else sorted.sort((left, right) => (metricFor(right)?.relevance ?? -1) - (metricFor(left)?.relevance ?? -1) || credibilityOrder(left, right) || stableTitle(left, right));
    return sorted;
  }, [items, tab, relationship, resourceType, readerLevel, levelMode, workId, sort]);

  function selectFocus(nextWorkId: string) {
    setWorkId(nextWorkId);
    const params = new URLSearchParams(window.location.search);
    if (nextWorkId) params.set("focus", nextWorkId);
    else params.delete("focus");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  async function setReadingStatus(resourceId: string, status: (typeof READING_STATUSES)[number] | null) {
    setItems((prev) => prev.map((i) => (i.id === resourceId ? { ...i, readingStatus: status } : i)));
    await fetch(`/api/library/${resourceId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readingStatus: status }),
    });
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-5"><PageHeader title="Library" description="A focused research shelf for the works you upload." /></div>

      <aside className="mb-5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm leading-6 text-[var(--color-text-muted)]">
        <span className="font-medium text-[var(--color-text)]">Your uploaded work is the focus.</span>{" "}
        Upload texts you want Palimnote to index. External texts are fetched and indexed only when clearly open access; other recommendations remain source records.
      </aside>

      {showSuggestion && suggestedLevel && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
          <p className="text-[var(--color-text-muted)]">
            Based on what you&rsquo;ve completed, you might be ready for the{" "}
            <strong className="text-[var(--color-text)]">{READER_LEVEL_LABEL[suggestedLevel]}</strong> view. This never
            hides anything either way — it just changes what opens by default.
          </p>
          <div className="ml-auto flex gap-3 whitespace-nowrap text-xs">
            <button type="button" className="underline" onClick={acceptSuggestion}>
              Switch to {READER_LEVEL_LABEL[suggestedLevel]}
            </button>
            <button type="button" className="underline" onClick={dismissSuggestion}>
              Dismiss
            </button>
          </div>
        </div>
      )}

      {initialWorks.length === 0 && (
        <p className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          Nothing here yet. <Link href="/upload" className="underline">Upload a work</Link> to start a private research shelf.
        </p>
      )}

      {initialWorks.length > 0 && (
        <>
          <section ref={focusRef} data-focus-work={focusedWork?.id} className="app-reveal mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--color-text-muted)]">Focused work</p>
            {focusedWork ? (
              <>
                <Link href={`/works/${focusedWork.id}`} className="mt-1 inline-block font-serif text-xl font-semibold text-[var(--color-text)] underline decoration-[var(--color-accent-umber)] underline-offset-4">{focusedWork.title}</Link>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">Recommendations below are ranked by their relationship to this work, then evidence-backed credibility.</p>
              </>
            ) : <p className="mt-1 text-sm text-[var(--color-text-muted)]">Showing recommendations across all uploaded works.</p>}
          </section>
          <div role="group" aria-label="Reading status filter" className="mb-4 flex flex-wrap gap-2 border-b border-[var(--color-border)] text-sm">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                onClick={() => setTab(t.key)}
                // Phase 23.2 (D-23-x): `min-h-11` brings this reading-status
                // tab to the 44px touch-target floor — padding-only, the
                // filter row already has room below it.
                className="min-h-11 border-b-2 px-3 py-2"
                style={{
                  borderColor: tab === t.key ? "var(--color-accent-ink)" : "transparent",
                  color: tab === t.key ? "var(--color-text)" : "var(--color-text-muted)",
                  fontWeight: tab === t.key ? 600 : 400,
                }}
              >
                {t.label} ({tabCounts[t.key]})
              </button>
            ))}
          </div>

          <div ref={controlsRef} className="app-reveal mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">Search library</span>
              <div className="flex items-center gap-1">
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  aria-label="Search library"
                  placeholder="Title, author, year, DOI, ISBN, source type…"
                  className="app-control w-64 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    aria-label="Clear search"
                    className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                  >
                    Clear search
                  </button>
                )}
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">Focus</span>
              <select
                value={workId}
                onChange={(e) => selectFocus(e.target.value)}
                aria-label="Focus work"
                className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
              >
                <option value="">All works</option>
                {initialWorks.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">Relationship</span>
              <select value={relationship} onChange={(e) => setRelationship(e.target.value)} className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
                <option value="">All</option>
                {relationships.map((r) => (
                  <option key={r} value={r}>
                    {RELATIONSHIP_LABEL[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">Source type</span>
              <select value={resourceType} onChange={(e) => setResourceType(e.target.value)} className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
                <option value="">All</option>
                {resourceTypes.map((t) => (
                  <option key={t} value={t}>
                    {SOURCE_TYPE_LABEL[t] ?? t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">
                Reader level
                {readerLevel !== "all" && (
                  <span className="ml-1 text-[var(--color-text-muted)]">
                    ({enablePhase12Identity && levelMode === "exact" ? "exact tags, plus universal material" : "selected level and foundations"})
                  </span>
                )}
              </span>
              <select
                value={readerLevel}
                onChange={(e) => setReaderLevel(e.target.value as ReaderLevelFilter)}
                className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
              >
                {READER_LEVEL_FILTER_OPTIONS.map((level) => (
                  <option key={level} value={level}>
                    {READER_LEVEL_FILTER_LABEL[level]} ({levelCounts[level]})
                  </option>
                ))}
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
              <span className="text-xs text-[var(--color-text-muted)]">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
                <option value="relevance">Most relevant and credible</option>
                <option value="title">Title A–Z</option>
                <option value="recency">Recently added</option>
                <option value="credibility">Credibility</option>
              </select>
            </label>
            <div className="ml-auto text-xs text-[var(--color-text-muted)]" aria-live="polite" aria-atomic="true">
              {isSearching
                ? "Searching…"
                : search
                  ? `${visible.length} result${visible.length === 1 ? "" : "s"} for “${search}”`
                  : `${visible.length} of ${items.length}`}
            </div>
          </div>

          {visible.length === 0 && (
            <p className="text-[var(--color-text-muted)]">
              {search ? <>No results for &ldquo;{search}&rdquo;.</> : "No items match these filters."}
            </p>
          )}

          <ul className="flex flex-col gap-2">
              {visible.map((item) => (
              <LibraryRow key={item.id} item={item} focusMetric={workId ? item.focusMetrics.find((metric) => metric.workId === workId) ?? null : null} onSetStatus={setReadingStatus} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function LibraryRow({
  item,
  focusMetric,
  onSetStatus,
}: {
  item: LibraryItem;
  focusMetric: LibraryItem["focusMetrics"][number] | null;
  onSetStatus: (resourceId: string, status: (typeof READING_STATUSES)[number] | null) => void;
}) {
  const relationship = focusMetric?.relationship ?? item.relationship;
  const rationale = focusMetric?.rationale ?? item.rationale;
  const credibility = focusMetric?.credibility ?? item.credibility;
  const readerLevel = focusMetric?.readerLevel ?? item.readerLevel;
  return (
    <li data-library-item={item.id} className="app-control rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3 hover:bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--color-text)]">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer" className="underline">
                {item.title}
              </a>
            ) : (
              // Structural-only addition (Phase 20.4): links to the new
              // Library entry detail page (source-text attach lives there).
              // Deliberately not touching this row's other label strings —
              // those are Phase 20.2's scope.
              <Link href={`/library/${item.id}`} className="underline">
                {item.title}
              </Link>
            )}
            {item.year ? <span className="font-normal text-[var(--color-text-muted)]"> ({item.year})</span> : null}
          </p>
          {item.authors.length > 0 && <p className="text-xs text-[var(--color-text-muted)]">{item.authors.join(", ")}</p>}
          {rationale && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{rationale}</p>}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span>{RELATIONSHIP_LABEL[relationship] ?? relationship}</span>
            {focusMetric && <><span>·</span><span>Relationship relevance {Math.round(focusMetric.relevance * 100)}%</span></>}
            <span>·</span>
            <span>{SOURCE_TYPE_LABEL[item.resourceType] ?? item.resourceType}</span>
            {credibility?.authority && (
              <>
                <span>·</span>
                <span>Authority {credibility.authority.toUpperCase()}</span>
              </>
            )}
            {credibility?.score != null && (
              <>
                <span>·</span>
                <CredibilityMeter score={credibility.score} />
              </>
            )}
            <span>·</span>
            <span>{item.peerReviewed === true ? "Peer-reviewed" : item.peerReviewed === false ? "Not peer-reviewed" : "Peer review unverified"}</span>
            {item.creatorVerification && (
              <>
                <span>·</span>
                <span>{VERIFICATION_LABEL[item.creatorVerification] ?? `Creator ${item.creatorVerification}`}</span>
              </>
            )}
            {readerLevel && (
              <>
                <span>·</span>
                <span>{READER_LEVEL_LABEL[readerLevel] ?? readerLevel}</span>
              </>
            )}
          </div>

          {item.recommendedFor.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 text-xs">
              {item.recommendedFor.map((w) => (
                <Link key={w.workId} href={`/works/${w.workId}`} className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                  {w.title}
                </Link>
              ))}
            </div>
          )}

          {(item.attached ?? []).length > 0 && (
            <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]" aria-label={`Related records for ${item.title}`}>
              <p className="font-medium text-[var(--color-text)]">Related records of this work</p>
              <ul className="mt-1 list-disc pl-4">
                {item.attached.map((attached) => (
                  <li key={attached.id} data-attached-record={attached.id}>
                    {ATTACHED_ROLE_LABEL[attached.role] ?? attached.role}
                    {": "}
                    {attached.url ? (
                      <a href={attached.url} target="_blank" rel="noreferrer" className="underline">
                        {attached.title}
                      </a>
                    ) : (
                      attached.title
                    )}
                    {attached.year ? ` (${attached.year})` : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.citationProvenance.length > 0 && (
            <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-text-muted)]" aria-label={`Citation provenance for ${item.title}`}>
              <p className="font-medium text-[var(--color-text)]">Cited in this upload</p>
              <ul className="mt-1 list-disc pl-4">
                {item.citationProvenance.map((provenance) => (
                  <li key={`${provenance.source}:${provenance.location}:${provenance.resolutionState}`}>
                    {provenance.source} · {provenance.location} · {provenance.resolutionState === "resolved" ? "Resolved" : provenance.resolutionState === "pending" ? "Resolving bibliographic metadata" : "Needs bibliographic resolution"}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-muted)]">Status</span>
            <select
              value={item.readingStatus ?? ""}
              onChange={(e) => onSetStatus(item.id, (e.target.value || null) as (typeof READING_STATUSES)[number] | null)}
              className="app-control rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5"
              aria-label={`Reading status of ${item.title}`}
            >
              <option value="">To read</option>
              {READING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </li>
  );
}
