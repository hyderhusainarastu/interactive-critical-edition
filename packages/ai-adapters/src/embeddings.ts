/**
 * Minimal OpenAI embeddings client. It intentionally stays separate from the
 * Responses client because embeddings use `/v1/embeddings`, return vectors
 * rather than model text, and have input-only usage/cost accounting.
 */
export interface EmbeddingResult {
  embedding: number[];
  model: string;
  inputTokens: number;
}

export class OpenAIEmbeddingsClient {
  constructor(
    private readonly apiKey: string | undefined = process.env.OPENAI_API_KEY,
    private readonly baseUrl: string = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async embed(input: string, model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"): Promise<EmbeddingResult> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not configured");
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model, input, encoding_format: "float" }),
    });
    if (!response.ok) throw new Error(`OpenAI embeddings ${response.status}: ${(await response.text()).slice(0, 300)}`);

    const payload = (await response.json()) as {
      data?: { embedding?: unknown }[];
      model?: string;
      usage?: { prompt_tokens?: number };
    };
    const embedding = payload.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0 || !embedding.every((value) => typeof value === "number")) {
      throw new Error("OpenAI embeddings response did not include a numeric vector");
    }
    return {
      embedding,
      model: payload.model ?? model,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
    };
  }
}

/** Official input-only price for text-embedding-3-small, USD per 1M tokens. */
export function estimateEmbeddingCostUsd(model: string, inputTokens: number): number {
  const perMillion = model === "text-embedding-3-small" ? 0.02 : 0.13;
  return (Math.max(0, inputTokens) / 1_000_000) * perMillion;
}
