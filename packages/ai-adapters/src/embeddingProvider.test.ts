import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NullEmbeddingProvider,
  OpenAIEmbeddingsProvider,
  VoyageEmbeddingsProvider,
  resolveEmbeddingProvider,
} from "./embeddingProvider";

describe("VoyageEmbeddingsProvider — double gate", () => {
  it("is unavailable and throws when only VOYAGE_API_KEY is set", async () => {
    const provider = new VoyageEmbeddingsProvider({ VOYAGE_API_KEY: "vk-test", EMBEDDING_PROVIDER: undefined, VOYAGE_EMBEDDING_MODEL: undefined });
    expect(provider.available).toBe(false);
    await expect(provider.embedBatch(["x"])).rejects.toThrow(/VOYAGE_API_KEY and EMBEDDING_PROVIDER/);
  });

  it("is unavailable and throws when only EMBEDDING_PROVIDER=voyage is set", async () => {
    const provider = new VoyageEmbeddingsProvider({ VOYAGE_API_KEY: undefined, EMBEDDING_PROVIDER: "voyage", VOYAGE_EMBEDDING_MODEL: undefined });
    expect(provider.available).toBe(false);
    await expect(provider.embedBatch(["x"])).rejects.toThrow(/VOYAGE_API_KEY and EMBEDDING_PROVIDER/);
  });

  it("is unavailable and throws when neither env var is set", async () => {
    const provider = new VoyageEmbeddingsProvider({ VOYAGE_API_KEY: undefined, EMBEDDING_PROVIDER: undefined, VOYAGE_EMBEDDING_MODEL: undefined });
    expect(provider.available).toBe(false);
    await expect(provider.embedBatch(["x"])).rejects.toThrow(/VOYAGE_API_KEY and EMBEDDING_PROVIDER/);
  });

  it("passes the gate when both env vars are set, but still throws — it is a stub, never a real call", async () => {
    const provider = new VoyageEmbeddingsProvider({ VOYAGE_API_KEY: "vk-test", EMBEDDING_PROVIDER: "voyage", VOYAGE_EMBEDDING_MODEL: undefined });
    expect(provider.available).toBe(true);
    // A different error message than the gate-failure cases above proves the
    // gate was actually passed, not just re-triggered by a different path.
    await expect(provider.embedBatch(["x"])).rejects.toThrow(/stub/i);
    await expect(provider.embedBatch(["x"])).rejects.not.toThrow(/VOYAGE_API_KEY and EMBEDDING_PROVIDER/);
  });

  it("never makes a network call, gate open or closed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VoyageEmbeddingsProvider({ VOYAGE_API_KEY: "vk-test", EMBEDDING_PROVIDER: "voyage", VOYAGE_EMBEDDING_MODEL: undefined });
    await provider.embedBatch(["x"]).catch(() => undefined);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports zero cost — it never actually spends anything", () => {
    const provider = new VoyageEmbeddingsProvider({ VOYAGE_API_KEY: undefined, EMBEDDING_PROVIDER: undefined, VOYAGE_EMBEDDING_MODEL: undefined });
    expect(provider.estimateCostUsd(1_000_000)).toBe(0);
  });
});

describe("NullEmbeddingProvider", () => {
  it("reports itself unavailable and never claims a dimension", () => {
    const provider = new NullEmbeddingProvider();
    expect(provider.available).toBe(false);
    expect(provider.dim).toBe(0);
  });

  it("throws a clear message on embedBatch rather than returning empty vectors silently", async () => {
    const provider = new NullEmbeddingProvider();
    await expect(provider.embedBatch(["x", "y"])).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("reports zero cost", () => {
    expect(new NullEmbeddingProvider().estimateCostUsd(1_000_000)).toBe(0);
  });
});

describe("OpenAIEmbeddingsProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("defaults to text-embedding-3-small at dim 1536", () => {
    const provider = new OpenAIEmbeddingsProvider("key");
    expect(provider.model).toBe("text-embedding-3-small");
    expect(provider.dim).toBe(1536);
    expect(provider.available).toBe(true);
  });

  it("honors an explicit text-embedding-3-large model at dim 3072", () => {
    const provider = new OpenAIEmbeddingsProvider("key", "text-embedding-3-large");
    expect(provider.model).toBe("text-embedding-3-large");
    expect(provider.dim).toBe(3072);
  });

  it("is unavailable without a key", () => {
    expect(new OpenAIEmbeddingsProvider(undefined).available).toBe(false);
  });

  it("embedBatch delegates to the underlying client's embedMany", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2], index: 0 }],
      model: "text-embedding-3-small",
      usage: { prompt_tokens: 5 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAIEmbeddingsProvider("key");
    const result = await provider.embedBatch(["hello"]);
    expect(result.vectors).toEqual([[0.1, 0.2]]);
    expect(result.inputTokens).toBe(5);
  });

  it("estimates cost via the shared price table", () => {
    const small = new OpenAIEmbeddingsProvider("key");
    const large = new OpenAIEmbeddingsProvider("key", "text-embedding-3-large");
    expect(small.estimateCostUsd(1_000_000)).toBe(0.02);
    expect(large.estimateCostUsd(1_000_000)).toBe(0.13);
  });
});

describe("resolveEmbeddingProvider", () => {
  it("returns NullEmbeddingProvider when no OPENAI_API_KEY is set and voyage isn't selected", () => {
    const provider = resolveEmbeddingProvider({});
    expect(provider).toBeInstanceOf(NullEmbeddingProvider);
  });

  it("returns OpenAIEmbeddingsProvider when OPENAI_API_KEY is set", () => {
    const provider = resolveEmbeddingProvider({ OPENAI_API_KEY: "sk-test" });
    expect(provider).toBeInstanceOf(OpenAIEmbeddingsProvider);
    expect(provider.model).toBe("text-embedding-3-small");
  });

  it("honors RESEARCH_EMBEDDING_MODEL for the large model", () => {
    const provider = resolveEmbeddingProvider({ OPENAI_API_KEY: "sk-test", RESEARCH_EMBEDDING_MODEL: "text-embedding-3-large" });
    expect(provider.model).toBe("text-embedding-3-large");
    expect(provider.dim).toBe(3072);
  });

  it("returns VoyageEmbeddingsProvider when EMBEDDING_PROVIDER=voyage is set, regardless of OPENAI_API_KEY", () => {
    const provider = resolveEmbeddingProvider({ EMBEDDING_PROVIDER: "voyage", VOYAGE_API_KEY: "vk-test" });
    expect(provider).toBeInstanceOf(VoyageEmbeddingsProvider);
    expect(provider.available).toBe(true);
  });

  it("returns a gated (unavailable) VoyageEmbeddingsProvider if selected without a key", () => {
    const provider = resolveEmbeddingProvider({ EMBEDDING_PROVIDER: "voyage" });
    expect(provider).toBeInstanceOf(VoyageEmbeddingsProvider);
    expect(provider.available).toBe(false);
  });
});
