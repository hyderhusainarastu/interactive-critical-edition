import type { ConsistencyMismatch } from "../types";
import type { ConsistencySnapshot, RoadmapTargetRow } from "../snapshot";

/**
 * Check 6 — roadmap item (plan §20.7 bullet 6).
 *
 * `roadmap_override`/`reading_record`/`understanding_rating` can each target
 * a `bibliographic_record` directly (`bibId`). The Library's own dedup
 * (Phase 20.6/9.5) can mean the SAME real-world work is represented by
 * several distinct `bibliographic_record` rows (the canary-10 "one book,
 * five records" shape this project has documented since Phase 8) — each of
 * which independently survives record-level dedup. `learning_resource` is
 * what settles which one is canonical (`work_role = 'primary'` for its
 * `work_identity`). A roadmap item set against a NON-canonical duplicate
 * bib record — one the Library itself no longer shows as the work's primary
 * entry — has silently fallen out of step with what the Library displays for
 * the same work.
 *
 * Repair repoints the roadmap item's `bibId` to the canonical
 * `learning_resource`'s own `bib_record_id`, and only when that canonical
 * projection actually has one — never invented.
 */
function findCanonicalBibId(
  bibId: string,
  lrByBibId: Map<string, { id: string; workIdentityId: string | null; bibRecordId: string | null }>,
  primaryLrByWorkIdentity: Map<string, { id: string; bibRecordId: string | null }>,
): { canonicalBibId: string; canonicalLearningResourceId: string } | null {
  const lr = lrByBibId.get(bibId);
  if (!lr?.workIdentityId) return null;
  const canonical = primaryLrByWorkIdentity.get(lr.workIdentityId);
  if (!canonical?.bibRecordId || canonical.bibRecordId === bibId) return null;
  return { canonicalBibId: canonical.bibRecordId, canonicalLearningResourceId: canonical.id };
}

function checkTable(rows: RoadmapTargetRow[], table: string, snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  const lrByBibId = new Map(
    snapshot.learningResources.filter((lr) => lr.bibRecordId).map((lr) => [lr.bibRecordId as string, lr]),
  );
  const primaryLrByWorkIdentity = new Map<string, { id: string; bibRecordId: string | null }>();
  for (const lr of snapshot.learningResources) {
    if (lr.workRole === "primary" && lr.workIdentityId && !primaryLrByWorkIdentity.has(lr.workIdentityId)) {
      primaryLrByWorkIdentity.set(lr.workIdentityId, { id: lr.id, bibRecordId: lr.bibRecordId });
    }
  }

  const mismatches: ConsistencyMismatch[] = [];
  for (const row of rows) {
    if (!row.bibId) continue;
    const canonical = findCanonicalBibId(row.bibId, lrByBibId, primaryLrByWorkIdentity);
    if (!canonical) continue;
    mismatches.push({
      checkId: "roadmap-item-target",
      entityType: table,
      entityId: row.id,
      description: `${table}.bib_id references a non-canonical duplicate bibliographic_record; the Library shows a different record as this work's primary entry.`,
      severity: "warning",
      evidence: { staleBibId: row.bibId, canonicalBibId: canonical.canonicalBibId, canonicalLearningResourceId: canonical.canonicalLearningResourceId },
      repair: {
        kind: "update",
        table,
        id: row.id,
        patch: { bibId: canonical.canonicalBibId },
        reason: `learning_resource ${canonical.canonicalLearningResourceId} is the primary Library entry for this work and carries bib_record_id ${canonical.canonicalBibId}.`,
      },
    });
  }
  return mismatches;
}

export function checkRoadmapItemTarget(snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  return [
    ...checkTable(snapshot.roadmapOverrides, "roadmap_override", snapshot),
    ...checkTable(snapshot.readingRecords, "reading_record", snapshot),
    ...checkTable(snapshot.understandingRatings, "understanding_rating", snapshot),
  ];
}
