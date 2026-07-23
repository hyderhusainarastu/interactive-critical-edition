"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CURRICULUM_ROUTES,
  ROUTE_LABEL,
  type CurriculumItem,
  type CurriculumRoute,
  type CurriculumStageResult,
} from "@ice/curriculum";
import type { ReaderLevelFilter, ReaderLevelMatchMode } from "@ice/roadmap";

interface CurriculumResponse {
  title: string;
  hasWorkIdentity: boolean;
  route: CurriculumRoute;
  stages: CurriculumStageResult[];
  routeCounts: Record<CurriculumRoute, number>;
}

const READER_LEVEL_LABEL: Record<string, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
};

const READING_STATUSES = ["planned", "reading", "completed", "abandoned"] as const;
type ReadingStatus = (typeof READING_STATUSES)[number];
const READER_LEVEL_OPTIONS: ReaderLevelFilter[] = ["beginner", "undergraduate", "advanced", "research", "all"];
const READER_LEVEL_FILTER_LABEL: Record<ReaderLevelFilter, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
  all: "Show all levels",
};

export function CurriculumView({
  workId,
  title,
  initialRoute = "university",
  initialReaderLevel = "all",
  enablePhase12Identity = false,
}: {
  workId: string;
  title: string;
  initialRoute?: CurriculumRoute;
  initialReaderLevel?: ReaderLevelFilter;
  enablePhase12Identity?: boolean;
}) {
  const [data, setData] = useState<CurriculumResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<CurriculumRoute>(initialRoute);
  const [readerLevel, setReaderLevel] = useState<ReaderLevelFilter>(initialReaderLevel);
  const [levelMode, setLevelMode] = useState<ReaderLevelMatchMode>("cumulative");

  const curriculumUrl = useCallback(() => {
    const params = new URLSearchParams({ route });
    if (enablePhase12Identity) {
      params.set("readerLevel", readerLevel);
      params.set("levelMode", levelMode);
    }
    return `/api/works/${workId}/curriculum?${params}`;
  }, [enablePhase12Identity, levelMode, readerLevel, route, workId]);

  // Used to refetch after a status change so `known`/review-only reflects
  // the server's real recomputation rather than a stale local patch — same
  // mutate-then-reload pattern as RoadmapView's `load()`.
  const load = useCallback(async () => {
    const res = await fetch(curriculumUrl());
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load curriculum");
    setData(await res.json());
    setError(null);
  }, [curriculumUrl]);

  useEffect(() => {
    let ignore = false;
    fetch(curriculumUrl())
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load curriculum");
        return res.json();
      })
      .then((d) => {
        if (!ignore) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!ignore) setError(e instanceof Error ? e.message : "Failed to load curriculum");
      });
    return () => {
      ignore = true;
    };
  }, [curriculumUrl]);

  async function setReadingStatus(resourceId: string, status: ReadingStatus | null) {
    await fetch(`/api/library/${resourceId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readingStatus: status }),
    });
    await load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load curriculum"));
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-1 flex items-center gap-3 text-sm text-[var(--color-text-muted)]">
        <Link href={`/works/${workId}`} className="underline">
          ← {title}
        </Link>
      </div>
      <h1 className="mb-1 font-serif text-2xl font-semibold text-[var(--color-text)]">Curriculum</h1>
      <p className="mb-5 max-w-2xl text-sm text-[var(--color-text-muted)]">
        A staged study guide built from this work&rsquo;s Library recommendations — prerequisites first, then the
        work itself and what surrounds it. Choose a route for how far to go; completed items stay listed for review
        rather than disappearing. An automated study aid; verify against the sources.
      </p>

      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[var(--color-text-muted)]">Route</span>
          <select
            value={route}
            onChange={(e) => setRoute(e.target.value as CurriculumRoute)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
          >
            {CURRICULUM_ROUTES.map((r) => (
              <option key={r} value={r}>
                {ROUTE_LABEL[r]}
                {data ? ` (${data.routeCounts[r]})` : ""}
              </option>
            ))}
          </select>
        </label>
        {enablePhase12Identity && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--color-text-muted)]">Reader level</span>
              <select
                value={readerLevel}
                onChange={(event) => setReaderLevel(event.target.value as ReaderLevelFilter)}
                className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
              >
                {READER_LEVEL_OPTIONS.map((level) => (
                  <option key={level} value={level}>{READER_LEVEL_FILTER_LABEL[level]}</option>
                ))}
              </select>
            </label>
            {readerLevel !== "all" && (
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
          </>
        )}
      </div>

      {error && <p className="text-[var(--color-accent-burgundy)]">{error}</p>}
      {!data && !error && <p className="text-[var(--color-text-muted)]">Building curriculum…</p>}

      {data && !data.hasWorkIdentity && (
        <p className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          A curriculum is only available once this work has been analyzed under the newer research pipeline — check
          back after analysis completes.
        </p>
      )}

      {data && data.hasWorkIdentity && data.stages.every((s) => s.items.length === 0) && (
        <p className="text-[var(--color-text-muted)]">No recommended sources yet to build a study guide from.</p>
      )}

      {data?.stages.map((stage) => (
        <section key={stage.stage} className="mb-6">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[var(--color-text)]">{stage.label}</h2>
          <p className="mb-2 text-xs text-[var(--color-text-muted)]">{stage.description}</p>
          {stage.items.length === 0 ? (
            <p className="text-xs text-[var(--color-text-muted)]">Nothing here yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {stage.items.map((item) => (
                <CurriculumCard key={item.learningResourceId} item={item} onSetStatus={setReadingStatus} />
              ))}
            </ol>
          )}
          {stage.truncated && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              More items exist at this stage than this route shows — switch to Graduate for the full list.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function CurriculumCard({
  item,
  onSetStatus,
}: {
  item: CurriculumItem;
  onSetStatus: (resourceId: string, status: ReadingStatus | null) => void;
}) {
  const hours = Math.round(item.estimatedMinutes / 60);
  return (
    <li
      data-curriculum-item={item.learningResourceId}
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-3"
      style={{ opacity: item.known ? 0.6 : 1 }}
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
          {item.authors.length > 0 && <p className="text-xs text-[var(--color-text-muted)]">{item.authors.join(", ")}</p>}
          {item.rationale && <p className="mt-1 text-sm text-[var(--color-text-muted)]">{item.rationale}</p>}
          <p className="mt-1 text-sm italic text-[var(--color-text-muted)]">Checkpoint: {item.checkpoint}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]">
            <span>~{hours > 0 ? `${hours}h` : `${item.estimatedMinutes}m`}</span>
            <span>·</span>
            <span>{READER_LEVEL_LABEL[item.difficulty] ?? item.difficulty}</span>
            <span>·</span>
            <span>{Math.round(item.confidence * 100)}% confidence</span>
            {item.known && <span className="text-[var(--color-accent-green)]">· review only</span>}
          </div>

          <div className="mt-2 flex items-center gap-2 text-xs">
            <span className="text-[var(--color-text-muted)]">Status</span>
            <select
              value={item.status ?? ""}
              onChange={(e) => onSetStatus(item.learningResourceId, (e.target.value || null) as ReadingStatus | null)}
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
