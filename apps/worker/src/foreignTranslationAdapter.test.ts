import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIResponsesClient } from "@ice/ai-adapters";
import { createForeignTranslationAdapter } from "./foreignTranslationAdapter";
import { FOREIGN_TRANSLATION_PROMPT_VERSION, type ForeignTranslationRequestItem } from "./foreignText";

function mockResponse(status: number, jsonText: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ output_text: jsonText, usage: { input_tokens: 40, output_tokens: 25 } }),
    text: async () => jsonText,
  };
}

const REQUEST: ForeignTranslationRequestItem[] = [
  {
    id: "span-1",
    originalText: "ἀρετή",
    script: "greek",
    languageHint: "el",
    provenanceLabel: "extracted source text",
  },
];

describe("createForeignTranslationAdapter", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("is unavailable without an OpenAI key", () => {
    // Explicit empty string, not undefined: OpenAIResponsesClient's constructor default-parameters
    // to process.env.OPENAI_API_KEY when passed undefined, which would silently pick up a real key
    // in any environment where one is configured (as this worker's .env intentionally does).
    const adapter = createForeignTranslationAdapter({ client: new OpenAIResponsesClient("") });
    expect(adapter.available).toBe(false);
  });

  it("reports a positive maximum estimated cost for a non-empty batch, and zero for an empty one", () => {
    const adapter = createForeignTranslationAdapter({ client: new OpenAIResponsesClient("sk-test") });
    expect(adapter.estimateMaximumCostUsd([])).toBe(0);
    expect(adapter.estimateMaximumCostUsd(REQUEST)).toBeGreaterThan(0);
  });

  it("translates a batch, echoing id/originalText and returning usage + cost", async () => {
    global.fetch = vi.fn(async () =>
      mockResponse(200, JSON.stringify({
        items: [{
          id: "span-1",
          originalText: "ἀρετή",
          languageCode: "el",
          languageLabel: "Ancient Greek",
          transliteration: "arete",
          translation: "excellence",
        }],
      })),
    ) as unknown as typeof fetch;

    const adapter = createForeignTranslationAdapter({ client: new OpenAIResponsesClient("sk-test"), userId: "user-1" });
    const result = await adapter.translateBatch(REQUEST, { promptVersion: FOREIGN_TRANSLATION_PROMPT_VERSION });

    expect(result.provider).toBe("openai");
    expect(result.promptTokens).toBe(40);
    expect(result.completionTokens).toBe(25);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.items).toEqual([{
      id: "span-1",
      originalText: "ἀρετή",
      languageCode: "el",
      languageLabel: "Ancient Greek",
      transliteration: "arete",
      translation: "excellence",
    }]);
  });

  it("retries and ultimately fails when the model mutates originalText", async () => {
    global.fetch = vi.fn(async () =>
      mockResponse(200, JSON.stringify({
        items: [{
          id: "span-1",
          originalText: "MUTATED",
          languageCode: "el",
          languageLabel: "Ancient Greek",
          transliteration: "arete",
          translation: "excellence",
        }],
      })),
    ) as unknown as typeof fetch;

    const adapter = createForeignTranslationAdapter({ client: new OpenAIResponsesClient("sk-test") });
    await expect(
      adapter.translateBatch(REQUEST, { promptVersion: FOREIGN_TRANSLATION_PROMPT_VERSION }),
    ).rejects.toThrow();
    // MAX_RETRIES (2) + the initial attempt = 3 calls, all rejecting the same way.
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it("uses the configured/env model, defaulting to gpt-5.4-nano", () => {
    const defaultAdapter = createForeignTranslationAdapter({ client: new OpenAIResponsesClient("sk-test") });
    expect(defaultAdapter.model).toBe("gpt-5.4-nano");
    const overriddenAdapter = createForeignTranslationAdapter({ client: new OpenAIResponsesClient("sk-test"), model: "gpt-5.4-mini" });
    expect(overriddenAdapter.model).toBe("gpt-5.4-mini");
  });
});
