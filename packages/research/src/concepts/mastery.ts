/**
 * Phase 9.4 (plan §34.4): the concept-mastery precedence rule — "explicit
 * rating → diagnostic → completed prerequisites (weak evidence only) →
 * global level." `concept_mastery` holds exactly one row per (user, concept)
 * (see `packages/db/src/schema.ts`'s unique index), so "precedence" is
 * enforced at WRITE time — a weaker signal must never silently overwrite a
 * stronger one already on record — and the "global level" step only ever
 * applies at READ time, as the fallback when no row exists yet at all.
 *
 * Deliberately takes/returns plain strings rather than importing
 * `ReaderLevel` from `@ice/roadmap`: this package stays decoupled from its
 * callers' vocabularies the same way `passageAnnotations.ts` keeps the
 * ten-category relationship enum on the caller side rather than importing
 * `@ice/ai-adapters`.
 */

export const MASTERY_SOURCES = ["explicit", "diagnostic", "inferred"] as const;
export type MasterySource = (typeof MASTERY_SOURCES)[number];

const PRECEDENCE: Record<MasterySource, number> = {
  explicit: 3,
  diagnostic: 2,
  inferred: 1,
};

/**
 * Whether a new mastery signal is allowed to overwrite an existing one.
 * Equal precedence is allowed through (a retaken diagnostic refreshes the
 * prior diagnostic score); only a STRICTLY weaker source is blocked, e.g. a
 * newly inferred score must never quietly downgrade an explicit rating the
 * reader gave, or a diagnostic answer, on the same concept.
 */
export function shouldOverwriteMastery(existingSource: MasterySource | null, newSource: MasterySource): boolean {
  if (existingSource === null) return true;
  return PRECEDENCE[newSource] >= PRECEDENCE[existingSource];
}

/**
 * Weak, explicitly-labeled-as-such evidence (plan §34.4: "completed
 * prerequisites (weak evidence only)") — completing the work that
 * presupposes a concept suggests some familiarity, but is not the same
 * quality of evidence as the reader actually being asked about the concept.
 * Set just above the roadmap's existing `KNOWN_THRESHOLD` (60, from
 * `@ice/roadmap`) rather than re-deriving a second threshold, since
 * "weakly known" should still cross the same known/unknown line everything
 * else in this app already uses.
 */
export const INFERRED_FROM_COMPLETION_SCORE = 65;

/**
 * A rough baseline estimate of concept familiarity when NOTHING is known
 * about the reader's grasp of it yet — the last-resort "global level" step
 * of the precedence chain, used only at read time and never persisted as a
 * `concept_mastery` row (an unrecorded guess is not evidence). Deliberately
 * conservative: even a self-described "research"-level reader is assumed
 * only moderately familiar with any ONE given concept, since the level
 * describes their general depth, not this specific concept.
 */
const LEVEL_DEFAULT_MASTERY: Record<string, number> = {
  beginner: 15,
  undergraduate: 35,
  advanced: 50,
  research: 65,
};
const FALLBACK_DEFAULT_MASTERY = 35; // an unset/unrecognized level assumes the same as "undergraduate"

export function defaultMasteryForReaderLevel(readerLevel: string | null): number {
  if (readerLevel === null) return FALLBACK_DEFAULT_MASTERY;
  return LEVEL_DEFAULT_MASTERY[readerLevel] ?? FALLBACK_DEFAULT_MASTERY;
}

/**
 * The full read-time precedence chain in one call: a recorded
 * `concept_mastery` score always wins (its `source` already reflects where
 * it came from — explicit/diagnostic/inferred, precedence-enforced at write
 * time), and only when nothing is recorded does this fall back to the
 * reader's global level.
 */
export function effectiveMastery(input: { existing: { score: number } | null; readerLevel: string | null }): number {
  if (input.existing) return input.existing.score;
  return defaultMasteryForReaderLevel(input.readerLevel);
}

/**
 * The "completed prerequisites (weak evidence only)" step of the precedence
 * chain: has the reader completed ANOTHER work (not necessarily this one)
 * that also presupposes the target concept? Pure over caller-supplied data
 * (this package has no DB access) — the caller fetches the reader's
 * completed work ids and their `work -[presupposes]-> concept` edges once
 * and reuses them across every concept being checked, rather than one query
 * per concept.
 */
export function inferMasteryFromCompletedWorks(input: {
  targetConceptId: string;
  completedWorkIds: readonly string[];
  workConceptEdges: readonly { workId: string; conceptId: string }[];
}): boolean {
  const completed = new Set(input.completedWorkIds);
  return input.workConceptEdges.some((e) => e.conceptId === input.targetConceptId && completed.has(e.workId));
}
