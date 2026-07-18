/**
 * AI provider adapter interface (plan §11: "AI providers must be
 * replaceable"). No vendor SDK is imported anywhere in the app — a
 * provider is any object satisfying `LLMProvider`, and business logic
 * (the classifier in ./classify.ts) only ever sees this interface.
 * Concrete OpenAI/Anthropic implementations use plain `fetch` against
 * the HTTP APIs, so there is no SDK dependency to install or build.
 */

export type TaskType =
  | "relationship_classification"
  | "metadata_extraction"
  | "citation_parse";

export interface LLMCompletionParams {
  task: TaskType;
  system: string;
  prompt: string;
  /** Caps output length; classification responses are small JSON. */
  maxTokens?: number;
}

export interface LLMCompletionResult {
  text: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(params: LLMCompletionParams): Promise<LLMCompletionResult>;
}

// The 10 required relationship categories (plan §5/§12), matching the
// `relationship_category` DB enum exactly.
export const RELATIONSHIP_CATEGORIES = [
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
] as const;

export type RelationshipCategory = (typeof RELATIONSHIP_CATEGORIES)[number];

/** Structured input to the relationship classifier — the "expensive
 *  stage" of the two-stage pipeline (plan §11). One candidate reference,
 *  the primary work it was found in, and the verbatim passage that
 *  surfaced it (kept as evidence/provenance, never paraphrased away). */
export interface ClassificationInput {
  primaryTitle: string;
  primaryAuthor: string | null;
  candidateTitle: string;
  candidateAuthor: string | null;
  /** The verbatim triggering passage (plan §12 extracted_source_text). */
  sourceText: string;
  /** True when the candidate was resolved against a real bibliographic
   *  record (vs. an unresolved raw citation) — a strong signal it's an
   *  explicit reference rather than inferred context. */
  resolved: boolean;
}

export interface ClassificationResult {
  category: RelationshipCategory;
  explanation: string;
  confidence: number; // 0..1
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** True when produced by the deterministic heuristic fallback rather
   *  than a real model call — surfaced honestly all the way to the UI so
   *  a stub is never presented as an AI verdict. */
  heuristic: boolean;
}
