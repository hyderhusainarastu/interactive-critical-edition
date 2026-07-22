import type { ConsistencyMismatch } from "../types";
import type { ConsistencySnapshot } from "../snapshot";

/**
 * Check 1 — citation → Library item (plan §20.7 bullet 1).
 *
 * `citation_library_link` projects a resolved citation into the Library
 * (`packages/db/src/schema.ts`'s own doc comment: "keeps citation provenance
 * many-to-one"). Two ways this can drift:
 *
 *  - a citation resolved to a bibliographic record (`resolvedBibId` set) has
 *    NO library-link row at all, even though a `learning_resource` already
 *    exists for that exact bib record — a missed projection, repairable by
 *    inserting the missing link (the canonical target already exists; this
 *    is not a guess, it's catching up state that should already be there);
 *  - a library-link row exists but points at a `learning_resource` whose
 *    `bibRecordId` disagrees with the citation's own `resolvedBibId` — the
 *    Library entry shown for this citation is not the one it actually
 *    resolved to. Repairable only when exactly one `learning_resource`
 *    already represents the citation's real target; otherwise left
 *    report-only rather than guessing which Library row to attach it to.
 */
export function checkCitationLibraryItem(snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  const mismatches: ConsistencyMismatch[] = [];

  const lrByBibId = new Map<string, string[]>();
  for (const lr of snapshot.learningResources) {
    if (!lr.bibRecordId) continue;
    const list = lrByBibId.get(lr.bibRecordId) ?? [];
    list.push(lr.id);
    lrByBibId.set(lr.bibRecordId, list);
  }
  const lrById = new Map(snapshot.learningResources.map((lr) => [lr.id, lr]));
  const linkByCitationId = new Map(snapshot.citationLibraryLinks.map((l) => [l.citationId, l]));

  for (const citation of snapshot.citations) {
    if (!citation.resolvedBibId) continue;
    const candidates = lrByBibId.get(citation.resolvedBibId) ?? [];
    const link = linkByCitationId.get(citation.id);

    if (!link) {
      if (candidates.length === 1) {
        mismatches.push({
          checkId: "citation-library-item",
          entityType: "citation",
          entityId: citation.id,
          description: "Resolved citation has no citation_library_link row, but a matching learning_resource already exists.",
          severity: "warning",
          evidence: { resolvedBibId: citation.resolvedBibId, learningResourceId: candidates[0] },
          repair: {
            kind: "insert",
            table: "citation_library_link",
            values: { citationId: citation.id, learningResourceId: candidates[0] },
            reason: `learning_resource ${candidates[0]} already carries bib_record_id ${citation.resolvedBibId}, the citation's own resolved target.`,
          },
        });
      } else if (candidates.length === 0) {
        mismatches.push({
          checkId: "citation-library-item",
          entityType: "citation",
          entityId: citation.id,
          description: "Resolved citation has no citation_library_link row and no learning_resource projects its bibliographic record yet.",
          severity: "info",
          evidence: { resolvedBibId: citation.resolvedBibId },
          repair: null,
        });
      }
      // candidates.length > 1 is a genuine ambiguity — which learning_resource
      // is canonical for this bib record is exactly library-item-canonical-work's
      // job to resolve, not this check's; left unreported here to avoid
      // duplicate noise across the two checks.
      continue;
    }

    const linkedLr = lrById.get(link.learningResourceId);
    if (linkedLr && linkedLr.bibRecordId && linkedLr.bibRecordId !== citation.resolvedBibId) {
      const correctCandidates = candidates.filter((id) => id !== link.learningResourceId);
      mismatches.push({
        checkId: "citation-library-item",
        entityType: "citation_library_link",
        entityId: link.id,
        description: "citation_library_link points at a learning_resource whose bib_record_id disagrees with the citation's resolved target.",
        severity: "warning",
        evidence: { citationResolvedBibId: citation.resolvedBibId, linkedLearningResourceBibId: linkedLr.bibRecordId },
        repair:
          correctCandidates.length === 1
            ? {
                kind: "update",
                table: "citation_library_link",
                id: link.id,
                patch: { learningResourceId: correctCandidates[0] },
                reason: `learning_resource ${correctCandidates[0]} carries bib_record_id ${citation.resolvedBibId}, the citation's own resolved target; the previously linked resource does not.`,
              }
            : null,
      });
    }
  }

  return mismatches;
}
