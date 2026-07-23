import type { CandidateAssessment } from "./relevance";

/**
 * Full-inspection selection (floors-capability-proposal §2.2). Extracted as a
 * pure function — no DB, no adapters — so the exact fixture the audit
 * described (dozens of legitimately-accepted but interchangeable primary-text
 * editions crowding out a specifically-grounded secondary source) is a plain
 * Vitest unit, not something that needs a live run to exercise.
 *
 * Background: `assessCandidate` (relevance.ts) accepts a candidate as an
 * explicit citation via three different disjuncts of varying specificity
 * (`RelevanceSignals.explicitCitationSource`) — a resolved citation's own key,
 * a match against the document's own reference-list text, or (built for
 * Phase 11.7's Nicomachean-Ethics-as-prerequisite fix) a mere title-phrase
 * appearing anywhere in the document's prose. That third path is legitimate
 * for acceptance, but it also means EVERY discovered edition/translation of a
 * heavily-referenced primary text independently qualifies — and previously,
 * sorting purely by authority let a 41st DOI-bearing edition out-rank a real,
 * specifically-grounded secondary source for one of the scarce
 * `maxFullInspections` slots.
 *
 * This module changes ONLY which already-accepted candidates get a full
 * inspection slot. It never touches acceptance itself (relevance.ts's
 * ACCEPT_CONFIDENCE/REJECT_CONFIDENCE/core-concept rules are untouched).
 */

/** True when a candidate's explicit-citation grounding is the document's own
 *  reference-list evidence (a resolved key or a matched citation-text entry)
 *  rather than the broader title-phrase-in-prose rule. */
export function isSpecificallyGroundedCitation(assessment: CandidateAssessment): boolean {
  const source = assessment.signals.explicitCitationSource;
  return source === "key" || source === "citation_text";
}

export interface RankableCandidate {
  assessment: CandidateAssessment;
  /** Already-classified authority band (e.g. `classifyAuthority(r)`), kept
   *  generic here (not importing `credibility.ts`'s `SourceAuthority`) so this
   *  module stays decoupled from anything but the relevance signals it
   *  actually reads. */
  authority: string;
}

/**
 * Select which ACCEPTED candidates get a full (content-level) inspection,
 * bounded by `maxFullInspections`.
 *
 * Candidates specifically grounded in the document's own citation evidence
 * are effectively never competed out by the generic authority sort — they
 * are naturally bounded upstream by how many real citations the document has
 * (`maxCitationCandidates`, already 300), which is a real ceiling, just a
 * much higher one. Everything else is ranked by authority, exactly as
 * before, and fills whatever budget remains after the specifically-grounded
 * group is seated.
 *
 * Defense-in-depth (floors2 crash follow-up, §5 item 3): the specific group
 * itself is capped at `maxFullInspections * SPECIFIC_GROUP_CAP_MULTIPLIER`.
 * This did not cause the floors2 production incident — that run's specific
 * group (175) was well within this ceiling (240 at the default 120 budget)
 * — but an uncapped specific group is still an unbounded-in-practice full-
 * inspection pass for a genuinely pathological document (hundreds of
 * citation-grounded hits). Past the cap, the specific group is ranked by
 * authority and truncated exactly the way the generic group already is —
 * note that once the specific group alone reaches the cap (2x the base
 * budget), `remaining` below is mathematically always 0, so an overflowing
 * specific group necessarily crowds out the entire generic group too, same
 * as it already could pre-cap; the cap's job is only to stop the specific
 * group's own size from growing without bound, not to change how it
 * competes with generic once it does overflow.
 */
const SPECIFIC_GROUP_CAP_MULTIPLIER = 2;

export function selectForFullInspection<T extends RankableCandidate>(
  accepted: readonly T[],
  authorityOrder: Record<string, number>,
  maxFullInspections: number,
): T[] {
  const specific: T[] = [];
  const generic: T[] = [];
  for (const item of accepted) {
    (isSpecificallyGroundedCitation(item.assessment) ? specific : generic).push(item);
  }
  // Ranked by authority so a cap, when it bites, drops the WEAKEST specific
  // candidates first — the same treatment the generic group already gets.
  specific.sort((a, b) => authorityOrder[a.authority] - authorityOrder[b.authority]);
  const specificCap = maxFullInspections * SPECIFIC_GROUP_CAP_MULTIPLIER;
  const seatedSpecific = specific.slice(0, specificCap);

  generic.sort((a, b) => authorityOrder[a.authority] - authorityOrder[b.authority]);
  const remaining = Math.max(0, maxFullInspections - seatedSpecific.length);
  return [...seatedSpecific, ...generic.slice(0, remaining)];
}
