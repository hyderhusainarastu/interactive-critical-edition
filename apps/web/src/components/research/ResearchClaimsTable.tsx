"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useResearchJobPolling } from "@/hooks/useResearchJobPolling";
import { LiveAnnouncer } from "./LiveAnnouncer";
import { ResearchBreadcrumb } from "./ResearchBreadcrumb";

type Project = { id: string; title: string };
type MemberWork = { id: string; title: string };
type ClaimRow = {
  id: string;
  workId: string | null;
  workTitle: string | null;
  corpusItemId: string | null;
  corpusItemTitle: string | null;
  claimText: string;
  claimNature: string;
  confidence: string;
  section: string;
  anchorState: string;
  sourceScope: string;
  verificationStatus: string;
  hidden: boolean;
  createdAt: string | Date;
};
type ListResult = { claims: ClaimRow[]; total: number; page: number; pageSize: number };

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
const ANCHOR_LABEL: Record<string, string> = { anchored: "Anchored", rebound: "Rebound", unanchored: "Unanchored" };
const VERIFICATION_LABEL: Record<string, string> = {
  unreviewed: "Unreviewed",
  user_verified: "Verified",
  source_verified: "Source-verified",
  disputed: "Disputed",
  rejected: "Rejected",
};

export function ResearchClaimsTable({
  project,
  initial,
  naturesInUse,
  memberWorks,
  initialActiveExtractionJobs = [],
}: {
  project: Project;
  initial: ListResult;
  naturesInUse: string[];
  memberWorks: MemberWork[];
  /** Item 1(c): any `extract_claims` job that was still non-terminal at
   *  render time — polled (simple approach: only while at least one is
   *  active) so this table's own list catches up automatically once
   *  extraction, dispatched from the overview or Corpus page, finishes. */
  initialActiveExtractionJobs?: { id: string; status: string }[];
}) {
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [workId, setWorkId] = useState("");
  const [claimNature, setClaimNature] = useState("");
  const [anchorState, setAnchorState] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [page, setPage] = useState(1);
  const [activeExtractionJobs, setActiveExtractionJobs] = useState(initialActiveExtractionJobs);
  const [announcement, setAnnouncement] = useState("");

  const fetchClaims = useCallback(
    async (nextPage: number) => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ projectId: project.id, page: String(nextPage) });
        if (workId) params.set("workId", workId);
        if (claimNature) params.set("claimNature", claimNature);
        if (anchorState) params.set("anchorState", anchorState);
        if (verificationStatus) params.set("verificationStatus", verificationStatus);
        const response = await fetch(`/api/research/claims?${params.toString()}`);
        const body = await response.json();
        if (response.ok) setResult(body);
      } finally {
        setLoading(false);
      }
    },
    [project.id, workId, claimNature, anchorState, verificationStatus],
  );

  // Re-fetch whenever a filter or the page changes — control→state→output
  // wiring the way every other filtered surface in this app does it. The
  // very first render already has server-fetched `initial` data matching
  // the (empty) default filters, so that one render is skipped to avoid a
  // redundant round trip.
  const skippedFirstFetch = useRef(false);
  useEffect(() => {
    if (!skippedFirstFetch.current) {
      skippedFirstFetch.current = true;
      return;
    }
    fetchClaims(page);
  }, [fetchClaims, page]);

  function onFilterChange(setter: (value: string) => void) {
    return (event: React.ChangeEvent<HTMLSelectElement>) => {
      setter(event.target.value);
      setPage(1);
    };
  }

  // Item 1(c): while a related extraction job is active, poll it; once it
  // completes, re-fetch this page of claims so newly extracted rows appear
  // without a manual reload.
  useResearchJobPolling({
    rows: activeExtractionJobs,
    fetchRows: async () => {
      const response = await fetch(`/api/research/projects/${project.id}/jobs`);
      if (!response.ok) return null;
      const body = await response.json();
      if (!Array.isArray(body.requests)) return null;
      return body.requests
        .filter((r: { jobType: string; status: string }) => r.jobType === "extract_claims")
        .map((r: { id: string; status: string }) => ({ id: r.id, status: r.status }));
    },
    onUpdate: setActiveExtractionJobs,
    onComplete: (justCompleted) => {
      setAnnouncement(justCompleted.length === 1 ? "Claim extraction finished — new claims may be listed below." : "Claim extraction finished for multiple jobs — new claims may be listed below.");
      void fetchClaims(page);
    },
  });

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6" aria-labelledby="research-claims-title">
      <LiveAnnouncer message={announcement} />
      <ResearchBreadcrumb items={[{ label: "Research", href: "/research" }, { label: project.title, href: `/research/${project.id}` }, { label: "Claims" }]} />
      <h1 id="research-claims-title" className="mt-1 font-serif text-3xl font-semibold">Claims</h1>

      <div className="app-panel-enter mt-4 flex flex-wrap items-end gap-3" role="group" aria-label="Claim filters">
        <div>
          <label htmlFor="claims-filter-work" className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Work</label>
          <select id="claims-filter-work" value={workId} onChange={onFilterChange(setWorkId)} className="app-control mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
            <option value="">All works</option>
            {memberWorks.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="claims-filter-nature" className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Nature</label>
          <select id="claims-filter-nature" value={claimNature} onChange={onFilterChange(setClaimNature)} className="app-control mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
            <option value="">All natures</option>
            {naturesInUse.map((n) => <option key={n} value={n}>{NATURE_LABEL[n] ?? n}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="claims-filter-anchor" className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Anchor</label>
          <select id="claims-filter-anchor" value={anchorState} onChange={onFilterChange(setAnchorState)} className="app-control mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
            <option value="">All anchors</option>
            {Object.entries(ANCHOR_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="claims-filter-verification" className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Verification</label>
          <select id="claims-filter-verification" value={verificationStatus} onChange={onFilterChange(setVerificationStatus)} className="app-control mt-1 rounded border border-[var(--color-border)] px-3 py-2 text-sm">
            <option value="">All statuses</option>
            {Object.entries(VERIFICATION_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {loading && <span className="text-sm text-[var(--color-text-muted)]" role="status">Loading…</span>}
      </div>

      {!result.claims.length && !loading && <p className="app-empty app-mount mt-4 rounded-lg p-6 text-sm text-[var(--color-text-muted)]">No claims match these filters yet.</p>}

      {/* Stage 5 §7: dual render, CSS-toggled at Tailwind's 768px `md:`
          breakpoint (the charter's own literal threshold). The table's fixed
          `min-w-[720px]` is dropped in favor of `table-fixed` column widths
          plus `truncate` on the Claim cell — between 768px and ~1023px an
          expanded rail plus content padding can leave less than 720px of
          real table width, which would still force the exact horizontal
          scroll this stage is asking to eliminate. Below 768px, the same
          `result.claims` data instead renders as one card per claim, the
          same card shape every other research list already uses
          (`CorpusView`, `MonitorsView`, `DebateClusterDetail`). */}
      {result.claims.length > 0 && (
        <>
          <div className="app-panel-enter mt-4 hidden overflow-x-auto md:block">
            <table className="w-full table-fixed border-collapse text-left text-sm">
              <caption className="sr-only">Claims for {project.title}, filtered by work, nature, anchor state, and verification status</caption>
              <thead>
                <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  <th scope="col" className="w-[40%] py-2 pr-4">Claim</th>
                  <th scope="col" className="w-[20%] py-2 pr-4">Work</th>
                  <th scope="col" className="w-[16%] py-2 pr-4">Nature</th>
                  <th scope="col" className="w-[12%] py-2 pr-4">Anchor</th>
                  <th scope="col" className="w-[12%] py-2 pr-4">Verification</th>
                </tr>
              </thead>
              <tbody>
                {result.claims.map((claim) => (
                  <tr key={claim.id} className="app-control border-b border-[var(--color-border)] align-top">
                    <td className="py-2 pr-4">
                      <Link href={`/research/claims/${claim.id}`} className="app-control block truncate underline" title={claim.claimText}>
                        {claim.claimText}
                      </Link>
                    </td>
                    <td className="truncate py-2 pr-4" title={claim.workTitle ?? claim.corpusItemTitle ?? undefined}>{claim.workTitle ?? claim.corpusItemTitle ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">{NATURE_LABEL[claim.claimNature] ?? claim.claimNature}</span>
                      {claim.sourceScope === "abstract" && (
                        <span className="app-control ml-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">From abstract</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{ANCHOR_LABEL[claim.anchorState] ?? claim.anchorState}</td>
                    <td className="py-2 pr-4">{VERIFICATION_LABEL[claim.verificationStatus] ?? claim.verificationStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="app-reveal-stagger mt-4 flex flex-col gap-3 md:hidden" aria-label={`Claims for ${project.title}`}>
            {result.claims.map((claim) => (
              <li key={claim.id} className="app-card app-mount rounded-lg p-4 text-sm">
                <Link href={`/research/claims/${claim.id}`} className="app-control font-medium underline">{claim.claimText}</Link>
                <p className="mt-1 text-[var(--color-text-muted)]">{claim.workTitle ?? claim.corpusItemTitle ?? "—"}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">{NATURE_LABEL[claim.claimNature] ?? claim.claimNature}</span>
                  {claim.sourceScope === "abstract" && (
                    <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-muted)]">From abstract</span>
                  )}
                  <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">{ANCHOR_LABEL[claim.anchorState] ?? claim.anchorState}</span>
                  <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">{VERIFICATION_LABEL[claim.verificationStatus] ?? claim.verificationStatus}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center gap-3" aria-label="Claims pagination">
          <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            Previous
          </button>
          <span className="text-sm text-[var(--color-text-muted)]">Page {page} of {totalPages}</span>
          <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
