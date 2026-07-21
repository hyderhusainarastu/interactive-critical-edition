import { describe, expect, it, vi } from "vitest";
import { OpenAIEmbeddingsClient, estimateEmbeddingCostUsd } from "./embeddings";

describe("OpenAIEmbeddingsClient", () => {
  it("returns a numeric vector and input-token usage", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: [0.1, -0.2] }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 12 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenAIEmbeddingsClient("key", "https://example.test/v1");
    await expect(client.embed("text")).resolves.toEqual({
      embedding: [0.1, -0.2], model: "text-embedding-3-small", inputTokens: 12,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/v1/embeddings", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });

  it("uses the published input-only price for text-embedding-3-small", () => {
    expect(estimateEmbeddingCostUsd("text-embedding-3-small", 1_000_000)).toBe(0.02);
  });
});
