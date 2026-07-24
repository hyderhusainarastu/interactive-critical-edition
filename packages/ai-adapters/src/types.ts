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

// The four-level reader-level vocabulary (plan §34.4 9.4), duplicated here
// rather than imported from `@ice/roadmap` — this package has no other
// workspace dependencies, matching the same decoupling `packages/research`
// already keeps from `@ice/ai-adapters` for its own `RELATIONSHIP_CATEGORIES`.
export const READER_LEVELS = ["beginner", "undergraduate", "advanced", "research"] as const;
export type ReaderLevelName = (typeof READER_LEVELS)[number];

export const SUSTAINED_CITATION_THRESHOLD = 5;

export interface CitationFrequencySignal {
  /** Mentions in the primary document's extracted text. */
  documentMentions: number;
  /** Mentions in extracted citation/reference entries. */
  citationMentions: number;
  total: number;
  /** Normalized candidate terms that contributed to the count. */
  matchedTerms: string[];
}

/** Structured input to the relationship classifier — the "expensive
 *  stage" of the two-stage pipeline (plan §11). One candidate reference,
 *  the primary work it was found in, the verbatim passage that surfaced
 *  it, and optionally a run-level frequency signal (kept as evidence/
 *  provenance, never paraphrased away). */
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
  citationFrequency?: CitationFrequencySignal;
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
  /** Optional, conservative suggestion that this candidate applies at one
   *  specific reader level rather than universally. Null (the default) means
   *  "applies at every level" — the model is prompted to only suggest a
   *  level when the source is clearly level-specific, and the heuristic
   *  fallback (which has no basis to judge this) always returns null. */
  readerLevel: ReaderLevelName | null;
}
