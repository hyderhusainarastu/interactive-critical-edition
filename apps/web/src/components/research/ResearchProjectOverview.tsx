"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useResearchJobPolling } from "@/hooks/useResearchJobPolling";
import type { ResearchPipelineOverview } from "@/lib/research/pipeline";
import { computeResearchPipelineSteps } from "@/lib/research/pipelineSteps";
import { JobStageProgress } from "./JobStageProgress";
import { LiveAnnouncer } from "./LiveAnnouncer";
import { ResearchBreadcrumb } from "./ResearchBreadcrumb";
import { ResearchPipelineStepper } from "./ResearchPipelineStepper";

type Project = { id: string; title: string; summary?: string | null; archivedAt?: string | Date | null };
type Question = { id: string; question: string; sortOrder: number };
type Member = {
  id: string;
  memberType: string;
  role: string;
  workId: string | null;
  workTitle: string | null;
  workAuthorName: string | null;
  // This lane's UI only adds/removes "work" members (see
  // `lib/research/projects.ts`), but the shared row shape carries every
  // member type the schema supports — kept here so a future corpus/writer/
  // RAG member renders sensibly instead of a type error.
  writerProjectId: string | null;
  ragConversationId: string | null;
};
type AvailableWork = { id: string; title: string; authorName: string | null };
type InsightFeed = {
  unreviewedClaimCount: number;
  runningJobCount: number;
  recentFailedJobs: { id: string; jobType: string; error: string | null; updatedAt: string | Date }[];
  latestCompletedJob: { id: string; jobType: string; coverage: string | null; note: string | null; updatedAt: string | Date } | null;
};
type JobRequest = {
  id: string;
  jobType: string;
  status: string;
  stage: string | null;
  progressIndex: number | null;
  progressTotal: number | null;
  coverage: string | null;
  note: string | null;
  error: string | null;
  requiresConfirmation: boolean;
  scope: unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
};

const ROLE_LABEL: Record<string, string> = { central: "Central", supporting: "Supporting", background: "Background" };
const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  queued: "Queued",
  running: "Running",
  complete: "Complete",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Reads the work id a job's scope names, for display only (looking up its
 *  title in `memberByWorkId`). Checks the canonical `{workId}` singular key
 *  first (Phase 30 fix lane, D-25-14); the `workIds` array fallback is for
 *  any `research_job_request` row dispatched before that fix, so an old row
 *  still shows a work title here instead of just its bare job type. */
function jobWorkId(scope: unknown): string | null {
  const value = scope as { workId?: unknown; workIds?: unknown } | null;
  if (typeof value?.workId === "string") return value.workId;
  const ids = Array.isArray(value?.workIds) ? (value.workIds as unknown[]) : [];
  return typeof ids[0] === "string" ? ids[0] : null;
}

export function ResearchProjectOverview({
  project,
  initialQuestions,
  initialMembers,
  availableWorks,
  initialFeed,
  initialJobRequests,
  pipelineOverview,
}: {
  project: Project;
  initialQuestions: Question[];
  initialMembers: Member[];
  availableWorks: AvailableWork[];
  initialFeed: InsightFeed;
  initialJobRequests: JobRequest[];
  pipelineOverview: ResearchPipelineOverview;
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState(initialQuestions);
  const [members, setMembers] = useState(initialMembers);
  const [feed, setFeed] = useState(initialFeed);
  const [jobRequests, setJobRequests] = useState(initialJobRequests);
  const [announcement, setAnnouncement] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [addingQuestion, setAddingQuestion] = useState(false);
  const [workToAdd, setWorkToAdd] = useState("");
  const [roleToAdd, setRoleToAdd] = useState<"central" | "supporting" | "background">("supporting");
  const [addingMember, setAddingMember] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<Record<string, { reason: string; estimatedUnits: number }>>({});
  const [dispatching, setDispatching] = useState<Record<string, boolean>>({});
  const [dispatchError, setDispatchError] = useState<Record<string, string>>({});

  // Item 1(a): `router.refresh()` re-renders this route's Server Components
  // with fresh props, but a "use client" component's own `useState` only
  // reads its `initial*` prop once, on mount — without this sync, the
  // insight feed (a purely server-computed read with no dedicated client
  // fetch of its own) would keep showing stale counts forever after the
  // first render, refresh or not.
  useEffect(() => {
    setFeed(initialFeed);
  }, [initialFeed]);

  /** Refetches the jobs list — used both right after a dispatch (so the new
   *  request shows up immediately) and as the polling hook's `fetchRows`. */
  async function fetchJobs(): Promise<JobRequest[] | null> {
    const response = await fetch(`/api/research/projects/${project.id}/jobs`);
    if (!response.ok) return null;
    const body = await response.json();
    return Array.isArray(body.requests) ? body.requests : null;
  }

  async function refreshJobs() {
    const next = await fetchJobs();
    if (next) setJobRequests(next);
  }

  // Item 1(b): while any dispatched job is non-terminal, poll every ~3s
  // (paused while the tab is hidden). When one finishes, refresh the whole
  // route so its real output (claims, in this project's case) appears
  // without the user doing anything.
  useResearchJobPolling({
    rows: jobRequests,
    fetchRows: fetchJobs,
    onUpdate: setJobRequests,
    onComplete: (justCompleted) => {
      setAnnouncement(
        justCompleted.length === 1 ? "A research job finished." : `${justCompleted.length} research jobs finished.`,
      );
      router.refresh();
    },
  });

  const memberByWorkId = new Map(members.filter((m) => m.workId).map((m) => [m.workId as string, m]));
  const addableWorks = availableWorks.filter((w) => !memberByWorkId.has(w.id));

  // Item 2 (owner-reported scope addition): `pipelineOverview` is read
  // straight off the prop — not copied into `useState` — the same
  // `CorpusView.tsx` "`items` reads the prop directly" precedent, so a
  // `router.refresh()` after any mutation above (extracting claims, etc.)
  // is what keeps the stepper honest without a separate sync effect.
  const pipelineResult = computeResearchPipelineSteps(pipelineOverview, {
    membersHref: "#research-members-title",
    hypothesesHref: `/research/${project.id}/hypotheses`,
  });

  async function addQuestion() {
    const question = newQuestion.trim();
    if (!question) return;
    setAddingQuestion(true);
    try {
      const response = await fetch(`/api/research/projects/${project.id}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not add question.");
      setQuestions((current) => [...current, body.question]);
      setNewQuestion("");
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not add question.");
    } finally {
      setAddingQuestion(false);
    }
  }

  async function deleteQuestion(id: string) {
    const response = await fetch(`/api/research/projects/${project.id}/questions`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (response.ok) {
      setQuestions((current) => current.filter((q) => q.id !== id));
      router.refresh();
    }
  }

  async function addMember() {
    if (!workToAdd) return;
    setAddingMember(true);
    try {
      const response = await fetch(`/api/research/projects/${project.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workId: workToAdd, role: roleToAdd }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not add work to this project.");
      setMembers((current) => [...current.filter((m) => m.id !== body.member.id), body.member]);
      setWorkToAdd("");
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not add work to this project.");
    } finally {
      setAddingMember(false);
    }
  }

  async function removeMember(memberId: string) {
    const response = await fetch(`/api/research/projects/${project.id}/members?memberId=${memberId}`, { method: "DELETE" });
    if (response.ok) {
      setMembers((current) => current.filter((m) => m.id !== memberId));
      router.refresh();
    }
  }

  async function extractClaims(workId: string, confirm = false) {
    setDispatching((current) => ({ ...current, [workId]: true }));
    setDispatchError((current) => ({ ...current, [workId]: "" }));
    try {
      const response = await fetch(`/api/research/projects/${project.id}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: "extract_claims", workId, confirm }),
      });
      const body = await response.json();
      if (response.status === 409 && body.needsConfirmation) {
        setPendingConfirm((current) => ({ ...current, [workId]: { reason: body.error, estimatedUnits: body.estimatedUnits } }));
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not start claim extraction.");
      setPendingConfirm((current) => {
        const next = { ...current };
        delete next[workId];
        return next;
      });
      await refreshJobs();
      router.refresh();
    } catch (error) {
      setDispatchError((current) => ({ ...current, [workId]: error instanceof Error ? error.message : "Could not start claim extraction." }));
    } finally {
      setDispatching((current) => ({ ...current, [workId]: false }));
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6" aria-labelledby="research-project-title">
      <LiveAnnouncer message={announcement} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <ResearchBreadcrumb items={[{ label: "Research", href: "/research" }, { label: project.title }]} />
          <h1 id="research-project-title" className="font-serif text-3xl font-semibold">{project.title}</h1>
          {project.summary ? <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">{project.summary}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/research/${project.id}/claims`} className="app-control app-press rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium">
            View claims
          </Link>
          <Link href={`/research/${project.id}/debates`} className="app-control app-press rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium">
            View debates
          </Link>
          <Link href={`/research/${project.id}/hypotheses`} className="app-control app-press rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium">
            Hypotheses &amp; gaps
          </Link>
          <Link href={`/research/${project.id}/corpus`} className="app-control app-press rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium">
            Corpus
          </Link>
        </div>
      </div>

      <ResearchPipelineStepper result={pipelineResult} />

      {/* Insight feed — zero-LLM, pure DB reads (see lib/research/feed.ts). */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="research-feed-title">
        <h2 id="research-feed-title" className="font-serif text-lg font-semibold">Where the work stands</h2>
        <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Unreviewed claims</dt>
            <dd className="mt-1 text-2xl font-semibold">{feed.unreviewedClaimCount}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Running jobs</dt>
            <dd className="mt-1 text-2xl font-semibold">{feed.runningJobCount}</dd>
          </div>
        </dl>
        {feed.recentFailedJobs.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium">Recent failures</h3>
            <ul className="mt-1 space-y-1 text-sm text-[var(--color-text-muted)]">
              {feed.recentFailedJobs.map((job) => (
                <li key={job.id}>{job.jobType.replace(/_/g, " ")} — {job.error ?? "failed"}</li>
              ))}
            </ul>
          </div>
        )}
        {feed.latestCompletedJob && (
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">
            Last completed run ({feed.latestCompletedJob.jobType.replace(/_/g, " ")}): coverage {feed.latestCompletedJob.coverage ?? "unknown"}
            {feed.latestCompletedJob.note ? ` — ${feed.latestCompletedJob.note}` : ""}
          </p>
        )}
      </section>

      {/* Questions */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="research-questions-title">
        <h2 id="research-questions-title" className="font-serif text-lg font-semibold">Research questions</h2>
        <ul className="app-reveal-stagger mt-3 space-y-2">
          {questions.map((q) => (
            <li key={q.id} className="app-mount flex items-center justify-between gap-3 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
              <span>{q.question}</span>
              <button type="button" className="app-control app-press text-xs text-[var(--color-text-muted)] underline" onClick={() => deleteQuestion(q.id)}>Remove</button>
            </li>
          ))}
          {!questions.length && <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">No questions yet.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="new-research-question">New research question</label>
          <input
            id="new-research-question"
            type="text"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="What question is this project trying to answer?"
            className="app-control min-w-0 flex-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50" onClick={addQuestion} disabled={addingQuestion || !newQuestion.trim()}>
            {addingQuestion ? "Adding…" : "Add"}
          </button>
        </div>
      </section>

      {/* Members */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="research-members-title">
        <h2 id="research-members-title" className="font-serif text-lg font-semibold">Works in this project</h2>
        <ul className="app-reveal-stagger mt-3 space-y-2" aria-label="Project members">
          {members.map((member) => (
            <li key={member.id} className="app-mount rounded border border-[var(--color-border)] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{member.workTitle ?? member.writerProjectId ?? member.ragConversationId ?? "Untitled member"}</p>
                  {member.workAuthorName ? <p className="text-[var(--color-text-muted)]">{member.workAuthorName}</p> : null}
                  <p className="mt-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{ROLE_LABEL[member.role] ?? member.role}</p>
                </div>
                <div className="flex items-center gap-2">
                  {member.workId && (member.role === "central" || member.role === "supporting") && (
                    <button
                      type="button"
                      className="app-control app-press rounded border border-[var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
                      onClick={() => extractClaims(member.workId as string)}
                      disabled={Boolean(dispatching[member.workId as string])}
                    >
                      {dispatching[member.workId as string] ? "Starting…" : "Extract claims"}
                    </button>
                  )}
                  <button type="button" className="app-control app-press text-xs text-[var(--color-text-muted)] underline" onClick={() => removeMember(member.id)}>Remove</button>
                </div>
              </div>
              {member.workId && pendingConfirm[member.workId] && (
                <div className="app-panel-enter mt-2 rounded border border-[var(--color-accent)] p-2 text-xs">
                  <p>{pendingConfirm[member.workId].reason}</p>
                  <button
                    type="button"
                    className="app-control app-press mt-2 rounded bg-[var(--color-accent-ink)] px-3 py-1.5 text-[var(--color-background)]"
                    onClick={() => extractClaims(member.workId as string, true)}
                  >
                    Confirm and extract
                  </button>
                </div>
              )}
              {member.workId && dispatchError[member.workId] && <p className="mt-2 text-xs text-[var(--color-error,#b3261e)]">{dispatchError[member.workId]}</p>}
            </li>
          ))}
          {!members.length && <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">No works added yet.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="research-work-select">Add a work from your Library</label>
          <select id="research-work-select" value={workToAdd} onChange={(e) => setWorkToAdd(e.target.value)} className="app-control rounded border border-[var(--color-border)] px-3 py-2 text-sm">
            <option value="">Add a work…</option>
            {addableWorks.map((w) => (
              <option key={w.id} value={w.id}>{w.title}{w.authorName ? ` — ${w.authorName}` : ""}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="research-role-select">Role</label>
          <select id="research-role-select" value={roleToAdd} onChange={(e) => setRoleToAdd(e.target.value as typeof roleToAdd)} className="app-control rounded border border-[var(--color-border)] px-3 py-2 text-sm">
            <option value="central">Central</option>
            <option value="supporting">Supporting</option>
            <option value="background">Background</option>
          </select>
          <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50" onClick={addMember} disabled={addingMember || !workToAdd}>
            {addingMember ? "Adding…" : "Add to project"}
          </button>
        </div>
      </section>

      {/* Jobs panel — status/stage/progress/coverage only, deliberately no
          monetary figures (Workstream F precedent: cost stays in the DB/
          tracker, never rendered here). */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="research-jobs-title">
        <h2 id="research-jobs-title" className="font-serif text-lg font-semibold">Research jobs</h2>
        <ul className="app-reveal-stagger mt-3 space-y-2" aria-label="Research job requests">
          {jobRequests.map((job) => {
            const workId = jobWorkId(job.scope);
            const workTitle = workId ? memberByWorkId.get(workId)?.workTitle : null;
            return (
              <li key={job.id} className="app-mount rounded border border-[var(--color-border)] p-3 text-sm">
                <p className="font-medium">{job.jobType.replace(/_/g, " ")}{workTitle ? ` — ${workTitle}` : ""}</p>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  {STATUS_LABEL[job.status] ?? job.status}
                  {job.coverage ? ` · coverage: ${job.coverage}` : ""}
                </p>
                <JobStageProgress status={job.status} stage={job.stage} progressIndex={job.progressIndex} progressTotal={job.progressTotal} />
                {job.note && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{job.note}</p>}
                {job.error && <p className="mt-1 text-xs text-[var(--color-error,#b3261e)]">{job.error}</p>}
              </li>
            );
          })}
          {!jobRequests.length && <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">No research jobs yet.</li>}
        </ul>
      </section>
    </section>
  );
}
