import type { RelationshipCategory } from "@ice/ai-adapters";
import { corroborateCreator, identifyCreator, type RawResource } from "@ice/research";

/**
 * Phase 9.2b's durable order. These labels are stored on processing_run so a
 * stalled v3 run says exactly which evidence-producing step it reached.
 * Relocated to `@ice/config` (plan §36 11.3) so both the worker and the web
 * UI's processing-progress indicator share one source of truth; re-exported
 * here unchanged so existing imports from "./v3" keep working.
 */
export { V3_STAGE_SEQUENCE, type V3Stage } from "@ice/config";

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
