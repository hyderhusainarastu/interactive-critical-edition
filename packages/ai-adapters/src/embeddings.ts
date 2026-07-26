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

export interface EmbedManyResult {
  /** Same order as the input array — see the `index`-based reassembly below. */
  vectors: number[][];
  model: string;
  inputTokens: number;
}

// OpenAI's documented per-request limit for an `input` array of strings.
// Larger batches are chunked into multiple sequential calls rather than
// rejected, so a caller never has to hand-roll batching itself.
const MAX_EMBEDDING_BATCH = 128;

export class OpenAIEmbeddingsClient {
  constructor(
    private readonly apiKey: string | undefined = process.env.OPENAI_API_KEY,
    private readonly baseUrl: string = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  ) {}

  get available(): boolean {
    return Boolean(this.apiKey);
  }

  async embed(input: string, model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small"): Promise<EmbeddingResult> {
    const { vectors, model: resolvedModel, inputTokens } = await this.embedMany([input], model);
    const embedding = vectors[0];
    if (!embedding) throw new Error("OpenAI embeddings response did not include a numeric vector");
    return { embedding, model: resolvedModel, inputTokens };
  }

  /** Batches `inputs` into calls of at most `MAX_EMBEDDING_BATCH`, and
   *  concatenates the results back into one array in the original input
   *  order. Token usage is summed across every underlying call. */
  async embedMany(
    inputs: string[],
    model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  ): Promise<EmbedManyResult> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not configured");
    if (inputs.length === 0) return { vectors: [], model, inputTokens: 0 };

    const vectors: number[][] = [];
    let inputTokens = 0;
    let resolvedModel = model;

    for (let offset = 0; offset < inputs.length; offset += MAX_EMBEDDING_BATCH) {
      const chunk = inputs.slice(offset, offset + MAX_EMBEDDING_BATCH);
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model, input: chunk, encoding_format: "float" }),
      });
      if (!response.ok) throw new Error(`OpenAI embeddings ${response.status}: ${(await response.text()).slice(0, 300)}`);

      const payload = (await response.json()) as {
        data?: { embedding?: unknown; index?: number }[];
        model?: string;
        usage?: { prompt_tokens?: number };
      };
      const items = payload.data;
      if (!Array.isArray(items) || items.length !== chunk.length) {
        throw new Error("OpenAI embeddings response item count did not match input count");
      }

      // Reassemble by each item's own `index` rather than array position —
      // the API documents a per-item index precisely because response
      // order isn't guaranteed to match request order.
      const chunkVectors = new Array<number[]>(chunk.length);
      items.forEach((item, arrayPos) => {
        const embedding = item.embedding;
        if (!Array.isArray(embedding) || embedding.length === 0 || !embedding.every((value) => typeof value === "number")) {
          throw new Error("OpenAI embeddings response did not include a numeric vector");
        }
        const idx = typeof item.index === "number" ? item.index : arrayPos;
        chunkVectors[idx] = embedding as number[];
      });
      vectors.push(...chunkVectors);
      inputTokens += payload.usage?.prompt_tokens ?? 0;
      resolvedModel = payload.model ?? resolvedModel;
    }

    return { vectors, model: resolvedModel, inputTokens };
  }
}

/** Official input-only price for text-embedding-3-small, USD per 1M tokens. */
export function estimateEmbeddingCostUsd(model: string, inputTokens: number): number {
  const perMillion = model === "text-embedding-3-small" ? 0.02 : 0.13;
  return (Math.max(0, inputTokens) / 1_000_000) * perMillion;
}
