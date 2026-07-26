"use client";

import Link from "next/link";
import { useState } from "react";

type Project = { id: string; title: string };

type MonitorType = "topic" | "citation_alert" | "author_follow";
type Cadence = "daily" | "weekly" | "paused";

type Monitor = {
  id: string;
  projectId: string | null;
  monitorType: MonitorType;
  query: string;
  cadence: Cadence;
  isActive: boolean;
  lastScannedAt: string | Date | null;
  createdAt: string | Date;
};

type Hit = {
  id: string;
  monitorId: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
  provider: string;
  seenAt: string | Date;
  dismissedAt: string | Date | null;
  importedCorpusItemId: string | null;
  monitorQuery: string;
  monitorType: MonitorType;
};

const MONITOR_TYPE_LABEL: Record<MonitorType, string> = {
  topic: "Topic",
  citation_alert: "Citation alert",
  author_follow: "Author follow",
};

const MONITOR_TYPE_HINT: Record<MonitorType, string> = {
  topic: "Free-text keywords, e.g. \"phenomenology of care\"",
  citation_alert: "A DOI or arXiv id for the paper to watch citations of",
  author_follow: "An author's display name to watch for new papers",
};

function formatDate(value: string | Date | null): string {
  if (!value) return "never";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Scheduled research monitoring UI (Phase 29.1). Used both as the global
 * `/research/monitors` view (`project` undefined — monitors span every
 * project) and the project-scoped `/research/[projectId]/monitors` view
 * (`project` set — the create form pre-scopes new monitors to it, and the
 * hits feed is narrowed to this project's own monitors).
 *
 * Zero AI cost is a UI fact too: nothing here shows a monetary figure or a
 * confirmation-cost gate (Workstream F's "no cost figures in research UI"
 * precedent) — every action either scans real providers for free metadata
 * or performs a plain DB write.
 */
export function MonitorsView({ project, initialMonitors, initialHits }: { project?: Project; initialMonitors: Monitor[]; initialHits: Hit[] }) {
  const [monitors, setMonitors] = useState(initialMonitors);
  const [hits, setHits] = useState(initialHits);
  const [monitorType, setMonitorType] = useState<MonitorType>("topic");
  const [query, setQuery] = useState("");
  const [cadence, setCadence] = useState<Cadence>("daily");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busyMonitorId, setBusyMonitorId] = useState<string | null>(null);
  const [busyHitId, setBusyHitId] = useState<string | null>(null);

  const hitsQuery = project ? `?projectId=${project.id}` : "";
  const monitorsQuery = project ? `?projectId=${project.id}` : "";

  async function refreshHits() {
    const response = await fetch(`/api/research/monitors/hits${hitsQuery}`);
    const body = await response.json();
    if (response.ok && Array.isArray(body.hits)) setHits(body.hits);
  }

  async function refreshMonitors() {
    const response = await fetch(`/api/research/monitors${monitorsQuery}`);
    const body = await response.json();
    if (response.ok && Array.isArray(body.monitors)) setMonitors(body.monitors);
  }

  async function createMonitor(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setCreating(true);
    setError(null);
    setStatusMessage(null);
    try {
      const response = await fetch("/api/research/monitors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: project?.id, monitorType, query: query.trim(), cadence }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not create monitor.");
      setMonitors((prev) => [body.monitor, ...prev]);
      setQuery("");
      setStatusMessage(`Monitor created${cadence === "paused" ? " (paused — set a cadence to start scanning)" : ""}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create monitor.");
    } finally {
      setCreating(false);
    }
  }

  async function updateCadence(monitorId: string, next: Cadence) {
    setBusyMonitorId(monitorId);
    setError(null);
    try {
      const response = await fetch(`/api/research/monitors/${monitorId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cadence: next }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not update cadence.");
      setMonitors((prev) => prev.map((m) => (m.id === monitorId ? body.monitor : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update cadence.");
    } finally {
      setBusyMonitorId(null);
    }
  }

  async function scanNow(monitorId: string) {
    setBusyMonitorId(monitorId);
    setError(null);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/research/monitors/${monitorId}/scan`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start scan.");
      setStatusMessage(
        body.action === "reused"
          ? "A scan of this monitor is already in progress — nothing new was started."
          : "Scan started. New hits appear here once it finishes — refresh to check.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start scan.");
    } finally {
      setBusyMonitorId(null);
    }
  }

  async function deleteMonitor(monitorId: string) {
    setBusyMonitorId(monitorId);
    setError(null);
    try {
      const response = await fetch(`/api/research/monitors/${monitorId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not delete monitor.");
      }
      setMonitors((prev) => prev.filter((m) => m.id !== monitorId));
      setHits((prev) => prev.filter((h) => h.monitorId !== monitorId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete monitor.");
    } finally {
      setBusyMonitorId(null);
    }
  }

  async function dismissHit(hitId: string) {
    setBusyHitId(hitId);
    setError(null);
    try {
      const response = await fetch(`/api/research/monitors/hits/${hitId}/dismiss`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not dismiss.");
      }
      setHits((prev) => prev.filter((h) => h.id !== hitId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not dismiss.");
    } finally {
      setBusyHitId(null);
    }
  }

  async function addToCorpus(hitId: string) {
    setBusyHitId(hitId);
    setError(null);
    try {
      const response = await fetch(`/api/research/monitors/hits/${hitId}/add-to-corpus`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not add to corpus.");
      setHits((prev) => prev.map((h) => (h.id === hitId ? { ...h, importedCorpusItemId: body.corpusItemId } : h)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add to corpus.");
    } finally {
      setBusyHitId(null);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6" aria-labelledby="monitors-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {project && (
            <p className="text-sm font-medium text-[var(--color-accent)]">
              <Link href={`/research/${project.id}`} className="underline">{project.title}</Link>
            </p>
          )}
          <h1 id="monitors-title" className="font-serif text-3xl font-semibold">
            {project ? "Monitors" : "Research monitors"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Watch a topic, a paper&apos;s citations, or an author for new work — every hit is a real, verbatim provider
            record, checked against your corpus and library so nothing already known resurfaces.
          </p>
        </div>
        {!project && (
          <Link href="/research" className="app-control app-press rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium">
            All projects
          </Link>
        )}
      </div>

      {/* Create monitor */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="create-monitor-title">
        <h2 id="create-monitor-title" className="font-serif text-lg font-semibold">New monitor</h2>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={createMonitor}>
          <label className="sr-only" htmlFor="monitor-type">Monitor type</label>
          <select
            id="monitor-type"
            value={monitorType}
            onChange={(e) => setMonitorType(e.target.value as MonitorType)}
            className="app-control min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            <option value="topic">Topic</option>
            <option value="citation_alert">Citation alert</option>
            <option value="author_follow">Author follow</option>
          </select>
          <label className="sr-only" htmlFor="monitor-query">Query</label>
          <input
            id="monitor-query"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={MONITOR_TYPE_HINT[monitorType]}
            className="app-control min-h-11 min-w-0 flex-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <label className="sr-only" htmlFor="monitor-cadence">Cadence</label>
          <select
            id="monitor-cadence"
            value={cadence}
            onChange={(e) => setCadence(e.target.value as Cadence)}
            className="app-control min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="paused">Paused (off)</option>
          </select>
          <button
            type="submit"
            className="app-control app-press min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50"
            disabled={creating || !query.trim()}
          >
            {creating ? "Creating…" : "Create monitor"}
          </button>
        </form>
        {statusMessage && <p className="mt-2 text-sm text-[var(--color-text-muted)]">{statusMessage}</p>}
        {error && <p className="mt-2 text-sm text-[var(--color-error,#b3261e)]">{error}</p>}
      </section>

      {/* Monitors list */}
      <section className="mt-6" aria-labelledby="monitors-list-title">
        <h2 id="monitors-list-title" className="font-serif text-lg font-semibold">Your monitors</h2>
        <ul className="app-reveal-stagger mt-3 space-y-3" aria-label="Monitors">
          {monitors.map((m) => (
            <li key={m.id} className="app-mount app-card rounded-lg p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{m.query}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {MONITOR_TYPE_LABEL[m.monitorType]} · last scanned {formatDate(m.lastScannedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor={`cadence-${m.id}`}>Cadence for {m.query}</label>
                  <select
                    id={`cadence-${m.id}`}
                    value={m.cadence}
                    onChange={(e) => updateCadence(m.id, e.target.value as Cadence)}
                    disabled={busyMonitorId === m.id}
                    className="app-control min-h-11 rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="paused">Paused</option>
                  </select>
                  <button
                    type="button"
                    className="app-control app-press min-h-11 rounded border border-[var(--color-border)] px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() => scanNow(m.id)}
                    disabled={busyMonitorId === m.id}
                  >
                    Scan now
                  </button>
                  <button
                    type="button"
                    className="app-control app-press min-h-11 rounded border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-error,#b3261e)] disabled:opacity-50"
                    onClick={() => deleteMonitor(m.id)}
                    disabled={busyMonitorId === m.id}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          ))}
          {!monitors.length && (
            <li className="app-empty app-mount rounded p-4 text-sm text-[var(--color-text-muted)]">
              No monitors yet — create one above to have Palimnote watch for new work.
            </li>
          )}
        </ul>
      </section>

      {/* Hits */}
      <section className="mt-8" aria-labelledby="hits-list-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="hits-list-title" className="font-serif text-lg font-semibold">New findings</h2>
          <button
            type="button"
            className="app-control app-press inline-flex min-h-11 items-center px-2 text-xs underline text-[var(--color-text-muted)]"
            onClick={() => { void refreshHits(); void refreshMonitors(); }}
          >
            Refresh
          </button>
        </div>
        <ul className="app-reveal-stagger mt-3 space-y-3" aria-label="Monitor hits">
          {hits.map((h) => (
            <li key={h.id} className="app-mount rounded border border-[var(--color-border)] p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{h.url ? <a href={h.url} target="_blank" rel="noreferrer" className="underline">{h.title}</a> : h.title}</p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {h.authors.slice(0, 3).join(", ")}
                    {h.authors.length > 3 ? " et al." : ""}
                    {h.year ? ` · ${h.year}` : ""}
                    {h.venue ? ` · ${h.venue}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    From monitor: {h.monitorQuery} ({MONITOR_TYPE_LABEL[h.monitorType]})
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {h.importedCorpusItemId ? (
                    <span className="app-control inline-flex min-h-11 items-center rounded-full border border-[var(--color-accent)] px-3 text-xs">In corpus</span>
                  ) : (
                    <button
                      type="button"
                      className="app-control app-press min-h-11 rounded border border-[var(--color-border)] px-3 py-1 text-xs disabled:opacity-50"
                      onClick={() => addToCorpus(h.id)}
                      disabled={busyHitId === h.id}
                    >
                      Add to corpus
                    </button>
                  )}
                  <button
                    type="button"
                    className="app-control app-press min-h-11 rounded border border-[var(--color-border)] px-3 py-1 text-xs disabled:opacity-50"
                    onClick={() => dismissHit(h.id)}
                    disabled={busyHitId === h.id}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </li>
          ))}
          {!hits.length && (
            <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">
              No new findings yet — set a monitor&apos;s cadence to daily or weekly, or scan one now.
            </li>
          )}
        </ul>
      </section>
    </section>
  );
}
