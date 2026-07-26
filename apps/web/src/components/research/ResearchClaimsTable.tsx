"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Project = { id: string; title: string };
type MemberWork = { id: string; title: string };
type ClaimRow = {
  id: string;
  workId: string | null;
  workTitle: string | null;
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
}: {
  project: Project;
  initial: ListResult;
  naturesInUse: string[];
  memberWorks: MemberWork[];
}) {
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [workId, setWorkId] = useState("");
  const [claimNature, setClaimNature] = useState("");
  const [anchorState, setAnchorState] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [page, setPage] = useState(1);

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

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6" aria-labelledby="research-claims-title">
      <p className="text-sm font-medium text-[var(--color-accent)]">
        <Link href="/research" className="underline">Research</Link> / <Link href={`/research/${project.id}`} className="underline">{project.title}</Link>
      </p>
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

      <div className="app-panel-enter mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <caption className="sr-only">Claims for {project.title}, filtered by work, nature, anchor state, and verification status</caption>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              <th scope="col" className="py-2 pr-4">Claim</th>
              <th scope="col" className="py-2 pr-4">Work</th>
              <th scope="col" className="py-2 pr-4">Nature</th>
              <th scope="col" className="py-2 pr-4">Anchor</th>
              <th scope="col" className="py-2 pr-4">Verification</th>
            </tr>
          </thead>
          <tbody>
            {result.claims.map((claim) => (
              <tr key={claim.id} className="app-control border-b border-[var(--color-border)] align-top">
                <td className="py-2 pr-4">
                  <Link href={`/research/claims/${claim.id}`} className="app-control underline">{claim.claimText}</Link>
                </td>
                <td className="py-2 pr-4">{claim.workTitle ?? "—"}</td>
                <td className="py-2 pr-4">
                  <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs">{NATURE_LABEL[claim.claimNature] ?? claim.claimNature}</span>
                </td>
                <td className="py-2 pr-4">{ANCHOR_LABEL[claim.anchorState] ?? claim.anchorState}</td>
                <td className="py-2 pr-4">{VERIFICATION_LABEL[claim.verificationStatus] ?? claim.verificationStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!result.claims.length && !loading && <p className="app-empty app-mount mt-3 rounded-lg p-6 text-sm text-[var(--color-text-muted)]">No claims match these filters yet.</p>}
      </div>

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
