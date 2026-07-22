import { firstSurnameFromFreeText, titleOverlap } from "../normalize";
import type { ConsistencyMismatch } from "../types";
import type { ConsistencySnapshot } from "../snapshot";

/**
 * Check 9 — title/author/year agreement across surfaces (plan §20.7 bullet
 * 9), scoped to the two places a title/author/year triple is meant to track
 * the same real-world work:
 *
 *  - `work.title`/`work.authorName` vs. its `work_identity`
 *    (`canonicalTitle`/`authorSurname`) once the work has been linked to one;
 *  - the PRIMARY `learning_resource` for a `work_identity` (the one the
 *    Library actually displays as that work's canonical entry) vs. the same
 *    identity's own `canonicalTitle`/`year`.
 *
 * Both comparisons are deliberately narrow and mostly report-only:
 *
 *  - a work's own title is the reader's uploaded document title — legitimate
 *    to differ in phrasing/translation from the aggregated canonical title
 *    (e.g. a translated edition's own title vs. the original-language
 *    canonical title), so a title/author disagreement is reported at `info`
 *    severity with `repair: null` rather than overwritten either direction —
 *    doing so would risk destroying real, user-supplied data to chase an
 *    aggregate that isn't necessarily more correct for THIS row;
 *  - the one safe, non-guessing repair here is backfilling a work_identity's
 *    null `year` from its own primary learning_resource's `year` — that
 *    resource is the identity's own canonical projection (by construction,
 *    `work_role = 'primary'`), not a third-party disagreeing surface, so
 *    copying a fact that already exists on the identity's own primary
 *    resource into the identity's own null slot is a resync, not a guess. A
 *    NON-null year disagreement between the two is reported only — there is
 *    no way to tell which of two populated values is correct without a
 *    canonical source neither side already has.
 */

/** Titles are treated as agreeing if the still-meaningful tokens
 *  overlap enough to plausibly be the same work; below this, worth a look
 *  (not necessarily wrong — translations/subtitled reprints legitimately
 *  score low). Kept low and `info`-severity for exactly that reason. */
const TITLE_OVERLAP_FLOOR = 0.2;

export function checkTitleAuthorYearAgreement(snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  const mismatches: ConsistencyMismatch[] = [];
  const identityById = new Map(snapshot.workIdentities.map((wi) => [wi.id, wi]));

  for (const work of snapshot.works) {
    if (work.deletedAt) continue;
    if (!work.workIdentityId) continue;
    const identity = identityById.get(work.workIdentityId);
    if (!identity) continue; // dangling FK is library-item-canonical-work's job to report

    const overlap = titleOverlap(work.title, identity.canonicalTitle);
    const workSurname = firstSurnameFromFreeText(work.authorName);
    const identitySurname = identity.authorSurname ? firstSurnameFromFreeText(identity.authorSurname) : null;
    const titleDisagrees = overlap < TITLE_OVERLAP_FLOOR;
    const authorDisagrees = Boolean(workSurname && identitySurname && workSurname !== identitySurname);

    if (titleDisagrees || authorDisagrees) {
      mismatches.push({
        checkId: "title-author-year-agreement",
        entityType: "work",
        entityId: work.id,
        description: titleDisagrees && authorDisagrees
          ? "work.title/authorName both disagree with their linked work_identity's canonical title/author."
          : titleDisagrees
            ? "work.title has low token overlap with its linked work_identity's canonical title."
            : "work.authorName's surname disagrees with its linked work_identity's authorSurname.",
        severity: "info",
        evidence: {
          workTitle: work.title,
          canonicalTitle: identity.canonicalTitle,
          titleOverlap: Number(overlap.toFixed(3)),
          workAuthorName: work.authorName,
          identityAuthorSurname: identity.authorSurname,
        },
        repair: null,
      });
    }
  }

  const primaryLrByIdentity = new Map<string, { title: string; year: number | null }>();
  for (const lr of snapshot.learningResources) {
    if (lr.workRole !== "primary" || !lr.workIdentityId) continue;
    if (!primaryLrByIdentity.has(lr.workIdentityId)) {
      primaryLrByIdentity.set(lr.workIdentityId, { title: lr.title, year: lr.year });
    }
  }

  for (const identity of snapshot.workIdentities) {
    const primary = primaryLrByIdentity.get(identity.id);
    if (!primary) continue;

    const overlap = titleOverlap(primary.title, identity.canonicalTitle);
    if (overlap < TITLE_OVERLAP_FLOOR) {
      mismatches.push({
        checkId: "title-author-year-agreement",
        entityType: "work_identity",
        entityId: identity.id,
        description: "work_identity.canonicalTitle has low token overlap with its own primary learning_resource's title.",
        severity: "info",
        evidence: { canonicalTitle: identity.canonicalTitle, primaryResourceTitle: primary.title, titleOverlap: Number(overlap.toFixed(3)) },
        repair: null,
      });
    }

    if (primary.year !== null && identity.year === null) {
      mismatches.push({
        checkId: "title-author-year-agreement",
        entityType: "work_identity",
        entityId: identity.id,
        description: "work_identity.year is unset even though its own primary learning_resource carries a year.",
        severity: "info",
        evidence: { primaryResourceYear: primary.year },
        repair: {
          kind: "update",
          table: "work_identity",
          id: identity.id,
          patch: { year: primary.year },
          reason: `learning_resource is this identity's own primary (work_role = 'primary') record and already carries year ${primary.year}; backfilling the identity's own null field, not guessing.`,
        },
      });
    } else if (primary.year !== null && identity.year !== null && primary.year !== identity.year) {
      mismatches.push({
        checkId: "title-author-year-agreement",
        entityType: "work_identity",
        entityId: identity.id,
        description: "work_identity.year disagrees with its own primary learning_resource's year.",
        severity: "info",
        evidence: { identityYear: identity.year, primaryResourceYear: primary.year },
        repair: null,
      });
    }
  }

  return mismatches;
}
