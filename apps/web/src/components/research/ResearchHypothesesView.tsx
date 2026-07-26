"use client";

import Link from "next/link";
import { useState } from "react";
import { ResearchCorrectionControls } from "./ResearchCorrectionControls";

type Project = { id: string; title: string };

type Hypothesis = {
  id: string;
  question: string | null;
  statement: string;
  rationale: string;
  methodology: string;
  challenges: string[];
  grounding: string;
  noveltyDistance: number | null;
  noveltyTier: string | null;
  noveltyEmbeddingModel: string | null;
  noveltyCorpus: string | null;
  provider: string;
  model: string;
  verificationStatus: string;
  hidden: boolean;
  createdAt: string | Date;
  sources: { claimRelationshipId: string; valence: string; category: string; verificationStatus: string; hidden: boolean }[];
  supportingWorks: { workId: string; workTitle: string }[];
};

type Gap = {
  id: string;
  debateClusterId: string;
  debateClusterName: string | null;
  description: string;
  unresolvedContradictionCount: number;
  verificationStatus: string;
  hidden: boolean;
  createdAt: string | Date;
};

const NOVELTY_TIER_LABEL: Record<string, string> = {
  high: "High novelty",
  medium: "Medium novelty",
  low: "Low novelty",
  unknown: "Novelty unknown (empty corpus)",
};

const VALENCE_LABEL: Record<string, string> = { contradiction: "Contradiction", nuance: "Nuance", support: "Support", unrelated: "Unrelated" };

function NoveltyChip({ hypothesis }: { hypothesis: Hypothesis }) {
  if (!hypothesis.noveltyTier) {
    return <span className="app-control inline-block rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">Novelty not computed</span>;
  }
  const label = NOVELTY_TIER_LABEL[hypothesis.noveltyTier] ?? hypothesis.noveltyTier;
  return (
    <span
      className="app-control inline-block rounded-full border border-[var(--color-accent)] px-2 py-0.5 text-xs"
      title={`Measured against ${hypothesis.noveltyEmbeddingModel ?? "an unknown model"}${hypothesis.noveltyCorpus ? ` (${hypothesis.noveltyCorpus})` : ""}${hypothesis.noveltyDistance != null ? ` — distance ${hypothesis.noveltyDistance.toFixed(4)}` : ""}`}
    >
      {label}
    </span>
  );
}

export function ResearchHypothesesView({
  project,
  initialHypotheses,
  initialGaps,
}: {
  project: Project;
  initialHypotheses: Hypothesis[];
  initialGaps: Gap[];
}) {
  const [hypotheses, setHypotheses] = useState(initialHypotheses);
  const [gaps, setGaps] = useState(initialGaps);
  const [question, setQuestion] = useState("");
  const [maxHypotheses, setMaxHypotheses] = useState(5);
  const [dispatching, setDispatching] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/research/projects/${project.id}/hypotheses`);
    const body = await response.json();
    if (response.ok) {
      if (Array.isArray(body.hypotheses)) setHypotheses(body.hypotheses);
      if (Array.isArray(body.gaps)) setGaps(body.gaps);
    }
  }

  async function generate(confirm = false) {
    setDispatching(true);
    setDispatchError(null);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/research/projects/${project.id}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: "generate_hypotheses", question: question.trim() || undefined, maxHypotheses, confirm }),
      });
      const body = await response.json();
      if (response.status === 409 && body.needsConfirmation) {
        setPendingConfirm(body.error);
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "Could not start hypothesis generation.");
      setPendingConfirm(null);
      setStatusMessage(
        body.reused
          ? "An identical request is already in progress or was already completed — nothing new was started."
          : "Hypothesis generation started. This page reflects new results once you refresh."
      );
      await refresh();
    } catch (error) {
      setDispatchError(error instanceof Error ? error.message : "Could not start hypothesis generation.");
    } finally {
      setDispatching(false);
    }
  }

  return (
    <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6" aria-labelledby="research-hypotheses-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--color-accent)]">
            <Link href={`/research/${project.id}`} className="underline">{project.title}</Link>
          </p>
          <h1 id="research-hypotheses-title" className="font-serif text-3xl font-semibold">Hypotheses &amp; gaps</h1>
          <p className="mt-2 max-w-2xl text-sm text-[var(--color-text-muted)]">
            Every hypothesis below is grounded in real, detected conflicts between claims in this project — never a
            free-standing synthesis. Novelty is measured against your library, not self-assessed by the model.
          </p>
        </div>
        <Link href={`/research/${project.id}/claims`} className="app-control app-press rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium">
          View claims
        </Link>
      </div>

      {/* Generate action */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="generate-hypotheses-title">
        <h2 id="generate-hypotheses-title" className="font-serif text-lg font-semibold">Generate hypotheses</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Optionally focus on a specific question — otherwise the most promising directions across detected conflicts
          are surfaced automatically.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="hypothesis-question">Research question (optional)</label>
          <input
            id="hypothesis-question"
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Does the akratic agent know what they are doing?"
            className="app-control min-w-0 flex-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          />
          <label className="sr-only" htmlFor="hypothesis-max">Maximum hypotheses</label>
          <select
            id="hypothesis-max"
            value={maxHypotheses}
            onChange={(e) => setMaxHypotheses(Number(e.target.value))}
            className="app-control rounded border border-[var(--color-border)] px-3 py-2 text-sm"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n} hypothes{n === 1 ? "is" : "es"}</option>
            ))}
          </select>
          <button
            type="button"
            className="app-control app-press rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50"
            onClick={() => generate(false)}
            disabled={dispatching}
          >
            {dispatching ? "Starting…" : "Generate hypotheses"}
          </button>
        </div>
        {pendingConfirm && (
          <div className="app-panel-enter mt-3 rounded border border-[var(--color-accent)] p-3 text-sm">
            <p>{pendingConfirm}</p>
            <button type="button" className="app-control app-press mt-2 rounded bg-[var(--color-accent-ink)] px-3 py-1.5 text-[var(--color-background)]" onClick={() => generate(true)}>
              Confirm and generate
            </button>
          </div>
        )}
        {statusMessage && <p className="mt-2 text-sm text-[var(--color-text-muted)]">{statusMessage}</p>}
        {dispatchError && <p className="mt-2 text-sm text-[var(--color-error,#b3261e)]">{dispatchError}</p>}
      </section>

      {/* Hypotheses */}
      <section className="mt-6" aria-labelledby="hypotheses-list-title">
        <h2 id="hypotheses-list-title" className="font-serif text-lg font-semibold">Hypotheses</h2>
        <ul className="app-reveal-stagger mt-3 space-y-4" aria-label="Generated hypotheses">
          {hypotheses.map((h) => (
            <li key={h.id} className="app-mount app-card rounded-lg p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="max-w-3xl font-medium">{h.statement}</p>
                <NoveltyChip hypothesis={h} />
              </div>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{h.rationale}</p>
              <p className="mt-2 text-sm"><span className="font-medium">Methodology: </span>{h.methodology}</p>
              {h.challenges.length > 0 && (
                <div className="mt-2 text-sm">
                  <span className="font-medium">Challenges: </span>
                  <ul className="ml-4 list-disc">
                    {h.challenges.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {h.sources.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Cited conflicts</p>
                  <ul className="mt-1 flex flex-wrap items-start gap-3">
                    {h.sources.map((s) => (
                      <li key={s.claimRelationshipId} className="flex flex-col gap-1">
                        <Link
                          href={`/research/${project.id}/claims`}
                          className="app-control app-press inline-block rounded border border-[var(--color-border)] px-2 py-1 text-xs underline"
                          title={`Relationship ${s.claimRelationshipId}`}
                        >
                          {VALENCE_LABEL[s.valence] ?? s.valence} · {s.category}
                        </Link>
                        <ResearchCorrectionControls
                          objectType="relationship"
                          objectId={s.claimRelationshipId}
                          verificationStatus={s.verificationStatus}
                          hidden={s.hidden}
                          compact
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {h.supportingWorks.length > 0 && (
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                  Draws on: {h.supportingWorks.map((w) => w.workTitle).join(", ")}
                </p>
              )}
              <div className="mt-3">
                <ResearchCorrectionControls objectType="hypothesis" objectId={h.id} verificationStatus={h.verificationStatus} hidden={h.hidden} compact />
              </div>
            </li>
          ))}
          {!hypotheses.length && (
            <li className="app-empty app-mount rounded p-4 text-sm text-[var(--color-text-muted)]">
              No hypotheses yet — generate some once this project has detected conflicts between claims.
            </li>
          )}
        </ul>
      </section>

      {/* Gaps */}
      <section className="mt-8" aria-labelledby="gaps-list-title">
        <h2 id="gaps-list-title" className="font-serif text-lg font-semibold">Open gaps</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Deterministic, no-AI structural findings — a debate remaining unresolved in your library, not a synthesized
          insight.
        </p>
        <ul className="app-reveal-stagger mt-3 space-y-2" aria-label="Research gaps">
          {gaps.map((g) => (
            <li key={g.id} className="app-mount rounded border border-[var(--color-border)] p-3 text-sm">
              <p>{g.description}</p>
              {g.debateClusterName && <p className="mt-1 text-xs text-[var(--color-text-muted)]">From debate: {g.debateClusterName}</p>}
              <div className="mt-2">
                <ResearchCorrectionControls objectType="gap" objectId={g.id} verificationStatus={g.verificationStatus} hidden={g.hidden} compact />
              </div>
            </li>
          ))}
          {!gaps.length && <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">No open gaps recorded yet.</li>}
        </ul>
      </section>
    </section>
  );
}
