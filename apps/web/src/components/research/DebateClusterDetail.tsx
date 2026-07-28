"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useResearchJobPolling } from "@/hooks/useResearchJobPolling";
import { JobStageProgress } from "./JobStageProgress";
import { LiveAnnouncer } from "./LiveAnnouncer";
import { ResearchBreadcrumb } from "./ResearchBreadcrumb";
import { ResearchCorrectionControls } from "./ResearchCorrectionControls";

type MemberClaim = { id: string; workId: string | null; workTitle: string | null; claimText: string; claimNature: string };
type ClusterRelationship = { id: string; valence: string; category: string; verificationStatus: string; hidden: boolean };
type Cluster = {
  id: string;
  projectId: string;
  projectTitle: string;
  name: string;
  researchQuestion: string | null;
  description: string | null;
  status: string;
  edgeCount: number;
  verificationStatus: string;
  hidden: boolean;
  members: MemberClaim[];
  relationships: ClusterRelationship[];
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

const VALENCE_LABEL: Record<string, string> = { contradiction: "Contradiction", nuance: "Nuance", support: "Support", unrelated: "Unrelated" };

interface JobRequestRow {
  id: string;
  status: string;
  stage: string | null;
  progressIndex: number | null;
  progressTotal: number | null;
  note: string | null;
  error: string | null;
  scope: unknown;
}

/** Live updates (Item 1(a)/(b)/3 of the Research-workspace fix lane): a
 *  chamber synthesis is tracked via the shared `useResearchJobPolling` hook
 *  (visibility-aware, matching every other research page) rather than a
 *  bespoke while-loop — same behavior, less bespoke code, and it now pauses
 *  while the tab is hidden. */
export function DebateClusterDetail({ cluster }: { cluster: Cluster }) {
  const router = useRouter();
  const [dispatching, setDispatching] = useState(false);
  const [error, setError] = useState("");
  const [lastNote, setLastNote] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [job, setJob] = useState<JobRequestRow | null>(null);

  async function fetchJob(): Promise<JobRequestRow[] | null> {
    if (!job) return null;
    const response = await fetch(`/api/research/projects/${cluster.projectId}/jobs`);
    if (!response.ok) return null;
    const body = await response.json();
    const requests = Array.isArray(body.requests) ? (body.requests as JobRequestRow[]) : [];
    const found = requests.find((r) => r.id === job.id);
    return found ? [found] : null;
  }

  useResearchJobPolling({
    rows: job ? [job] : [],
    fetchRows: fetchJob,
    onUpdate: (rows) => {
      const updated = rows[0];
      if (!updated) return;
      setJob(updated);
      if (updated.status === "failed") setError(updated.error ?? "Chamber synthesis failed.");
    },
    onComplete: (justCompleted) => {
      const finished = justCompleted[0];
      setLastNote(finished?.note ?? null);
      setAnnouncement("Chamber synthesis finished.");
      router.refresh();
    },
  });

  const polling = job ? job.status === "planned" || job.status === "queued" || job.status === "running" : false;

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
      setJob({ id: body.requestId, status: "queued", stage: null, progressIndex: null, progressTotal: null, note: null, error: null, scope: { clusterId: cluster.id } });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start chamber synthesis.");
    } finally {
      setDispatching(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-8 sm:px-6" aria-labelledby="debate-cluster-title">
      <LiveAnnouncer message={announcement} />
      <ResearchBreadcrumb
        items={[
          { label: "Research", href: "/research" },
          { label: cluster.projectTitle, href: `/research/${cluster.projectId}` },
          { label: "Debates", href: `/research/${cluster.projectId}/debates` },
          { label: cluster.name },
        ]}
      />
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
      {job && (
        <JobStageProgress status={job.status} stage={job.stage} progressIndex={job.progressIndex} progressTotal={job.progressTotal} />
      )}
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

      {/* Stage 5 verification Finding 2 fix: relationship correction was
          previously reachable only indirectly, via a hypothesis's "Cited
          conflicts" section — a relationship with no hypothesis citing it
          had no correction UI anywhere. This page is the one that actually
          shows the relationship, so its own controls live here directly. */}
      <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="debate-cluster-relationships-title">
        <h2 id="debate-cluster-relationships-title" className="font-serif text-lg font-semibold">Relationships in this debate</h2>
        <ul className="app-reveal-stagger mt-3 space-y-3">
          {cluster.relationships.map((relationship) => (
            <li key={relationship.id} className="app-mount rounded border border-[var(--color-border)] p-3 text-sm">
              <p className="font-medium">{VALENCE_LABEL[relationship.valence] ?? relationship.valence} · {relationship.category}</p>
              <div className="mt-2">
                <ResearchCorrectionControls
                  objectType="relationship"
                  objectId={relationship.id}
                  verificationStatus={relationship.verificationStatus}
                  hidden={relationship.hidden}
                  compact
                />
              </div>
            </li>
          ))}
          {!cluster.relationships.length && (
            <li className="app-empty app-mount rounded p-3 text-sm text-[var(--color-text-muted)]">No relationships recorded for this cluster.</li>
          )}
        </ul>
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
