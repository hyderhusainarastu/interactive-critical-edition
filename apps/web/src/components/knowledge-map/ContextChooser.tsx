"use client";

/**
 * The `/graph` context chooser (charter §8 "The global `/graph` route
 * opens a context chooser and recent contexts. It must never immediately
 * render the entire corpus as an undifferentiated network.", spec §1.1's
 * `ContextChooser.tsx` row). Five entry-context tabs (Work / Passage /
 * Research question / Claim / Debate) plus a Recent tab
 * (`recentContexts.ts`, client-only). Never fetches or renders a
 * cross-work graph itself — it only lists candidates and hands the chosen
 * `GraphUrlContext` back to the caller.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphContextKind, GraphUrlContext } from "@ice/graph-display";
import {
  claimToCandidate,
  debateToCandidate,
  filterCandidatesBySearch,
  passageToCandidate,
  questionToCandidate,
  sortCandidatesByRecency,
  workToCandidate,
  type ContextCandidate,
} from "./contextChooser";
import { browserStorage, readRecentContexts, type RecentContextEntry } from "./recentContexts";

const TAB_LABEL: Record<GraphContextKind, string> = {
  work: "Work",
  passage: "Passage",
  question: "Research question",
  claim: "Claim",
  debate: "Debate",
};
const TABS: GraphContextKind[] = ["work", "passage", "question", "claim", "debate"];

type TabKey = GraphContextKind | "recent";

type TabFetchResult = ContextCandidate[] | "unavailable";

async function fetchWorkCandidates(): Promise<ContextCandidate[]> {
  const res = await fetch("/api/works");
  if (!res.ok) return [];
  const rows: { workId: string; title: string; authorName: string | null }[] = await res.json();
  return rows.map(workToCandidate);
}

async function fetchPassageCandidates(): Promise<ContextCandidate[] | null> {
  const res = await fetch("/api/passages/recent");
  if (res.status === 401) return null;
  if (!res.ok) return [];
  const { passages } = await res.json();
  return (passages ?? []).map(passageToCandidate);
}

async function fetchQuestionCandidates(): Promise<ContextCandidate[] | null> {
  const res = await fetch("/api/research/projects");
  if (res.status === 404 || res.status === 401) return null; // Phase 25 flag off, or unauthenticated
  if (!res.ok) return [];
  const { projects } = await res.json();
  return (projects ?? []).map(questionToCandidate);
}

async function fetchClaimCandidates(): Promise<ContextCandidate[] | null> {
  const res = await fetch("/api/research/claims/recent");
  if (res.status === 404 || res.status === 401) return null;
  if (!res.ok) return [];
  const { claims } = await res.json();
  return (claims ?? []).map(claimToCandidate);
}

async function fetchDebateCandidates(): Promise<ContextCandidate[] | null> {
  const res = await fetch("/api/research/debates");
  if (res.status === 404 || res.status === 401) return null;
  if (!res.ok) return [];
  const { debates } = await res.json();
  return (debates ?? []).map(debateToCandidate);
}

const FETCHERS: Record<GraphContextKind, () => Promise<ContextCandidate[] | null>> = {
  work: fetchWorkCandidates,
  passage: fetchPassageCandidates,
  question: fetchQuestionCandidates,
  claim: fetchClaimCandidates,
  debate: fetchDebateCandidates,
};

export interface ContextChooserProps {
  userId: string;
  /** Set when arriving here via legacy-URL translation's "chooser" outcome
   *  — an explanatory banner (e.g. "This saved reading-order link no
   *  longer points at a work you can open — choose a work to continue."). */
  notice?: string | null;
  /** Work ids to highlight (legacy `roadmapRoot`/`pinnedWork` multi-value
   *  chooser outcomes) — pre-selects the Work tab when present. */
  candidateWorkIds?: string[];
  onSelect: (context: GraphUrlContext) => void;
}

export function ContextChooser({ userId, notice, candidateWorkIds, onSelect }: ContextChooserProps) {
  // One-time, client-only read (this component only ever mounts in the
  // browser) — a lazy `useState` initializer rather than an effect+setState
  // pair, since there is nothing to "subscribe" to here, just an initial
  // value to compute once.
  const [recent] = useState<RecentContextEntry[]>(() => {
    const storage = browserStorage();
    return storage ? readRecentContexts(userId, storage) : [];
  });
  const [activeTab, setActiveTab] = useState<TabKey>(() => (candidateWorkIds && candidateWorkIds.length > 0 ? "work" : "recent"));
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Partial<Record<GraphContextKind, TabFetchResult>>>({});
  // Tracks kinds with a fetch already in flight — a plain ref (not state),
  // mutated synchronously inside the effect below, so starting a fetch
  // never itself triggers a setState call from within the effect body
  // (the actual `setResults` call only ever happens inside the fetch
  // promise's `.then`, an external-system callback, not the effect body
  // itself).
  const inFlightRef = useRef<Set<GraphContextKind>>(new Set());

  useEffect(() => {
    if (activeTab === "recent") return;
    const kind = activeTab;
    if (results[kind] !== undefined || inFlightRef.current.has(kind)) return;
    inFlightRef.current.add(kind);
    let cancelled = false;
    FETCHERS[kind]().then((candidates) => {
      inFlightRef.current.delete(kind);
      if (cancelled) return;
      setResults((prev) => (prev[kind] !== undefined ? prev : { ...prev, [kind]: candidates === null ? "unavailable" : candidates }));
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, results]);

  const recentAsCandidates = useMemo<ContextCandidate[]>(
    () => recent.map((r) => ({ kind: r.kind, id: r.id, title: r.label, subtitle: r.subtitle, updatedAt: r.visitedAt })),
    [recent],
  );

  const activeResult = activeTab === "recent" ? undefined : results[activeTab];

  const visibleCandidates = useMemo(() => {
    const raw = activeTab === "recent" ? recentAsCandidates : Array.isArray(activeResult) ? activeResult : [];
    return filterCandidatesBySearch(sortCandidatesByRecency(raw), search);
  }, [activeTab, recentAsCandidates, activeResult, search]);

  const isLoading = activeTab !== "recent" && activeResult === undefined;
  const isUnavailable = activeResult === "unavailable";

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-4 py-10" data-testid="knowledge-map-context-chooser">
      <div className="w-full max-w-2xl">
        <h1 className="mb-1 text-xl font-semibold text-[var(--color-text)]">Open the Knowledge Map</h1>
        <p className="mb-4 text-sm text-[var(--color-text-muted)]">
          Choose a work, passage, research question, claim, or debate to explore its connections — the Knowledge Map never opens your whole
          library at once.
        </p>

        {notice && <p className="mb-4 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]">{notice}</p>}

        <div role="tablist" aria-label="Context kind" className="mb-3 flex flex-wrap gap-1 border-b border-[var(--color-border)]">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "recent"}
            onClick={() => setActiveTab("recent")}
            className={`app-control rounded-t px-3 py-1.5 text-sm ${activeTab === "recent" ? "border-b-2 border-[var(--color-highlight)] font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}
          >
            Recent
          </button>
          {TABS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={activeTab === kind}
              onClick={() => setActiveTab(kind)}
              className={`app-control rounded-t px-3 py-1.5 text-sm ${activeTab === kind ? "border-b-2 border-[var(--color-highlight)] font-medium text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}
            >
              {TAB_LABEL[kind]}
            </button>
          ))}
        </div>

        <label className="mb-3 block">
          <span className="sr-only">Search {activeTab === "recent" ? "recent contexts" : TAB_LABEL[activeTab as GraphContextKind]}</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${activeTab === "recent" ? "recent" : TAB_LABEL[activeTab as GraphContextKind].toLowerCase()}…`}
            className="app-control w-full rounded border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm"
          />
        </label>

        {isLoading && <p className="app-shimmer app-skeleton h-24 rounded" role="status" aria-label="Loading" />}

        {isUnavailable && <p className="text-sm text-[var(--color-text-muted)]">This context kind isn&rsquo;t available right now.</p>}

        {!isLoading && !isUnavailable && visibleCandidates.length === 0 && (
          <p className="text-sm text-[var(--color-text-muted)]">
            {activeTab === "recent" ? "You haven't opened anything in the Knowledge Map yet." : "Nothing here yet."}
          </p>
        )}

        {!isLoading && !isUnavailable && visibleCandidates.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label={`${activeTab === "recent" ? "Recent" : TAB_LABEL[activeTab as GraphContextKind]} contexts`}>
            {visibleCandidates.map((candidate) => {
              const highlighted = candidateWorkIds?.includes(candidate.id) ?? false;
              return (
                <li key={`${candidate.kind}:${candidate.id}`}>
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: candidate.kind, id: candidate.id })}
                    className={`app-control flex w-full flex-col items-start rounded border px-3 py-2 text-left ${highlighted ? "border-[var(--color-highlight)] bg-[var(--color-surface)]" : "border-[var(--color-border)]"}`}
                  >
                    <span className="font-medium text-[var(--color-text)]">{candidate.title || "Untitled"}</span>
                    {candidate.subtitle && <span className="text-xs text-[var(--color-text-muted)]">{candidate.subtitle}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
