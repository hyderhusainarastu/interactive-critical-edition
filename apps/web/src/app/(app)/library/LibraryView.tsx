"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  matchesReaderLevel,
  suggestReaderLevelFromCompletions,
  type ReaderLevel,
  type ReaderLevelFilter,
  type ReaderLevelMatchMode,
} from "@ice/roadmap";
import { CredibilityMeter } from "@/components/CredibilityMeter";
import { PageHeader } from "@/components/app/PageHeader";
import type { LibraryItem } from "@/lib/library";

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
  ai_inferred: "AI-inferred",
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
const SOURCE_TYPE_LABEL: Record<string, string> = {
  article: "Article",
  book: "Book",
  webpage: "Web article",
  video: "Lecture or video",
  social_post: "Social post",
  dataset: "Dataset",
  "unresolved-citation": "Unresolved citation",
};
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

type SortKey = "recency" | "title" | "credibility";
const READING_STATUSES = ["planned", "reading", "completed", "abandoned"] as const;

function matchesTab(item: LibraryItem, tab: Tab): boolean {
  if (tab === "all") return true;
  if (tab === "to_read") return item.readingStatus === null || item.readingStatus === "planned";
  return item.readingStatus === tab;
}

export function LibraryView({
  initialItems,
  initialReaderLevel = "all",
  enablePhase12Identity = false,
}: {
  initialItems: LibraryItem[];
  /** The reader's saved global level, or "all" if they never chose one.
   *  Selecting a different level here is a page-local view filter only — it
   *  never overwrites the saved global level (plan §35.2: bringing Library
   *  in line with Roadmap/Curriculum's default-then-override pattern). */
  initialReaderLevel?: ReaderLevelFilter;
  enablePhase12Identity?: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  const [tab, setTab] = useState<Tab>("all");
  const [relationship, setRelationship] = useState<string>("");
  const [resourceType, setResourceType] = useState<string>("");
  const [readerLevel, setReaderLevel] = useState<ReaderLevelFilter>(initialReaderLevel);
  const [levelMode, setLevelMode] = useState<ReaderLevelMatchMode>(enablePhase12Identity ? "cumulative" : "exact");
  const [workId, setWorkId] = useState<string>("");
  const [sort, setSort] = useState<SortKey>("recency");

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

  // Work-scoping (plan §36 11.4): "select one of my own uploaded works, see
  // everything the Library recommends for it specifically" — reuses the
  // Library's own real relatedness mechanism (resource_role/recommendedFor,
  // already carried per item) rather than the Graph's different, fuzzy
  // title-matched graph_edge mechanism, which would give an inconsistent
  // second answer to the same question.
  const works = useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of items) {
      for (const w of item.recommendedFor) byId.set(w.workId, w.title);
    }
    return [...byId.entries()].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title));
  }, [items]);

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
    if (workId) filtered = filtered.filter((i) => i.recommendedFor.some((w) => w.workId === workId));
    const sorted = [...filtered];
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "credibility") sorted.sort((a, b) => (b.credibility?.score ?? -1) - (a.credibility?.score ?? -1));
    else sorted.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return sorted;
  }, [items, tab, relationship, resourceType, readerLevel, levelMode, workId, sort]);

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
      <div className="mb-5"><PageHeader title="Library" description="Every source recommended for your own works, separate from the files you uploaded. Verify against the sources." /></div>

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

      {items.length === 0 && (
        <p className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          Nothing here yet. The Library fills in once one of your works has been analyzed under the newer research
          pipeline — if you just uploaded something, check back after analysis completes.
        </p>
      )}

      {items.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap gap-2 border-b border-[var(--color-border)] text-sm">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className="border-b-2 px-3 py-2"
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

          <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">Work</span>
              <select
                value={workId}
                onChange={(e) => setWorkId(e.target.value)}
                aria-label="Work"
                className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
              >
                <option value="">All my works</option>
                {works.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">Relationship</span>
              <select value={relationship} onChange={(e) => setRelationship(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
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
              <select value={resourceType} onChange={(e) => setResourceType(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
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
                className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
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
                  className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                >
                  <option value="cumulative">Selected + foundations</option>
                  <option value="exact">Exact level</option>
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
                <option value="recency">Recently added</option>
                <option value="title">Title A–Z</option>
                <option value="credibility">Credibility</option>
              </select>
            </label>
            <div className="ml-auto text-xs text-[var(--color-text-muted)]">
              {visible.length} of {items.length}
            </div>
          </div>

          {visible.length === 0 && (
            <p className="text-[var(--color-text-muted)]">No items match these filters.</p>
          )}

          <ul className="flex flex-col gap-2">
            {visible.map((item) => (
              <LibraryRow key={item.id} item={item} onSetStatus={setReadingStatus} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function LibraryRow({
  item,
  onSetStatus,
}: {
  item: LibraryItem;
  onSetStatus: (resourceId: string, status: (typeof READING_STATUSES)[number] | null) => void;
}) {
  return (
    <li data-library-item={item.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--color-text)]">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer" className="underline">
                {item.title}
              </a>
            ) : (
              item.title
            )}
            {item.year ? <span className="font-normal text-[var(--color-text-muted)]"> ({item.year})</span> : null}
          </p>
          {item.authors.length > 0 && <p className="text-xs text-[var(--color-text-muted)]">{item.authors.join(", ")}</p>}
          {item.rationale && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{item.rationale}</p>}

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span>{RELATIONSHIP_LABEL[item.relationship] ?? item.relationship}</span>
            <span>·</span>
            <span>{SOURCE_TYPE_LABEL[item.resourceType] ?? item.resourceType}</span>
            {item.credibility?.authority && (
              <>
                <span>·</span>
                <span>Authority {item.credibility.authority.toUpperCase()}</span>
              </>
            )}
            {item.credibility?.score != null && (
              <>
                <span>·</span>
                <CredibilityMeter score={item.credibility.score} />
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
            {item.readerLevel && (
              <>
                <span>·</span>
                <span>{READER_LEVEL_LABEL[item.readerLevel] ?? item.readerLevel}</span>
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

          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-muted)]">Status</span>
            <select
              value={item.readingStatus ?? ""}
              onChange={(e) => onSetStatus(item.id, (e.target.value || null) as (typeof READING_STATUSES)[number] | null)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1 py-0.5"
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
