"use client";

import { useState } from "react";

export type CorrectableObjectType = "claim" | "relationship" | "cluster" | "chamber" | "hypothesis" | "gap";

const VERIFICATION_LABEL: Record<string, string> = {
  unreviewed: "Unreviewed",
  user_verified: "Verified",
  source_verified: "Source-verified",
  disputed: "Disputed",
  rejected: "Rejected",
};

const ACTION_LABEL: Record<string, string> = {
  generated: "Generated",
  verified: "Verified",
  disputed: "Disputed",
  edited: "Edited",
  split: "Split",
  merged: "Merged",
  hidden: "Hidden",
  restored: "Restored",
  reclassified: "Reclassified",
};

interface RevisionRow {
  id: string;
  revision: number;
  action: string;
  before: unknown;
  after: unknown;
  editor: string;
  editorUserId: string | null;
  reason: string | null;
  relatedObjectIds: unknown;
  createdAt: string;
}

const DIFF_SKIP_KEYS = new Set(["id", "userId", "user_id", "createdAt", "created_at", "updatedAt", "updated_at"]);

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value.length > 140 ? `${value.slice(0, 140)}…` : value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Summarizes what changed between one revision's `before`/`after`
 *  snapshots — the history drawer's whole diff view. `before === null`
 *  (revision 0, whether a backfilled/real `generated` system snapshot or a
 *  split/merge's brand-new claim) has nothing to diff against, so it's left
 *  to the caller to render as "initial state" rather than a wall of
 *  every-field-added noise. */
function diffSummary(before: Record<string, unknown> | null, after: Record<string, unknown> | null): { key: string; from: string; to: string }[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const diffs: { key: string; from: string; to: string }[] = [];
  for (const key of keys) {
    if (DIFF_SKIP_KEYS.has(key)) continue;
    const fromValue = before[key];
    const toValue = after[key];
    if (JSON.stringify(fromValue) === JSON.stringify(toValue)) continue;
    diffs.push({ key: humanizeKey(key), from: formatValue(fromValue), to: formatValue(toValue) });
  }
  return diffs;
}

function RevisionEntry({ revision }: { revision: RevisionRow }) {
  const diffs = diffSummary(revision.before as Record<string, unknown> | null, revision.after as Record<string, unknown> | null);
  const related = Array.isArray(revision.relatedObjectIds) ? (revision.relatedObjectIds as string[]) : [];
  return (
    <li className="rounded border border-[var(--color-border)] p-2 text-xs">
      <p className="font-medium">
        Revision {revision.revision} — {ACTION_LABEL[revision.action] ?? revision.action}
        <span className="ml-2 text-[var(--color-text-muted)]">
          {revision.editor === "system" ? "System" : "You"} · {new Date(revision.createdAt).toLocaleString()}
        </span>
      </p>
      {revision.reason && <p className="mt-1 text-[var(--color-text-muted)]">Reason: {revision.reason}</p>}
      {diffs.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {diffs.map((d) => (
            <li key={d.key}>
              <span className="font-medium">{d.key}:</span> {d.from} → {d.to}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[var(--color-text-muted)]">Initial recorded state.</p>
      )}
      {related.length > 0 && <p className="mt-1 text-[var(--color-text-muted)]">Related: {related.join(", ")}</p>}
    </li>
  );
}

export function RevisionHistoryDrawer({ objectType, objectId }: { objectType: CorrectableObjectType; objectId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [revisions, setRevisions] = useState<RevisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (revisions !== null) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/research/revisions?objectType=${objectType}&objectId=${objectId}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load history.");
      setRevisions(body.revisions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load history.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <button type="button" className="app-control underline" onClick={toggle} aria-expanded={open}>
        {open ? "Hide history" : "History"}
      </button>
      {open && (
        <div className="app-panel-enter mt-2 rounded border border-[var(--color-border)] p-2">
          {loading && (
            <p className="text-xs text-[var(--color-text-muted)]" role="status">
              Loading history…
            </p>
          )}
          {error && <p className="text-xs text-[var(--color-error,#b3261e)]">{error}</p>}
          {revisions && revisions.length === 0 && <p className="text-xs text-[var(--color-text-muted)]">No revision history yet.</p>}
          {revisions && revisions.length > 0 && (
            <ul className="space-y-2">
              {[...revisions].reverse().map((r) => (
                <RevisionEntry key={r.id} revision={r} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The generic verify/dispute/hide/restore correction control, shared by
 * every object type (plan §Build "verify/dispute buttons with reason
 * capture, hide/restore ... verification-status chips update everywhere
 * they render"). Claim-only actions (edit/reclassify/split/merge) live in
 * `ClaimCorrectionExtras.tsx` — this component alone is sufficient for
 * relationship/cluster/chamber/hypothesis/gap, and is composed alongside
 * the claim-only extras on the claim permalink page.
 */
export function ResearchCorrectionControls({
  objectType,
  objectId,
  verificationStatus: initialVerificationStatus,
  hidden: initialHidden,
  compact = false,
  onChanged,
}: {
  objectType: CorrectableObjectType;
  objectId: string;
  verificationStatus: string;
  hidden: boolean;
  compact?: boolean;
  onChanged?: (patch: { verificationStatus?: string; hidden?: boolean }) => void;
}) {
  const [verificationStatus, setVerificationStatus] = useState(initialVerificationStatus);
  const [hidden, setHidden] = useState(initialHidden);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");

  async function apply(action: "verified" | "disputed" | "hidden" | "restored", withReason?: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/research/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectType, objectId, action, reason: withReason || undefined }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not apply this correction.");
      if (action === "verified") {
        setVerificationStatus("user_verified");
        onChanged?.({ verificationStatus: "user_verified" });
      } else if (action === "disputed") {
        setVerificationStatus("disputed");
        onChanged?.({ verificationStatus: "disputed" });
      } else if (action === "hidden") {
        setHidden(true);
        onChanged?.({ hidden: true });
      } else if (action === "restored") {
        setHidden(false);
        onChanged?.({ hidden: false });
      }
      setDisputing(false);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply this correction.");
    } finally {
      setBusy(false);
    }
  }

  const textSize = compact ? "text-[0.68rem]" : "text-xs";

  return (
    <div className={`${textSize}`} data-research-correction-controls={objectType}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5" data-verification-chip>
          {VERIFICATION_LABEL[verificationStatus] ?? verificationStatus}
        </span>
        {hidden && <span className="app-control rounded-full border border-[var(--color-border)] px-2 py-0.5">Hidden</span>}
        <button type="button" className="app-control app-press underline disabled:opacity-50" onClick={() => apply("verified")} disabled={busy}>
          Verify
        </button>
        <button type="button" className="app-control app-press underline disabled:opacity-50" onClick={() => setDisputing((v) => !v)} disabled={busy}>
          Dispute
        </button>
        <button
          type="button"
          className="app-control app-press underline disabled:opacity-50"
          onClick={() => apply(hidden ? "restored" : "hidden")}
          disabled={busy}
        >
          {hidden ? "Restore" : "Hide"}
        </button>
      </div>

      {disputing && (
        <div className="app-panel-enter mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`dispute-reason-${objectType}-${objectId}`}>
            Reason for disputing
          </label>
          <input
            id={`dispute-reason-${objectType}-${objectId}`}
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why does this look wrong? (optional)"
            className="app-control min-w-0 flex-1 rounded border border-[var(--color-border)] px-2 py-1"
          />
          <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-50" onClick={() => apply("disputed", reason)} disabled={busy}>
            Confirm dispute
          </button>
          <button type="button" className="app-control underline" onClick={() => setDisputing(false)}>
            Cancel
          </button>
        </div>
      )}

      {error && <p className="mt-1 text-[var(--color-error,#b3261e)]">{error}</p>}

      <RevisionHistoryDrawer objectType={objectType} objectId={objectId} />
    </div>
  );
}
