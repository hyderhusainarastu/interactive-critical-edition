"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
const NATURE_VALUES = Object.keys(NATURE_LABEL);

interface CorrectionApiResult {
  ok: boolean;
  error?: string;
  objectId?: string;
  newClaimIds?: string[];
}

async function postCorrection(body: Record<string, unknown>): Promise<CorrectionApiResult> {
  const response = await fetch("/api/research/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json();
  if (!response.ok) return { ok: false, error: parsed.error ?? "The correction could not be applied." };
  return { ok: true, ...parsed };
}

/**
 * Claim-only correction actions (plan §Build "edit dialogs for claim text
 * (with the substring re-validation for excerpt edits — an edited claim
 * whose excerpt no longer matches goes anchor_state='unanchored', never
 * silently), reclassify (claim_nature picker), split/merge flows for
 * claims"). Composed alongside `ResearchCorrectionControls` (verify/
 * dispute/hide/restore + history) on the claim permalink page — this
 * component owns only the four actions no other object type has.
 */
export function ClaimCorrectionExtras({
  claimId,
  claimText: initialClaimText,
  supportingExcerpt: initialSupportingExcerpt,
  claimNature: initialClaimNature,
  anchorState,
}: {
  claimId: string;
  claimText: string;
  supportingExcerpt: string;
  claimNature: string;
  anchorState: string;
}) {
  const router = useRouter();

  // Edit
  const [editing, setEditing] = useState(false);
  const [claimTextDraft, setClaimTextDraft] = useState(initialClaimText);
  const [excerptDraft, setExcerptDraft] = useState(initialSupportingExcerpt);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);

  // Reclassify
  const [reclassifying, setReclassifying] = useState(false);
  const [natureDraft, setNatureDraft] = useState(initialClaimNature);
  const [reclassifyBusy, setReclassifyBusy] = useState(false);
  const [reclassifyError, setReclassifyError] = useState<string | null>(null);

  // Split
  const [splitting, setSplitting] = useState(false);
  const [excerptParts, setExcerptParts] = useState(["", ""]);
  const [splitBusy, setSplitBusy] = useState(false);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [splitResultIds, setSplitResultIds] = useState<string[] | null>(null);

  // Merge
  const [merging, setMerging] = useState(false);
  const [otherIdsDraft, setOtherIdsDraft] = useState("");
  const [mergedClaimText, setMergedClaimText] = useState("");
  const [mergedExcerpt, setMergedExcerpt] = useState("");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const [mergeResultId, setMergeResultId] = useState<string | null>(null);

  async function saveEdit() {
    setEditBusy(true);
    setEditError(null);
    setEditNotice(null);
    const changes: { claimText?: string; supportingExcerpt?: string } = {};
    if (claimTextDraft.trim() !== initialClaimText.trim()) changes.claimText = claimTextDraft;
    if (excerptDraft.trim() !== initialSupportingExcerpt.trim()) changes.supportingExcerpt = excerptDraft;
    if (Object.keys(changes).length === 0) {
      setEditBusy(false);
      setEditing(false);
      return;
    }
    const result = await postCorrection({ objectType: "claim", objectId: claimId, action: "edited", changes });
    if (!result.ok) {
      setEditError(result.error ?? "Could not save this edit.");
      setEditBusy(false);
      return;
    }
    setEditing(false);
    setEditBusy(false);
    if (changes.supportingExcerpt) {
      setEditNotice("Saved. If the new excerpt no longer matches the source text, its anchor is now marked unanchored rather than silently kept.");
    }
    router.refresh();
  }

  async function saveReclassify() {
    setReclassifyBusy(true);
    setReclassifyError(null);
    const result = await postCorrection({ objectType: "claim", objectId: claimId, action: "reclassified", changes: { claimNature: natureDraft } });
    setReclassifyBusy(false);
    if (!result.ok) {
      setReclassifyError(result.error ?? "Could not reclassify this claim.");
      return;
    }
    setReclassifying(false);
    router.refresh();
  }

  async function submitSplit() {
    setSplitBusy(true);
    setSplitError(null);
    const excerpts = excerptParts.map((e) => e.trim()).filter((e) => e.length > 0);
    if (excerpts.length < 2) {
      setSplitError("Provide at least two non-empty excerpts.");
      setSplitBusy(false);
      return;
    }
    const result = await postCorrection({ objectType: "claim", objectId: claimId, action: "split", changes: { excerpts } });
    setSplitBusy(false);
    if (!result.ok) {
      setSplitError(result.error ?? "Could not split this claim.");
      return;
    }
    setSplitResultIds(result.newClaimIds ?? []);
    setSplitting(false);
    router.refresh();
  }

  async function submitMerge() {
    setMergeBusy(true);
    setMergeError(null);
    const otherClaimIds = otherIdsDraft
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    if (otherClaimIds.length === 0) {
      setMergeError("Provide at least one other claim id to merge with.");
      setMergeBusy(false);
      return;
    }
    if (!mergedClaimText.trim() || !mergedExcerpt.trim()) {
      setMergeError("Provide the merged claim's text and supporting excerpt.");
      setMergeBusy(false);
      return;
    }
    const result = await postCorrection({
      objectType: "claim",
      objectId: claimId,
      action: "merged",
      changes: { otherClaimIds, claimText: mergedClaimText, supportingExcerpt: mergedExcerpt },
    });
    setMergeBusy(false);
    if (!result.ok) {
      setMergeError(result.error ?? "Could not merge these claims.");
      return;
    }
    setMergeResultId(result.objectId ?? null);
    setMerging(false);
    router.refresh();
  }

  return (
    <section className="app-card app-panel-enter mt-6 rounded-lg p-4" aria-labelledby="claim-corrections-title">
      <h2 id="claim-corrections-title" className="font-serif text-lg font-semibold">
        Correct this claim
      </h2>

      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <button type="button" className="app-control app-press underline" onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel edit" : "Edit"}
        </button>
        <button type="button" className="app-control app-press underline" onClick={() => setReclassifying((v) => !v)}>
          {reclassifying ? "Cancel reclassify" : "Reclassify"}
        </button>
        <button type="button" className="app-control app-press underline" onClick={() => setSplitting((v) => !v)}>
          {splitting ? "Cancel split" : "Split"}
        </button>
        <button type="button" className="app-control app-press underline" onClick={() => setMerging((v) => !v)}>
          {merging ? "Cancel merge" : "Merge with another claim"}
        </button>
      </div>

      {editNotice && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{editNotice}</p>}
      {anchorState === "unanchored" && !editing && (
        <p className="mt-2 text-xs text-[var(--color-error,#b3261e)]">This claim&apos;s anchor is currently unanchored.</p>
      )}

      {editing && (
        <div className="app-panel-enter mt-3 space-y-3 rounded border border-[var(--color-border)] p-3 text-sm">
          <div>
            <label className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]" htmlFor="claim-edit-text">
              Claim text
            </label>
            <textarea
              id="claim-edit-text"
              className="app-control mt-1 w-full rounded border border-[var(--color-border)] p-2 text-sm"
              rows={2}
              value={claimTextDraft}
              onChange={(e) => setClaimTextDraft(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]" htmlFor="claim-edit-excerpt">
              Supporting excerpt
            </label>
            <textarea
              id="claim-edit-excerpt"
              className="app-control mt-1 w-full rounded border border-[var(--color-border)] p-2 text-sm"
              rows={2}
              value={excerptDraft}
              onChange={(e) => setExcerptDraft(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-50" onClick={saveEdit} disabled={editBusy}>
              {editBusy ? "Saving…" : "Save"}
            </button>
          </div>
          {editError && <p className="text-xs text-[var(--color-error,#b3261e)]">{editError}</p>}
        </div>
      )}

      {reclassifying && (
        <div className="app-panel-enter mt-3 flex flex-wrap items-center gap-2 rounded border border-[var(--color-border)] p-3 text-sm">
          <label className="sr-only" htmlFor="claim-reclassify-nature">
            Claim nature
          </label>
          <select id="claim-reclassify-nature" className="app-control rounded border border-[var(--color-border)] px-2 py-1" value={natureDraft} onChange={(e) => setNatureDraft(e.target.value)}>
            {NATURE_VALUES.map((n) => (
              <option key={n} value={n}>
                {NATURE_LABEL[n]}
              </option>
            ))}
          </select>
          <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-50" onClick={saveReclassify} disabled={reclassifyBusy}>
            {reclassifyBusy ? "Saving…" : "Save"}
          </button>
          {reclassifyError && <p className="text-xs text-[var(--color-error,#b3261e)]">{reclassifyError}</p>}
        </div>
      )}

      {splitting && (
        <div className="app-panel-enter mt-3 space-y-2 rounded border border-[var(--color-border)] p-3 text-sm">
          <p className="text-xs text-[var(--color-text-muted)]">
            Each part must be a literal substring of this claim&apos;s own supporting excerpt: “{initialSupportingExcerpt}”.
          </p>
          {excerptParts.map((value, index) => (
            <div key={index}>
              <label className="sr-only" htmlFor={`split-excerpt-${index}`}>
                Split part {index + 1}
              </label>
              <textarea
                id={`split-excerpt-${index}`}
                className="app-control w-full rounded border border-[var(--color-border)] p-2 text-sm"
                rows={2}
                value={value}
                onChange={(e) => setExcerptParts((parts) => parts.map((p, i) => (i === index ? e.target.value : p)))}
                placeholder={`Part ${index + 1} excerpt`}
              />
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-3 py-1.5" onClick={() => setExcerptParts((parts) => [...parts, ""])}>
              Add another part
            </button>
            <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-50" onClick={submitSplit} disabled={splitBusy}>
              {splitBusy ? "Splitting…" : "Split claim"}
            </button>
          </div>
          {splitError && <p className="text-xs text-[var(--color-error,#b3261e)]">{splitError}</p>}
        </div>
      )}
      {splitResultIds && splitResultIds.length > 0 && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          This claim was split into:{" "}
          {splitResultIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <Link href={`/research/claims/${id}`} className="underline">
                part {i + 1}
              </Link>
            </span>
          ))}
        </p>
      )}

      {merging && (
        <div className="app-panel-enter mt-3 space-y-2 rounded border border-[var(--color-border)] p-3 text-sm">
          <div>
            <label className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]" htmlFor="merge-other-ids">
              Other claim id(s) to merge in (comma or newline separated)
            </label>
            <textarea
              id="merge-other-ids"
              className="app-control mt-1 w-full rounded border border-[var(--color-border)] p-2 text-sm"
              rows={2}
              value={otherIdsDraft}
              onChange={(e) => setOtherIdsDraft(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]" htmlFor="merge-claim-text">
              Merged claim text
            </label>
            <textarea
              id="merge-claim-text"
              className="app-control mt-1 w-full rounded border border-[var(--color-border)] p-2 text-sm"
              rows={2}
              value={mergedClaimText}
              onChange={(e) => setMergedClaimText(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-[var(--color-text-muted)]" htmlFor="merge-excerpt">
              Merged supporting excerpt (must be a literal substring of one of the original claims&apos; excerpts)
            </label>
            <textarea
              id="merge-excerpt"
              className="app-control mt-1 w-full rounded border border-[var(--color-border)] p-2 text-sm"
              rows={2}
              value={mergedExcerpt}
              onChange={(e) => setMergedExcerpt(e.target.value)}
            />
          </div>
          <button type="button" className="app-control app-press rounded border border-[var(--color-border)] px-3 py-1.5 disabled:opacity-50" onClick={submitMerge} disabled={mergeBusy}>
            {mergeBusy ? "Merging…" : "Merge claims"}
          </button>
          {mergeError && <p className="text-xs text-[var(--color-error,#b3261e)]">{mergeError}</p>}
        </div>
      )}
      {mergeResultId && (
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          These claims were merged into{" "}
          <Link href={`/research/claims/${mergeResultId}`} className="underline">
            a new claim
          </Link>
          .
        </p>
      )}
    </section>
  );
}
