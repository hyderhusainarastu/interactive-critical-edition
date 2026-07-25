import { OpenAIResponsesClient, estimateCostUsd, safetyIdentifierFor } from "@ice/ai-adapters";
import {
  validateForeignTranslationResponse,
  type ForeignTranslationAdapter,
  type ForeignTranslationRequestItem,
  type ForeignTranslationResponseItem,
} from "./foreignText";

/**
 * OpenAI-backed `ForeignTranslationAdapter` over `OpenAIResponsesClient`'s
 * structured (JSON-schema) call, same shape as `packages/research`'s other
 * synthesis adapters. Cheapest-tier model per the cost-first routing rule
 * (plan §3/§11) — this is short, bounded, mechanical translation work, not
 * open-ended synthesis, so it never needs the research-tier model.
 */

const FOREIGN_TRANSLATION_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          originalText: { type: "string" },
          languageCode: { type: "string" },
          languageLabel: { type: "string" },
          transliteration: { type: "string" },
          translation: { type: "string" },
        },
        required: ["id", "originalText", "languageCode", "languageLabel", "transliteration", "translation"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const MAX_OUTPUT_TOKENS = 1800;
const CHARS_PER_TOKEN = 4;
const SYSTEM_PROMPT_TOKEN_ESTIMATE = 260;

const SYSTEM_PROMPT =
  "You transliterate and translate short foreign-script passages quoted inside a scholarly text. For " +
  "each item, identify the language as an ISO 639-1/639-3 code (languageCode) plus a short reader-facing " +
  "name (languageLabel, e.g. \"Ancient Greek\"), provide a Latin-script transliteration, and provide a " +
  "natural, scholarly-register English translation. Return exactly one output item per input item, in the " +
  "same order, echoing `id` and `originalText` verbatim — never alter, correct, complete, or omit the " +
  "original text, even if it looks incomplete or contains what might be an extraction error.";

function normalizeDraft(parsed: unknown): ForeignTranslationResponseItem[] {
  const p = parsed as { items?: unknown };
  if (!Array.isArray(p.items)) throw new Error("foreign-span translation response: items not an array");
  return p.items.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      id: typeof item.id === "string" ? item.id : "",
      originalText: typeof item.originalText === "string" ? item.originalText : "",
      languageCode: typeof item.languageCode === "string" ? item.languageCode : "",
      languageLabel: typeof item.languageLabel === "string" ? item.languageLabel : "",
      transliteration: typeof item.transliteration === "string" ? item.transliteration : "",
      translation: typeof item.translation === "string" ? item.translation : "",
    };
  });
}

function estimatePromptTokens(items: readonly ForeignTranslationRequestItem[]): number {
  const itemChars = items.reduce(
    (sum, item) => sum + item.originalText.length + item.provenanceLabel.length + item.languageHint.length + 32,
    0,
  );
  return SYSTEM_PROMPT_TOKEN_ESTIMATE + Math.ceil(itemChars / CHARS_PER_TOKEN);
}

export function createForeignTranslationAdapter(
  options: { userId?: string; client?: OpenAIResponsesClient; model?: string } = {},
): ForeignTranslationAdapter {
  const client = options.client ?? new OpenAIResponsesClient();
  const model = options.model ?? process.env.OPENAI_MODEL_CHEAP ?? "gpt-5.4-nano";
  const safetyIdentifier = options.userId ? safetyIdentifierFor(options.userId) : undefined;

  return {
    get available() {
      return client.available;
    },
    model,

    estimateMaximumCostUsd(items) {
      if (items.length === 0) return 0;
      // Worst-case completion budget (MAX_OUTPUT_TOKENS) — conservative upper
      // bound for the pre-call affordability gate, same pattern as the rest
      // of the pipeline's fixed cost-estimate constants.
      return estimateCostUsd(model, estimatePromptTokens(items), MAX_OUTPUT_TOKENS);
    },

    async translateBatch(items, { promptVersion: _promptVersion }) {
      const result = await client.call({
        model,
        schemaName: "foreign_span_translation",
        schema: FOREIGN_TRANSLATION_SCHEMA,
        safetyIdentifier,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        input: JSON.stringify({
          items: items.map((item) => ({
            id: item.id,
            originalText: item.originalText,
            script: item.script,
            languageHint: item.languageHint,
            provenanceLabel: item.provenanceLabel,
          })),
        }),
        // Validating against the REQUEST here (not just parsing shape) means
        // an id mismatch or a mutated `originalText` triggers the client's
        // own retry, rather than surfacing as a deferred span downstream.
        validate: (parsed) => {
          const drafted = normalizeDraft(parsed);
          const validated = validateForeignTranslationResponse(items, drafted);
          if (!validated) throw new Error("foreign-span translation response invalid or mutated original text");
          return [...validated.values()];
        },
      });

      return {
        items: result.data,
        provider: "openai",
        model: result.model,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        estimatedCostUsd: estimateCostUsd(result.model, result.promptTokens, result.completionTokens),
      };
    },
  };
}
