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

  it("uses the published input-only price for text-embedding-3-large", () => {
    expect(estimateEmbeddingCostUsd("text-embedding-3-large", 1_000_000)).toBe(0.13);
  });
});

describe("OpenAIEmbeddingsClient.embedMany", () => {
  it("returns one call's worth of vectors, in request order, for a batch under the limit", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { embedding: [0, 0], index: 0 },
        { embedding: [1, 1], index: 1 },
      ],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 20 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenAIEmbeddingsClient("key", "https://example.test/v1");
    const result = await client.embedMany(["a", "b"]);
    expect(result.vectors).toEqual([[0, 0], [1, 1]]);
    expect(result.inputTokens).toBe(20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("splits a batch larger than 128 inputs into multiple sequential calls", async () => {
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      call++;
      const body = JSON.parse(init.body as string) as { input: string[] };
      return new Response(JSON.stringify({
        data: body.input.map((_text, i) => ({ embedding: [call, i], index: i })),
        model: "text-embedding-3-small",
        usage: { prompt_tokens: body.input.length },
      }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenAIEmbeddingsClient("key", "https://example.test/v1");
    const inputs = Array.from({ length: 200 }, (_, i) => `text-${i}`);
    const result = await client.embedMany(inputs);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 128 + 72
    expect(result.vectors).toHaveLength(200);
    expect(result.vectors[0]).toEqual([1, 0]); // first call's first item
    expect(result.vectors[128]).toEqual([2, 0]); // second call's first item
    expect(result.inputTokens).toBe(200); // summed across both calls
    vi.unstubAllGlobals();
  });

  it("returns an empty result for an empty input array without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenAIEmbeddingsClient("key", "https://example.test/v1");
    const result = await client.embedMany([]);
    expect(result).toEqual({ vectors: [], model: "text-embedding-3-small", inputTokens: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("single-input embed() delegates to embedMany()", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: [0.5, 0.6], index: 0 }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 3 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new OpenAIEmbeddingsClient("key", "https://example.test/v1");
    await expect(client.embed("solo")).resolves.toEqual({
      embedding: [0.5, 0.6], model: "text-embedding-3-small", inputTokens: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
