import { classifyWithProvider } from "./classify";
import { AnthropicProvider } from "./providers/anthropic";
import { heuristicClassify } from "./providers/heuristic";
import { OpenAIProvider } from "./providers/openai";
import { TASK_ROUTES } from "./routing";
import type { ClassificationInput, ClassificationResult, LLMProvider } from "./types";

export * from "./types";
export { CLASSIFY_PROMPT_VERSION } from "./classify";
export { estimateCostUsd, RESEARCH_ROUTE } from "./routing";
export { OpenAIEmbeddingsClient, estimateEmbeddingCostUsd, type EmbeddingResult } from "./embeddings";
export { heuristicClassify } from "./providers/heuristic";
export {
  OpenAIResponsesClient,
  safetyIdentifierFor,
  MAX_RETRIES,
  type StructuredCall,
  type StructuredResult,
} from "./responses";

/**
 * Selects the LLM provider for a task based on which API keys are
 * present, honoring the cost-first route order (preferred provider
 * first, then the alternate). Returns null when no key is configured —
 * the caller then uses the heuristic fallback. "Which provider is
 * available" lives here, never in business logic (plan §11).
 */
export function getProviderForTask(
  task: keyof typeof TASK_ROUTES,
): LLMProvider | null {
  const route = TASK_ROUTES[task];
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  for (const cfg of [route.preferred, route.alternate]) {
    if (cfg.provider === "openai" && openaiKey) {
      return new OpenAIProvider(cfg.model, openaiKey);
    }
    if (cfg.provider === "anthropic" && anthropicKey) {
      return new AnthropicProvider(cfg.model, anthropicKey);
    }
  }
  return null;
}

/**
 * The public relationship-classification entrypoint (the "expensive
 * stage" of the two-stage pipeline, plan §11). Uses a real model when a
 * key is configured, else the deterministic heuristic — either way the
 * returned `heuristic` flag and model/provenance fields say honestly
 * which produced the verdict.
 */
export async function classifyRelationship(
  input: ClassificationInput,
): Promise<ClassificationResult> {
  const provider = getProviderForTask("relationship_classification");
  if (!provider) return heuristicClassify(input);

  try {
    return await classifyWithProvider(provider, input);
  } catch (err) {
    // A transient provider error must not sink the whole analysis job —
    // degrade this one candidate to the heuristic, tagged as such.
    console.error("[ai-adapters] provider call failed, using heuristic:", err);
    return heuristicClassify(input);
  }
}

export { OpenAIProvider, AnthropicProvider };
