"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CategoryGlyph } from "@/components/shared/annotationPrimitives";
import { CATEGORY_META, confidenceLabel, VERIFICATION_LABELS } from "./annotationMeta";
import type { AnalysisStatus, AnnotationRecord, RelationshipCategory, VerificationStatus } from "./types";

type SortKey = "confidence" | "category" | "verification";
const SORT_LABEL: Record<SortKey, string> = {
  confidence: "Confidence",
  category: "Category",
  verification: "Review status",
};

/**
 * The scholarly-analysis panel (plan §12): every AI annotation shown with
 * its relationship category (glyph + label + color, never color alone),
 * the resolved target work and its access status, an always-visible
 * confidence, honest provenance (which model — or the heuristic stub when
 * no key is configured), the verbatim triggering passage, and the full
 * user-correction workflow (verify / dispute / reject / hide / edit).
 * A non-dismissible disclaimer sits at the top: this is a research aid,
 * not settled scholarship.
 */
export function AnnotationsPanel({
  annotations,
  analysisStatus,
  analysisError,
  activeId,
  onUpdate,
  onReanalyze,
}: {
  annotations: AnnotationRecord[];
  analysisStatus: AnalysisStatus;
  analysisError: string | null;
  activeId: string | null;
  onUpdate: (id: string, patch: Partial<Pick<AnnotationRecord, "verificationStatus" | "hidden" | "explanation">>) => void;
  onReanalyze: () => void;
}) {
  const [showHidden, setShowHidden] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<RelationshipCategory | "">("");
  const [verificationFilter, setVerificationFilter] = useState<VerificationStatus | "">("");
  const [sort, setSort] = useState<SortKey>("confidence");

  // Categories/statuses actually present, derived from the full set (not the
  // filtered one) so option lists don't shrink as filters narrow the list.
  const categories = useMemo(
    () => [...new Set(annotations.map((a) => a.relationshipCategory))].sort((a, b) => CATEGORY_META[a].label.localeCompare(CATEGORY_META[b].label)),
    [annotations],
  );
  const verificationStatuses = useMemo(() => [...new Set(annotations.map((a) => a.verificationStatus))], [annotations]);

  const visible = useMemo(() => {
    let filtered = annotations.filter((a) => (showHidden ? true : !a.hidden));
    if (categoryFilter) filtered = filtered.filter((a) => a.relationshipCategory === categoryFilter);
    if (verificationFilter) filtered = filtered.filter((a) => a.verificationStatus === verificationFilter);
    // The server returns a stable confidence-desc order (see
    // getAnnotationsForDocument); Array#sort is spec-stable since ES2019, so
    // re-sorting by a different key here never scrambles ties within that key
    // — the confidence-desc order still holds for anything not distinguished
    // by the chosen sort, and choosing "Confidence" again is a no-op.
    const sorted = [...filtered];
    if (sort === "category") sorted.sort((a, b) => CATEGORY_META[a.relationshipCategory].label.localeCompare(CATEGORY_META[b.relationshipCategory].label));
    else if (sort === "verification") sorted.sort((a, b) => VERIFICATION_LABELS[a.verificationStatus].localeCompare(VERIFICATION_LABELS[b.verificationStatus]));
    else sorted.sort((a, b) => b.confidence - a.confidence);
    return sorted;
  }, [annotations, showHidden, categoryFilter, verificationFilter, sort]);

  const anyHeuristic = annotations.some((a) => a.isHeuristic);

  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Scholarly analysis</h2>
          <AnalysisBadge status={analysisStatus} />
        </div>
        <p className="mt-1.5 rounded-md bg-[color-mix(in_srgb,var(--color-accent-umber)_10%,transparent)] px-2 py-1 text-[0.72rem] leading-snug text-[var(--color-text-muted)]">
          Automated research aid — every claim below carries a confidence and its source. Verify against the primary
          text before relying on it.
        </p>
        {anyHeuristic && (
          <p className="mt-1.5 text-[0.72rem] leading-snug text-[var(--color-accent-burgundy)]">
            No classification model is configured, so these were produced by a deterministic rule-based fallback. Add
            a provider key for model-backed classification.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[0.72rem]">
        <button type="button" className="underline" onClick={() => setShowLegend((v) => !v)}>
          {showLegend ? "Hide legend" : "Legend"}
        </button>
        <button type="button" className="underline" onClick={() => setShowHidden((v) => !v)}>
          {showHidden ? "Hide dismissed" : "Show dismissed"}
        </button>
        <button
          type="button"
          className="ml-auto underline disabled:opacity-50"
          onClick={onReanalyze}
          disabled={analysisStatus === "analyzing"}
        >
          {analysisStatus === "analyzing" ? "Analyzing…" : "Re-analyze"}
        </button>
      </div>

      <div className="flex flex-col gap-1.5 border-b border-[var(--color-border)] px-4 py-2 text-[0.72rem]">
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--color-text-muted)]">Category</span>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as RelationshipCategory | "")}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_META[c].label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--color-text-muted)]">Review status</span>
          <select
            value={verificationFilter}
            onChange={(e) => setVerificationFilter(e.target.value as VerificationStatus | "")}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"
          >
            <option value="">All statuses</option>
            {verificationStatuses.map((s) => (
              <option key={s} value={s}>
                {VERIFICATION_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[var(--color-text-muted)]">Sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-1"
          >
            {(Object.entries(SORT_LABEL) as Array<[SortKey, string]>).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[var(--color-text-muted)]">
          {visible.length} of {annotations.length}
        </span>
      </div>

      {showLegend && (
        <ul className="grid grid-cols-1 gap-1 px-4 pb-2 text-[0.72rem]">
          {Object.entries(CATEGORY_META).map(([key, meta]) => (
            <li key={key} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[0.6rem] font-bold text-[var(--color-background)]"
                style={{ background: `var(${meta.colorVar})` }}
              >
                {meta.glyph}
              </span>
              <span className="text-[var(--color-text-muted)]">{meta.label}</span>
            </li>
          ))}
        </ul>
      )}

      {analysisStatus === "failed" && (
        <p className="mx-4 my-2 rounded-md border border-[var(--color-accent-burgundy)] px-3 py-2 text-[0.75rem] text-[var(--color-accent-burgundy)]">
          Analysis failed{analysisError ? `: ${analysisError}` : "."} Try re-analyzing.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="px-4 py-6 text-[0.8rem] text-[var(--color-text-muted)]">
          {analysisStatus === "analyzing"
            ? "Analyzing the text for references and scholarly context…"
            : analysisStatus === "complete"
              ? "No annotations were found for this work."
              : "No annotations yet."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2 px-3 py-2">
          {visible.map((a) => (
            <AnnotationCard key={a.id} annotation={a} active={a.id === activeId} onUpdate={onUpdate} />
          ))}
        </ul>
      )}
    </aside>
  );
}

function AnalysisBadge({ status }: { status: AnalysisStatus }) {
  const map: Record<AnalysisStatus, { label: string; color: string }> = {
    not_started: { label: "Not analyzed", color: "--color-text-muted" },
    analyzing: { label: "Analyzing…", color: "--color-accent-ink" },
    complete: { label: "Complete", color: "--color-accent-green" },
    failed: { label: "Failed", color: "--color-accent-burgundy" },
  };
  const { label, color } = map[status];
  return (
    <span className="text-[0.68rem] font-medium" style={{ color: `var(${color})` }}>
      {label}
    </span>
  );
}

function AnnotationCard({
  annotation: a,
  active,
  onUpdate,
}: {
  annotation: AnnotationRecord;
  active: boolean;
  onUpdate: (id: string, patch: Partial<Pick<AnnotationRecord, "verificationStatus" | "hidden" | "explanation">>) => void;
}) {
  const meta = CATEGORY_META[a.relationshipCategory];
  const ref = useRef<HTMLLIElement | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.explanation);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);

  const rejected = a.verificationStatus === "rejected";

  return (
    <li
      ref={ref}
      data-annotation-card={a.id}
      className="rounded-lg border bg-[var(--color-background)] p-3"
      style={{
        borderColor: active ? `var(${meta.colorVar})` : "var(--color-border)",
        opacity: rejected ? 0.55 : 1,
      }}
    >
      <div className="flex items-center gap-2">
        <CategoryGlyph colorVar={meta.colorVar} glyph={meta.glyph} className="shrink-0" />
        <span className="text-[0.72rem] font-semibold" style={{ color: `var(${meta.colorVar})` }}>
          {meta.label}
        </span>
        <span
          className="ml-auto text-[0.68rem] text-[var(--color-text-muted)]"
          title={`Confidence ${(a.confidence * 100).toFixed(0)}%`}
        >
          {confidenceLabel(a.confidence)} · {(a.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <p className="mt-1.5 text-[0.86rem] font-medium leading-snug text-[var(--color-text)]">{a.targetLabel}</p>

      {a.target && (
        <p className="mt-0.5 text-[0.72rem] text-[var(--color-text-muted)]">
          {a.target.year ? `${a.target.year} · ` : ""}
          {accessLabel(a.target.accessStatus)}
          {a.target.url && (
            <>
              {" · "}
              <a href={a.target.url} target="_blank" rel="noopener noreferrer" className="underline">
                open ↗
              </a>
            </>
          )}
        </p>
      )}

      {editing ? (
        <div className="mt-2">
          <textarea
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 text-[0.8rem]"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="mt-1 flex gap-2 text-[0.72rem]">
            <button
              type="button"
              className="underline"
              onClick={() => {
                onUpdate(a.id, { explanation: draft });
                setEditing(false);
              }}
            >
              Save
            </button>
            <button type="button" className="underline" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 text-[0.8rem] leading-snug text-[var(--color-text-muted)]">{a.explanation}</p>
      )}

      {a.extractedSourceText && (
        <blockquote className="mt-2 border-l-2 border-[var(--color-border)] pl-2 text-[0.72rem] italic leading-snug text-[var(--color-text-muted)]">
          “{a.extractedSourceText.slice(0, 220)}
          {a.extractedSourceText.length > 220 ? "…" : ""}”
        </blockquote>
      )}

      <p className="mt-2 text-[0.68rem] text-[var(--color-text-muted)]">
        {a.createdBy === "user" ? "Edited by you" : a.isHeuristic ? "Rule-based fallback (no model key configured)" : `Model: ${a.modelUsed}`}
        {" · "}
        {VERIFICATION_LABELS[a.verificationStatus]}
      </p>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.72rem]">
        <StatusButton current={a.verificationStatus} value="user_verified" label="Verify" onUpdate={(v) => onUpdate(a.id, { verificationStatus: v })} />
        <StatusButton current={a.verificationStatus} value="disputed" label="Dispute" onUpdate={(v) => onUpdate(a.id, { verificationStatus: v })} />
        <StatusButton current={a.verificationStatus} value="rejected" label="Reject" onUpdate={(v) => onUpdate(a.id, { verificationStatus: v })} />
        <button type="button" className="underline" onClick={() => setEditing((v) => !v)}>
          Edit
        </button>
        <button type="button" className="ml-auto underline" onClick={() => onUpdate(a.id, { hidden: !a.hidden })}>
          {a.hidden ? "Unhide" : "Hide"}
        </button>
      </div>
    </li>
  );
}

function StatusButton({
  current,
  value,
  label,
  onUpdate,
}: {
  current: VerificationStatus;
  value: VerificationStatus;
  label: string;
  onUpdate: (v: VerificationStatus) => void;
}) {
  const isActive = current === value;
  return (
    <button
      type="button"
      aria-pressed={isActive}
      className="underline"
      style={{ fontWeight: isActive ? 700 : 400 }}
      // Toggling an active status back to unreviewed lets a misclick be undone.
      onClick={() => onUpdate(isActive ? "unreviewed" : value)}
    >
      {label}
    </button>
  );
}

function accessLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open access";
    case "subscription":
      return "Subscription";
    case "metadata_only":
      return "Metadata only";
    case "user_uploaded":
      return "In your library";
    case "unavailable":
      return "Not accessible";
    default:
      return status;
  }
}
