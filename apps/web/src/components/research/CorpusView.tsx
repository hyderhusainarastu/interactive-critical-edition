"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useResearchJobPolling } from "@/hooks/useResearchJobPolling";
import { JobStageProgress } from "./JobStageProgress";
import { LiveAnnouncer } from "./LiveAnnouncer";
import { ResearchBreadcrumb } from "./ResearchBreadcrumb";

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
  progressIndex: number | null;
  progressTotal: number | null;
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
 * project.
 *
 * Live updates (Item 1(a)/(b)/3 of the Research-workspace fix lane): every
 * mutation calls `router.refresh()`, import/extraction jobs are polled the
 * same way the project overview's jobs panel is, and `items` is read
 * directly off the server-fed `initialItems` prop (no local copy) so a
 * `router.refresh()` after an import completes is what actually makes the
 * newly imported item appear here — there is nothing else to keep in sync.
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
  const router = useRouter();
  const items = initialItems;
  const [importJobs, setImportJobs] = useState(initialImportJobs);
  const [announcement, setAnnouncement] = useState("");
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

  async function fetchProjectJobs(): Promise<ImportJobRow[] | null> {
    const response = await fetch(`/api/research/projects/${project.id}/jobs`);
    if (!response.ok) return null;
    const body = await response.json();
    if (!Array.isArray(body.requests)) return null;
    return body.requests.filter((r: ImportJobRow) => r.jobType === "import_corpus" || r.jobType === "extract_claims");
  }

  async function refreshJobs() {
    const next = await fetchProjectJobs();
    if (next) setImportJobs(next);
  }

  // Item 1(b): while any import/extraction job is non-terminal, poll every
  // ~3s (paused while hidden). On completion, refresh the whole route — for
  // an import that means the new item appears in "In this project's
  // corpus"; for an extraction, its claims appear on the Claims page next
  // visit, but the route's own job-history data (and anything server-fed
  // that depends on it) is still worth refreshing here too.
  useResearchJobPolling<ImportJobRow>({
    rows: importJobs,
    fetchRows: fetchProjectJobs,
    onUpdate: setImportJobs,
    onComplete: (justCompleted) => {
      const importsCompleted = justCompleted.filter((j) => j.jobType === "import_corpus").length;
      const extractionsCompleted = justCompleted.filter((j) => j.jobType === "extract_claims").length;
      const parts: string[] = [];
      if (importsCompleted > 0) parts.push(importsCompleted === 1 ? "An import finished." : `${importsCompleted} imports finished.`);
      if (extractionsCompleted > 0) parts.push(extractionsCompleted === 1 ? "A claim extraction finished." : `${extractionsCompleted} claim extractions finished.`);
      setAnnouncement(parts.join(" "));
      router.refresh();
    },
  });

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
        [corpusItemId]: body.reused ? "An extraction from this abstract is already in progress." : "Extraction started — results appear on the project's Claims page automatically once it finishes.",
      }));
      await refreshJobs();
      router.refresh();
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
          : "Import started — it appears in this project's corpus automatically once it finishes.",
      );
      await refreshJobs();
      router.refresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not start the import.");
    } finally {
      setImportingKey(null);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6" aria-labelledby="corpus-title">
      <LiveAnnouncer message={announcement} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <ResearchBreadcrumb
            items={[{ label: "Research", href: "/research" }, { label: project.title, href: `/research/${project.id}` }, { label: "Corpus" }]}
          />
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
                <p>
                  {job.jobType.replace(/_/g, " ")} — {job.status}
                  {job.error ? ` — ${job.error}` : ""}
                  {job.note ? ` — ${job.note}` : ""}
                </p>
                <JobStageProgress status={job.status} stage={job.stage} progressIndex={job.progressIndex} progressTotal={job.progressTotal} />
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
