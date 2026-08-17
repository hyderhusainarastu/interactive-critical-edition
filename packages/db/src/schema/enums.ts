import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enum vocabularies shared by more than one schema module. A pgEnum is
 * invoked while a table's columns are being built, so — unlike a
 * `.references(() => table)` thunk — it cannot tolerate a circular import.
 * Collecting the shared ones in this dependency-free module keeps every
 * consumer's evaluation order safe.
 */
// The 10 required relationship categories (plan §5/§12), verbatim.
export const relationshipCategoryEnum = pgEnum("relationship_category", [
  "explicit_reference",
  "secondary_scholarly_recommendation",
  "historical_context",
  "prerequisite",
  "conceptual_influence",
  "disagreement_polemical_target",
  "interpretive_aid",
  "parallel_comparison",
  "optional_extension",
  "ai_inferred",
]);

// plan §12: users can approve/reject/edit/hide any AI annotation; this
// is the lifecycle field that persists those decisions.
export const verificationStatusEnum = pgEnum("verification_status", [
  "unreviewed",
  "user_verified",
  "source_verified",
  "disputed",
  "rejected",
]);

// Where an annotation/edge came from — never silently blurred (plan §12).
export const provenanceEnum = pgEnum("provenance_source", ["system", "user", "editor"]);

// plan §9 graph edge_type vocabulary — a superset of the 10 annotation
// categories, since the graph also carries structural edges (translates,
// is_edition_of) the annotation layer doesn't surface.
export const edgeTypeEnum = pgEnum("edge_type", [
  "cites",
  "quotes",
  "influences",
  "criticizes",
  "responds_to",
  "presupposes",
  "provides_context_for",
  "interprets",
  "disagrees_with",
  "translates",
  "is_edition_of",
  "is_prerequisite_for",
  "is_comparable_to",
  "is_recommended_by",
]);

/**
 * Where a mastery score came from. Phase 9.4's precedence is explicit rating →
 * diagnostic → inference from completed prerequisites (weak evidence only) →
 * the reader's global level, and precedence is only enforceable if the source
 * is recorded rather than inferred back from the number. Hoisted above
 * `understandingRatings` (sub-phase 22.9b, plan §3.6) since that table now
 * also reuses this enum inline, and — unlike the lazy `AnyPgColumn` forward
 * references used elsewhere in this file for as-yet-undeclared TABLES — a
 * `pgEnum` handle is called directly inside the column definition, so it
 * must already exist at module-evaluation time, not just by the time a
 * query runs.
 */
export const masterySourceEnum = pgEnum("mastery_source", [
  "explicit",
  "diagnostic",
  "inferred",
]);

/**
 * How a discovered record relates to the WORK it belongs to. Record-level
 * dedup cannot collapse a book with a review of it — different DOI, different
 * title, different author — and should not: both are real records. But the
 * reader must see one Library entry per work, with reviews attached.
 */
export const recordRoleEnum = pgEnum("record_role", [
  "primary",
  "review",
  "edition",
  "translation",
  "excerpt",
]);
