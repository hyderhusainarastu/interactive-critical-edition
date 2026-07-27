/**
 * Item 3 of the Research-workspace fix lane: a stage + progress indicator
 * for a `research_job_request` row, reused everywhere a running job shows
 * (the project overview's jobs panel, Corpus's "Recent imports", Monitors'
 * per-monitor scan status, the debate cluster's chamber-synthesis action,
 * and the hypotheses page's generation action). Mirrors `WorkStatusPanel.tsx`'s
 * `StageProgress` in spirit (discrete, honest, never a fake percentage) but
 * operates on the research pipeline's own kebab-case `stage` strings
 * (`apps/worker/src/research/*.ts`'s own `ctx.setStage(...)` calls) rather
 * than the edition pipeline's fixed `@ice/config` sequence — research jobs
 * have no single shared stage sequence to render as a checklist, so this
 * renders only the CURRENT stage, the same "N of M" shape
 * `WorkStatusPanel`'s own per-source counter already uses.
 */

// Machine stage strings observed across `apps/worker/src/research/*.ts`'s
// `ctx.setStage(...)` calls, given a friendlier label. Anything not listed
// here still renders — kebab-case is turned into "Title case" — so a new
// stage a future worker change adds is never silently blank, just less
// polished until it earns its own entry.
const STAGE_LABEL_OVERRIDES: Record<string, string> = {
  "planning-extraction": "Planning extraction",
  "extracting-claims": "Extracting claims",
  "rebinding-claims": "Rebinding claims",
  "loading-project-scope": "Loading project scope",
  "loading-claims": "Loading claims",
  "loading-conflicts": "Loading conflicts",
  "loading-candidates-for-judging": "Loading candidates",
  "judging-relationships": "Judging relationships",
  "judged": "Relationships judged",
  "dense-retrieval": "Retrieving candidates (dense)",
  "bm25-retrieval": "Retrieving candidates (keyword)",
  "locus-retrieval": "Retrieving candidates (locus)",
  "citation-engagement": "Checking citation engagement",
  "persisting-candidates": "Saving candidates",
  "candidates_ready": "Candidates ready",
  "loading-relationships": "Loading relationships",
  "loading-existing-clusters": "Loading existing debates",
  "naming-cluster": "Naming debates",
  "marking-stale-clusters": "Marking stale debates",
  "generating-hypotheses": "Generating hypotheses",
  "computing-novelty": "Checking novelty",
  "deriving-gaps": "Finding open gaps",
  "loading-cluster": "Loading debate",
  "loading-cluster-claims": "Loading debate claims",
  "checking-existing-chamber": "Checking for an existing chamber",
  "synthesizing-chamber": "Synthesizing chamber",
  "persisting-chamber": "Saving chamber",
  "importing-corpus-item": "Importing",
  "scanning-monitor": "Scanning providers",
};

export function formatJobStage(stage: string): string {
  return STAGE_LABEL_OVERRIDES[stage] ?? stage.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const ACTIVE_STATUSES = new Set(["planned", "queued", "running"]);

export function JobStageProgress({
  status,
  stage,
  progressIndex,
  progressTotal,
}: {
  status: string;
  stage: string | null;
  progressIndex: number | null;
  progressTotal: number | null;
}) {
  if (!ACTIVE_STATUSES.has(status)) return null;

  const label = stage ? formatJobStage(stage) : "Working";
  const determinate = Boolean(progressTotal && progressTotal > 0);
  const percent = determinate ? Math.min(100, Math.round(((progressIndex ?? 0) / (progressTotal as number)) * 100)) : null;
  const text = determinate ? `${label} — ${progressIndex ?? 0} of ${progressTotal}` : `${label}…`;

  return (
    <div className="mt-1">
      <p className="text-xs text-[var(--color-text-muted)]">{text}</p>
      {determinate ? (
        <progress className="app-progress mt-1 w-full" value={percent as number} max={100} aria-label={text}>
          {percent}%
        </progress>
      ) : (
        <div
          className="app-progress-indeterminate mt-1 w-full"
          role="progressbar"
          aria-busy="true"
          aria-label={text}
        />
      )}
    </div>
  );
}
