import type { RelationshipCategory } from "@ice/ai-adapters";
import { corroborateCreator, identifyCreator, type RawResource } from "@ice/research";

/**
 * Phase 9.2b's durable order. These labels are stored on processing_run so a
 * stalled v3 run says exactly which evidence-producing step it reached.
 */
export const V3_STAGE_SEQUENCE = [
  "canonical-identity",
  "structural-outline",
  "section-passage-anchors",
  "explicit-citations",
  "concepts-people-debates",
  "lane-discovery",
  "relevance-gate",
  "creator-verification",
  "citation-graph-expansion",
  "credibility",
  "claims",
  "conservative-influence-classification",
] as const;

export type V3Stage = (typeof V3_STAGE_SEQUENCE)[number];

/**
 * Creator corroboration is deliberately mechanical: a name supplied by a
 * scholarly provider is corroborated by that provider's record, never by an
 * LLM or an inferred affiliation. Anonymous records stay anonymous.
 */
export function verifyCreatorFromProviderMetadata(resource: RawResource) {
  const identity = identifyCreator(resource);
  const scholarlyRecord = ["crossref", "openalex", "semanticscholar"].includes(resource.provider)
    && resource.authors.some((author) => author.trim().length > 0);
  return corroborateCreator(identity, { scholarlyRecordMatches: scholarlyRecord ? 1 : 0 });
}

/**
 * An LLM may suggest a relationship, but it cannot turn a topical resemblance
 * into an influence claim. Keep `conceptual_influence` only when the inspected
 * provider excerpt itself says influence/influenced; otherwise retain it as an
 * explicitly uncertain AI inference for reader review.
 */
export function conservativeInfluenceClassification(
  relationship: RelationshipCategory,
  evidence: string | null | undefined,
): RelationshipCategory {
  if (relationship !== "conceptual_influence") return relationship;
  return /\b(influence[ds]?|influential|indebted to|draws on)\b/i.test(evidence ?? "")
    ? relationship
    : "ai_inferred";
}
