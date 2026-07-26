"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ResearchCorrectionControls } from "./ResearchCorrectionControls";

type MemberClaim = { id: string; workId: string | null; workTitle: string | null; claimText: string; claimNature: string };
type Cluster = {
  id: string;
  projectId: string;
  name: string;
  researchQuestion: string | null;
  description: string | null;
  status: string;
  edgeCount: number;
  verificationStatus: string;
  hidden: boolean;
  members: MemberClaim[];
  latestChamberId: string | null;
};

const NATURE_LABEL: Record<string, string> = {
  empirical: "Empirical",
  textual: "Textual",
  interpretive: "Interpretive",
  historical: "Historical",
  conceptual: "Conceptual",
  normative: "Normative",
  definitional: "Definitional",
  methodological: "Methodological",
};

// Poll for up to a minute — a chamber synthesis is one model call
// (`CHAMBER_COST_ESTIMATE_USD`'s own comment: a longer prompt/reply than
// judge or naming calls), well within this window under normal latency.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20;

interface JobRequestRow {
  id: string;
  jobType: string;
  status: string;
  note: string | null;
  error: string | null;
  scope: unknown;
}

export function DebateClusterDetail({ cluster }: { cluster: Cluster }) {
  const router = useRouter();
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(false);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const pollAttempts = useRef(0);

  useEffect(() => {
    return () => {
      pollAttempts.current = POLL_MAX_ATTEMPTS; // stop any in-flight poll loop on unmount
    };
  }, []);

  async function pollForCompletion() {
    setPolling(true);
    pollAttempts.current = 0;
    while (pollAttempts.current < POLL_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      pollAttempts.current += 1;
      const response = await fetch(`/api/research/projects/${cluster.projectId}/jobs`);
      if (!response.ok) continue;
      const body = (await response.json()) as { requests?: JobRequestRow[] };
      const job = (body.requests ?? []).find((r) => {
        const scope = r.scope as { clusterId?: unknown } | null;
        return r.jobType === "synthesize_chamber" && scope?.clusterId === cluster.id;
      });
      if (!job) continue;
      if (job.status === "complete") {
        setLastNote(job.note);
        setPolling(false);
        router.refresh();
        return;
      }
      if (job.status === "failed") {
        setError(job.error ?? "Chamber synthesis failed.");
        setPolling(false);
        return;
      }
    }
    setPolling(false);
    setError("Still working — refresh this page in a moment to check again.");
  }

  async function synthesizeChamber() {
    setDispatching(true);
    setError("");
    setLastNote(null);
    try {
      const response = await fetch(`/api/research/projects/${cluster.projectId}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: "synthesize_chamber", clusterId: cluster.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not start chamber synthesis.");
      void pollForCompletion();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start chamber synthesis.");
    } finally {
      setDispatching(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-labelledby="debate-cluster-title">
      <p className="text-sm font-medium text-[var(--color-accent)]">
        <Link href="/research" className="underline">Research</Link>{" "}
        / <Link href={`/research/${cluster.projectId}`} className="underline">Project</Link>{" "}
        / <Link href={`/research/${cluster.projectId}/debates`} className="underline">Debates</Link>
      </p>
      <h1 id="debate-cluster-title" className="mt-1 font-serif text-2xl font-semibold">{cluster.name}</h1>
      {cluster.researchQuestion && <p className="mt-2 text-sm text-[var(--color-text-muted)]">{cluster.researchQuestion}</p>}
      {cluster.description && <p className="mt-1 text-sm">{cluster.description}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {cluster.latestChamberId ? (
          <Link
            href={`/research/chambers/${cluster.latestChamberId}`}
            className="app-control app-press rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium"
          >
            View chamber
          </Link>
        ) : null}
        <button
          type="button"
          className="app-control app-press rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium disabled:opacity-50"
          onClick={synthesizeChamber}
          disabled={dispatching || polling}
        >
          {dispatching ? "Starting…" : polling ? "Synthesizing…" : cluster.latestChamberId ? "Re-synthesize chamber" : "Synthesize chamber"}
        </button>
      </div>
      {lastNote && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{lastNote}</p>}
      {error && <p className="mt-2 text-xs text-[var(--color-error,#b3261e)]">{error}</p>}

      {/* Review affordances (Phase 29.2): verify/dispute/hide/restore this
          debate cluster, plus its revision history. */}
      <section className="app-card app-panel-enter mt-4 rounded-lg p-4" aria-labelledby="debate-cluster-review-title">
        <h2 id="debate-cluster-review-title" className="font-serif text-lg font-semibold">Review</h2>
        <div className="mt-2">
          <ResearchCorrectionControls objectType="cluster" objectId={cluster.id} verificationStatus={cluster.verificationStatus} hidden={cluster.hidden} />
        </div>
      </section>

      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="debate-cluster-members-title">
        <h2 id="debate-cluster-members-title" className="font-serif text-lg font-semibold">Claims in this debate</h2>
        <ul className="app-reveal-stagger mt-3 space-y-2">
          {cluster.members.map((member) => (
            <li key={member.id} className="app-mount rounded border border-[var(--color-border)] p-3 text-sm">
              <p>{member.claimText}</p>
              <p className="mt-1 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                {NATURE_LABEL[member.claimNature] ?? member.claimNature}
                {member.workTitle ? ` · ${member.workTitle}` : ""}
              </p>
            </li>
          ))}
          {!cluster.members.length && <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">No claims in this cluster.</li>}
        </ul>
      </section>
    </section>
  );
}
