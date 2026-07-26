"use client";

import Link from "next/link";
import { useState } from "react";

type Project = { id: string; title: string };

interface CorpusItem {
  memberId: string;
  id: string;
  source: string;
  externalId: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  url: string | null;
  venue: string | null;
  createdAt: string | Date;
  hasAbstract: boolean;
}

interface ImportJobRow {
  id: string;
  jobType: string;
  status: string;
  stage: string | null;
  coverage: string | null;
  note: string | null;
  error: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface SearchResult {
  source: string;
  externalId: string;
  dedupKey: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  venue: string | null;
}

interface ProviderAttemptRow {
  provider: string;
  status: string;
  resultCount: number;
  error?: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  semanticscholar: "Semantic Scholar",
  openalex: "OpenAlex",
  arxiv: "arXiv",
};

const ATTEMPT_STATUS_LABEL: Record<string, string> = {
  queried: "queried",
  unavailable: "unavailable",
  rate_limited: "rate limited",
  failed: "failed",
  disabled: "disabled",
};

function authorLine(authors: string[]): string {
  if (authors.length === 0) return "";
  return authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", ");
}

function resultKey(item: { source: string; externalId: string }): string {
  return `${item.source}:${item.externalId}`;
}

/**
 * The Corpus page (Phase 30 fix lane — closes the `/research/[projectId]/corpus`
 * route-map gap Phase 28.1/28.2 left open). Two halves: the project's
 * already-imported `research_corpus_item` rows, and a provider search that
 * NEVER persists anything by itself (every candidate here came from a real
 * network round trip this session, shown with honest per-provider attempt
 * reporting — the `ProviderAttempt` contract) — only an explicit "Import"
 * click dispatches the (zero-AI-cost, worker-run) `import_corpus` job that
 * actually writes a `research_corpus_item` row and links it into this
 * project. Imports are async (same shape as a monitor scan): a click here
 * queues the job and shows a status message, but the newly imported item
 * itself only appears in "In this project's corpus" on the next page load.
 */
export function CorpusView({
  project,
  initialItems,
  initialImportJobs,
}: {
  project: Project;
  initialItems: CorpusItem[];
  initialImportJobs: ImportJobRow[];
}) {
  const [items] = useState(initialItems);
  const [importJobs, setImportJobs] = useState(initialImportJobs);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [attempts, setAttempts] = useState<ProviderAttemptRow[]>([]);
  const [importingKey, setImportingKey] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [extracting, setExtracting] = useState<Record<string, boolean>>({});
  const [extractError, setExtractError] = useState<Record<string, string>>({});
  const [extractStatus, setExtractStatus] = useState<Record<string, string>>({});
  const [pendingExtractConfirm, setPendingExtractConfirm] = useState<Record<string, { reason: string; estimatedUnits: number }>>({});

  const importedDedupKeys = new Set(items.map((item) => `${item.source}:${item.externalId}`));

  /** Mirrors `ResearchProjectOverview.tsx`'s `extractClaims()` — the same
   *  dispatch/confirm/error flow, scoped to a corpus item instead of a work
   *  (Phase 30 fix lane, D-25-13). */
  async function extractClaims(corpusItemId: string, confirm = false) {
    setExtracting((current) => ({ ...current, [corpusItemId]: true }));
    setExtractError((current) => ({ ...current, [corpusItemId]: "" }));
    try {
      const response = await fetch(`/api/research/projects/${project.id}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: "extract_claims", corpusItemId, confirm }),
      });
      const body = await response.json();
      if (response.status === 409 && body.needsConfirmation) {
        setPendingExtractConfirm((current) => ({ ...current, [corpusItemId]: { reason: body.error, estimatedUnits: body.estimatedUnits } }));
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not start claim extraction.");
      setPendingExtractConfirm((current) => {
        const next = { ...current };
        delete next[corpusItemId];
        return next;
      });
      setExtractStatus((current) => ({
        ...current,
        [corpusItemId]: body.reused ? "An extraction from this abstract is already in progress." : "Extraction started — results will appear on the project's Claims page, labeled “from abstract.”",
      }));
    } catch (error) {
      setExtractError((current) => ({ ...current, [corpusItemId]: error instanceof Error ? error.message : "Could not start claim extraction." }));
    } finally {
      setExtracting((current) => ({ ...current, [corpusItemId]: false }));
    }
  }

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setResults(null);
    try {
      const response = await fetch("/api/research/corpus/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not search corpus providers.");
      setResults(body.results ?? []);
      setAttempts(body.attempts ?? []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Could not search corpus providers.");
    } finally {
      setSearching(false);
    }
  }

  async function importResult(result: SearchResult) {
    const key = resultKey(result);
    setImportingKey(key);
    setImportError(null);
    setImportStatus(null);
    try {
      const response = await fetch(`/api/research/projects/${project.id}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: "import_corpus", items: [{ provider: result.source, externalId: result.externalId }] }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start the import.");
      setImportedKeys((prev) => new Set(prev).add(key));
      setImportStatus(
        body.reused
          ? "An import of this item is already in progress."
          : "Import started — it will appear in this project's corpus once it finishes.",
      );
      await refreshJobs();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not start the import.");
    } finally {
      setImportingKey(null);
    }
  }

  async function refreshJobs() {
    const response = await fetch(`/api/research/projects/${project.id}/jobs`);
    const body = await response.json();
    if (response.ok && Array.isArray(body.requests)) {
      setImportJobs(body.requests.filter((r: ImportJobRow) => r.jobType === "import_corpus"));
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6" aria-labelledby="corpus-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--color-accent)]">
            <Link href={`/research/${project.id}`} className="underline">
              {project.title}
            </Link>
          </p>
          <h1 id="corpus-title" className="font-serif text-3xl font-semibold">
            Corpus
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Import papers by reference — a searched-for record from Semantic Scholar, OpenAlex, or arXiv, kept alongside
            your uploaded works. Every field here is copied verbatim from the provider; nothing is inferred or summarized.
          </p>
        </div>
      </div>

      {/* Search */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="corpus-search-title">
        <h2 id="corpus-search-title" className="font-serif text-lg font-semibold">
          Search providers
        </h2>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={runSearch}>
          <label className="sr-only" htmlFor="corpus-search-query">
            Search query
          </label>
          <input
            id="corpus-search-query"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Title, author, or topic"
            className="app-control min-h-11 min-w-0 flex-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="app-control app-press min-h-11 rounded border border-[var(--color-border)] px-4 text-sm disabled:opacity-50"
            disabled={searching || !query.trim()}
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        {searchError && <p className="mt-2 text-sm text-[var(--color-error,#b3261e)]">{searchError}</p>}
        {importStatus && <p className="mt-2 text-sm text-[var(--color-text-muted)]">{importStatus}</p>}
        {importError && <p className="mt-2 text-sm text-[var(--color-error,#b3261e)]">{importError}</p>}

        {attempts.length > 0 && (
          <div className="mt-3 text-xs text-[var(--color-text-muted)]">
            <p className="font-medium">Providers consulted:</p>
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1" aria-label="Provider search attempts">
              {attempts.map((a) => (
                <li key={a.provider}>
                  {PROVIDER_LABEL[a.provider] ?? a.provider} — {ATTEMPT_STATUS_LABEL[a.status] ?? a.status}
                  {a.status === "queried" ? ` (${a.resultCount} result${a.resultCount === 1 ? "" : "s"})` : ""}
                  {a.error ? `: ${a.error}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {results !== null && (
          <ul className="app-reveal-stagger mt-4 space-y-3" aria-label="Search results">
            {results.map((r) => {
              const key = resultKey(r);
              const alreadyInCorpus = importedDedupKeys.has(key);
              const justImported = importedKeys.has(key);
              return (
                <li key={key} className="app-mount rounded border border-[var(--color-border)] p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{r.url ? <a href={r.url} target="_blank" rel="noreferrer" className="underline">{r.title}</a> : r.title}</p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        {authorLine(r.authors)}
                        {r.year ? ` · ${r.year}` : ""}
                        {r.venue ? ` · ${r.venue}` : ""}
                        {` · ${PROVIDER_LABEL[r.source] ?? r.source}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {alreadyInCorpus || justImported ? (
                        <span className="app-control inline-flex min-h-11 items-center rounded-full border border-[var(--color-accent)] px-3 text-xs">
                          {alreadyInCorpus ? "In corpus" : "Import queued"}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="app-control app-press min-h-11 rounded border border-[var(--color-border)] px-3 text-xs disabled:opacity-50"
                          onClick={() => importResult(r)}
                          disabled={importingKey === key}
                        >
                          {importingKey === key ? "Importing…" : "Import"}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
            {results.length === 0 && (
              <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">
                No results from Semantic Scholar, OpenAlex, or arXiv for that query.
              </li>
            )}
          </ul>
        )}
      </section>

      {/* Recent imports */}
      {importJobs.length > 0 && (
        <section className="mt-6" aria-labelledby="corpus-jobs-title">
          <h2 id="corpus-jobs-title" className="font-serif text-lg font-semibold">
            Recent imports
          </h2>
          <ul className="mt-3 space-y-2 text-xs text-[var(--color-text-muted)]" aria-label="Import job status">
            {importJobs.slice(0, 5).map((job) => (
              <li key={job.id} className="rounded border border-[var(--color-border)] p-2">
                {job.status}
                {job.stage ? ` — ${job.stage}` : ""}
                {job.error ? ` — ${job.error}` : ""}
                {job.note ? ` — ${job.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Already-imported corpus */}
      <section className="mt-8" aria-labelledby="corpus-items-title">
        <h2 id="corpus-items-title" className="font-serif text-lg font-semibold">
          In this project&apos;s corpus
        </h2>
        <ul className="app-reveal-stagger mt-3 space-y-3" aria-label="Corpus items">
          {items.map((item) => (
            <li key={item.memberId} className="app-mount app-card rounded-lg p-4">
              <p className="font-medium">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noreferrer" className="underline">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                {authorLine(item.authors)}
                {item.year ? ` · ${item.year}` : ""}
                {item.venue ? ` · ${item.venue}` : ""}
                {` · ${PROVIDER_LABEL[item.source] ?? item.source}`}
                {item.doi ? ` · DOI ${item.doi}` : ""}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {item.hasAbstract ? (
                  <button
                    type="button"
                    className="app-control app-press min-h-11 rounded border border-[var(--color-border)] px-3 text-xs disabled:opacity-50"
                    onClick={() => extractClaims(item.id)}
                    disabled={Boolean(extracting[item.id])}
                  >
                    {extracting[item.id] ? "Starting…" : "Extract claims"}
                  </button>
                ) : (
                  <span className="text-xs text-[var(--color-text-muted)]">No abstract available to extract claims from.</span>
                )}
              </div>
              {pendingExtractConfirm[item.id] && (
                <div className="app-panel-enter mt-2 rounded border border-[var(--color-accent)] p-2 text-xs">
                  <p>{pendingExtractConfirm[item.id].reason}</p>
                  <button
                    type="button"
                    className="app-control app-press mt-2 min-h-11 rounded bg-[var(--color-accent-ink)] px-3 text-[var(--color-background)]"
                    onClick={() => extractClaims(item.id, true)}
                  >
                    Confirm and extract
                  </button>
                </div>
              )}
              {extractStatus[item.id] && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{extractStatus[item.id]}</p>}
              {extractError[item.id] && <p className="mt-2 text-xs text-[var(--color-error,#b3261e)]">{extractError[item.id]}</p>}
            </li>
          ))}
          {!items.length && (
            <li className="app-empty app-mount rounded p-4 text-sm text-[var(--color-text-muted)]">
              No imported references yet — search above and import a real provider record to add one.
            </li>
          )}
        </ul>
      </section>
    </section>
  );
}
