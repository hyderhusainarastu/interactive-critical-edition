import type { RelationshipCategory } from "@ice/roadmap";

/** Relation types that are symmetric — direction carries no meaning.
 *  Everything else in the vocabulary (cites/review_of/translates/…) is a
 *  directed claim about which end does what.
 *
 *  Debate layer (Phase 28.4, additive): `claim_contradicts`/`claim_supports`/
 *  `claim_nuances` join this set too. `claim_relationship.claim_lo_id <
 *  claim_hi_id` is a DB-enforced CANONICAL STORAGE order (so a pair is never
 *  stored twice), not an argumentative direction — the judge never records
 *  "which claim is doing the supporting/contradicting to which", so treating
 *  these as directed would silently assert a direction the data doesn't
 *  carry. `asserts_claim`/`in_debate` are genuinely directed (a work asserts
 *  a claim / is part of a debate) and are NOT added here. */
export const UNDIRECTED_EDGE_TYPES: ReadonlySet<string> = new Set([
  "is_comparable_to",
  "parallel_comparison",
  "claim_contradicts",
  "claim_supports",
  "claim_nuances",
]);

export function isDirectedEdgeType(edgeType: string): boolean {
  return !UNDIRECTED_EDGE_TYPES.has(edgeType);
}

export function edgeTypeLabel(edgeType: string): string {
  return edgeType.replace(/_/g, " ");
}

export type EdgeFamily = "reference" | "influence" | "opposition" | "structural" | "prerequisite";

export const EDGE_FAMILY_META: Record<EdgeFamily, { label: string; colorVar: string }> = {
  reference: { label: "Citation / reference", colorVar: "--color-accent-ink" },
  influence: { label: "Influence / agreement", colorVar: "--color-accent-green" },
  opposition: { label: "Opposition", colorVar: "--color-credibility-critical" },
  structural: { label: "Structure", colorVar: "--color-text-muted" },
  prerequisite: { label: "Prerequisite", colorVar: "--color-credibility-warning" },
};

export const EDGE_FAMILY_ORDER: EdgeFamily[] = ["reference", "prerequisite", "influence", "opposition", "structural"];

/**
 * Explicit family assignment for every edge-type string the payload actually
 * produces (plan §21.5 audit finding: the old keyword-only matcher silently
 * defaulted `review_of`/`translation_of`/`edition_of`/`excerpt_of`/
 * `responds_to`/`translates`/`is_edition_of`/`is_comparable_to`/
 * `is_recommended_by`/`discovered_source` into "influence"). Covers the
 * 14-value `edge_type` enum, the synthetic `outline_section`/
 * `discovered_source` edges, the `edition_relation` `${workRole}_of` strings,
 * and the relation-category strings `edition_relation.relation_type` carries.
 */
const EDGE_TYPE_FAMILY: Record<string, EdgeFamily> = {
  // Citation / reference: pointers at a work — citations, quotations,
  // recommendations, reviews, replies, and discovered/supplementary sources.
  cites: "reference",
  quotes: "reference",
  is_recommended_by: "reference",
  review_of: "reference",
  responds_to: "reference",
  discovered_source: "reference",
  supplementary_context: "reference",
  explicit_reference: "reference",
  secondary_scholarly_recommendation: "reference",
  // Influence / agreement (the `is_comparable_to` mapping is deliberate:
  // parallel/comparison shares this family rather than inventing a sixth).
  influences: "influence",
  provides_context_for: "influence",
  interprets: "influence",
  is_comparable_to: "influence",
  historical_context: "influence",
  conceptual_influence: "influence",
  interpretive_aid: "influence",
  parallel_comparison: "influence",
  // Opposition.
  criticizes: "opposition",
  disagrees_with: "opposition",
  disagreement_polemical_target: "opposition",
  // Prerequisite.
  presupposes: "prerequisite",
  is_prerequisite_for: "prerequisite",
  prerequisite: "prerequisite",
  // Structure: the work's own outline plus work-form relations
  // (editions, translations, excerpts of the same work).
  outline_section: "structural",
  translates: "structural",
  is_edition_of: "structural",
  edition_of: "structural",
  translation_of: "structural",
  excerpt_of: "structural",
  // Debate layer (Phase 28.4, additive): synthetic edge-type strings the
  // debate-cluster base payload and expansion delta produce (never DB enum
  // values — the `outline_section` precedent, no migration). Contradiction
  // is opposition; support/nuance both read as agreement-with-qualification,
  // the same "influence" family `is_comparable_to`/`interpretive_aid` already
  // share. `asserts_claim`/`in_debate` are structural: they describe WHICH
  // work is attached to WHICH claim/debate, not a scholarly relationship
  // between two works.
  claim_contradicts: "opposition",
  claim_supports: "influence",
  claim_nuances: "influence",
  asserts_claim: "structural",
  in_debate: "structural",
};

export function edgeFamilyFor(edgeType: string, category?: string | null): EdgeFamily {
  const exact = EDGE_TYPE_FAMILY[edgeType] ?? (category ? EDGE_TYPE_FAMILY[category] : undefined);
  if (exact) return exact;
  // Keyword fallback for genuinely unknown/category-augmented strings only.
  const normalized = `${edgeType} ${category ?? ""}`.toLowerCase();
  if (normalized.includes("outline") || normalized.includes("section") || normalized.includes("edition") || normalized.includes("translat") || normalized.includes("excerpt")) return "structural";
  if (normalized.includes("prerequisite") || normalized.includes("presupposes")) return "prerequisite";
  if (normalized.includes("disagrees") || normalized.includes("criticizes") || normalized.includes("polemical")) return "opposition";
  if (normalized.includes("cites") || normalized.includes("quotes") || normalized.includes("reference") || normalized.includes("review") || normalized.includes("recommend")) return "reference";
  return "influence";
}

/**
 * relationship_category → edge_type (Phase 21.2, D-21-7): mirrors
 * `apps/worker/src/analyze.ts`'s `CATEGORY_TO_EDGE` map exactly, so
 * `resource_role`/`passage_annotation` rows — real relation-bearing rows the
 * plan names that `buildGraph()` never read before this fix — project into
 * the SAME edge_type vocabulary the citation/classification `graph_edge`
 * rows already use. That means `edgeFamilyFor()` above and the legend/relation
 * filter need no new cases for either source: every edge_type this produces
 * is already one of `EDGE_TYPE_FAMILY`'s existing keys. Kept in sync
 * manually — apps/web cannot import from apps/worker.
 */
const RELATIONSHIP_CATEGORY_TO_EDGE_TYPE: Record<RelationshipCategory, string> = {
  explicit_reference: "cites",
  secondary_scholarly_recommendation: "is_recommended_by",
  historical_context: "provides_context_for",
  prerequisite: "is_prerequisite_for",
  conceptual_influence: "influences",
  disagreement_polemical_target: "disagrees_with",
  interpretive_aid: "interprets",
  parallel_comparison: "is_comparable_to",
  optional_extension: "is_recommended_by",
  ai_inferred: "provides_context_for",
};

/** Falls back to `provides_context_for` for any unrecognized category value
 *  rather than throwing — a graph edge should degrade to a plausible
 *  family, never disappear from the payload or crash the request. */
export function edgeTypeForRelationshipCategory(category: string): string {
  return RELATIONSHIP_CATEGORY_TO_EDGE_TYPE[category as RelationshipCategory] ?? "provides_context_for";
}
