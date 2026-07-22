import type { ConsistencyMismatch } from "../types";
import type { ConsistencySnapshot } from "../snapshot";

/**
 * Check 5 — annotation related work (plan §20.7 bullet 5).
 *
 * `annotation.target_bib_id` is `ON DELETE SET NULL`, so it cannot dangle —
 * Postgres itself keeps that FK honest. What CAN drift is the paired
 * free-text `target_label` (kept "as a human-readable fallback", per the
 * schema's own comment): it is a point-in-time copy taken when the
 * annotation was created, and nothing keeps it in sync if the resolved
 * bibliographic record's title is later corrected (a re-resolution, an
 * upstream provider fix). When both are present and disagree, the resolved
 * `bibliographic_record.title` — the actual canonical target this
 * annotation points at — is authoritative; repair resyncs the label from it.
 * This is a resync from an already-resolved FK target, not a guess.
 */
export function checkAnnotationRelatedWork(snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  const mismatches: ConsistencyMismatch[] = [];
  const bibById = new Map(snapshot.bibliographicRecords.map((b) => [b.id, b]));

  for (const annotation of snapshot.annotations) {
    if (!annotation.targetBibId) continue;
    const bib = bibById.get(annotation.targetBibId);
    if (!bib) {
      // FK is ON DELETE SET NULL — a non-null targetBibId with no matching
      // row would mean the snapshot was read mid-transaction elsewhere.
      // Report only; never guess a replacement target.
      mismatches.push({
        checkId: "annotation-related-work",
        entityType: "annotation",
        entityId: annotation.id,
        description: "annotation.target_bib_id references a bibliographic_record row that no longer exists.",
        severity: "critical",
        evidence: { targetBibId: annotation.targetBibId },
        repair: null,
      });
      continue;
    }
    if (annotation.targetLabel && annotation.targetLabel.trim() !== bib.title.trim()) {
      mismatches.push({
        checkId: "annotation-related-work",
        entityType: "annotation",
        entityId: annotation.id,
        description: "annotation.target_label has drifted from the resolved bibliographic_record's title.",
        severity: "info",
        evidence: { targetLabel: annotation.targetLabel, resolvedTitle: bib.title },
        repair: {
          kind: "update",
          table: "annotation",
          id: annotation.id,
          patch: { targetLabel: bib.title },
          reason: `bibliographic_record ${bib.id} (this annotation's already-resolved FK target) carries title "${bib.title}"; resyncing the display label from it, not guessing a new one.`,
        },
      });
    }
  }

  return mismatches;
}
