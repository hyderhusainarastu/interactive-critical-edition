import { describe, expect, it, vi } from "vitest";
import {
  ragHybridRetrievalEnabled,
  rankHybrid,
  rankOwnerChunks,
  type EmbeddableRow,
  type HybridScoredRow,
} from "./hybridRetrieval";
import { rankLexically } from "./lexicalRetrieval";

type Row = EmbeddableRow & { id: string };

// A deliberately synthetic, engineered corpus — not "realistic" prose — so
// BM25's IDF math and cosine similarity are both hand-verifiable and every
// row exercises exactly one of the four provenance outcomes (bm25-only,
// dense-only, both, neither). Query is always "zeta" against this corpus.
const FILLER: Row = { id: "filler", content: "The committee reviewed routine paperwork today.", embedding: [1, 0, 0], embeddingModel: "text-embedding-3-small" };
const BM25_ONLY: Row = { id: "bm25-only", content: "zeta compound was isolated from the sample.", embedding: null, embeddingModel: null };
const BOTH_CHANNELS: Row = { id: "both", content: "zeta compound structure was analyzed further.", embedding: [0, 1, 0], embeddingModel: "text-embedding-3-small" };
const STALE_MODEL: Row = { id: "stale-model", content: "zeta reagent was measured precisely.", embedding: [0, 1, 0], embeddingModel: "text-embedding-3-large" };
const DENSE_ONLY: Row = { id: "dense-only", content: "The garden club met on Tuesday afternoon.", embedding: [0, 1, 0], embeddingModel: "text-embedding-3-small" };

const ZETA_CORPUS: Row[] = [FILLER, BM25_ONLY, BOTH_CHANNELS, STALE_MODEL, DENSE_ONLY];
const QUERY_EMBEDDING = { model: "text-embedding-3-small", embedding: [0, 1, 0] };

describe("ragHybridRetrievalEnabled", () => {
  it("defaults to off when unset", () => {
    expect(ragHybridRetrievalEnabled({})).toBe(false);
  });

  it("parses house-pattern truthy/falsy values", () => {
    expect(ragHybridRetrievalEnabled({ RAG_HYBRID_RETRIEVAL: "true" })).toBe(true);
    expect(ragHybridRetrievalEnabled({ RAG_HYBRID_RETRIEVAL: "1" })).toBe(true);
    expect(ragHybridRetrievalEnabled({ RAG_HYBRID_RETRIEVAL: "on" })).toBe(true);
    expect(ragHybridRetrievalEnabled({ RAG_HYBRID_RETRIEVAL: "false" })).toBe(false);
    expect(ragHybridRetrievalEnabled({ RAG_HYBRID_RETRIEVAL: "0" })).toBe(false);
  });

  it("treats an unrecognized value as unset (off), not a parse error", () => {
    expect(ragHybridRetrievalEnabled({ RAG_HYBRID_RETRIEVAL: "sometimes" })).toBe(false);
  });
});

function channelsFor(id: string, results: HybridScoredRow<Row>[]): string[] {
  const entry = results.find((r) => r.row.id === id);
  return entry ? entry.channels.map((c) => c.channel).sort() : [];
}

describe("rankHybrid — channel provenance and the normalized-max union", () => {
  const results = rankHybrid("zeta", ZETA_CORPUS, QUERY_EMBEDDING, 10);

  it("tags a row found only by the BM25 channel (no stored embedding)", () => {
    expect(channelsFor("bm25-only", results)).toEqual(["bm25"]);
  });

  it("tags a row found only by the dense channel (no lexical term overlap)", () => {
    expect(channelsFor("dense-only", results)).toEqual(["dense"]);
  });

  it("tags a row found by both channels, keeping both scores", () => {
    const entry = results.find((r) => r.row.id === "both")!;
    expect(entry.channels.map((c) => c.channel).sort()).toEqual(["bm25", "dense"]);
    expect(entry.channels.every((c) => c.score > 0)).toBe(true);
  });

  it("degrades a chunk with a mismatched embedding model to BM25-only", () => {
    expect(channelsFor("stale-model", results)).toEqual(["bm25"]);
  });

  it("drops a row with zero support from every channel", () => {
    expect(results.some((r) => r.row.id === "filler")).toBe(false);
  });

  it("normalizes each channel to [0,1] against that channel's own top score for this query", () => {
    for (const entry of results) {
      for (const channel of entry.channels) {
        expect(channel.score).toBeGreaterThan(0);
        expect(channel.score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("ranks by the max of a row's normalized channel scores", () => {
    for (const entry of results) {
      expect(entry.score).toBe(Math.max(...entry.channels.map((c) => c.score)));
    }
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
    }
  });

  it("scores nothing on the dense channel when queryEmbedding is null (BM25-only overall)", () => {
    const bm25Only = rankHybrid("zeta", ZETA_CORPUS, null, 10);
    expect(bm25Only.length).toBeGreaterThan(0);
    for (const entry of bm25Only) {
      expect(entry.channels.every((c) => c.channel === "bm25")).toBe(true);
    }
    // dense-only would have nothing to be found by without a query embedding.
    expect(bm25Only.some((r) => r.row.id === "dense-only")).toBe(false);
  });

  it("respects the limit", () => {
    const limited = rankHybrid("zeta", ZETA_CORPUS, QUERY_EMBEDDING, 2);
    expect(limited).toHaveLength(2);
  });

  it("returns nothing for a corpus with fewer than 2 rows and no query embedding (BM25's own minimum)", () => {
    expect(rankHybrid("zeta", [BM25_ONLY], null, 10)).toEqual([]);
  });
});

describe("rankOwnerChunks — the flag/embedding orchestration", () => {
  it("flag off: behaves identically to calling rankLexically directly", async () => {
    const viaOrchestrator = await rankOwnerChunks("zeta compound", ZETA_CORPUS, 5, { hybridEnabled: false });
    const direct = rankLexically("zeta compound", ZETA_CORPUS, 5);
    expect(viaOrchestrator).toEqual(direct);
  });

  it("flag on, embedQuery throws (no provider configured): degrades to the exact same lexical result as flag-off", async () => {
    const embedQuery = vi.fn().mockRejectedValue(new Error("OPENAI_API_KEY not configured"));
    const hybridResult = await rankOwnerChunks("zeta compound", ZETA_CORPUS, 5, { hybridEnabled: true, embedQuery });
    const lexicalResult = await rankOwnerChunks("zeta compound", ZETA_CORPUS, 5, { hybridEnabled: false });
    expect(hybridResult).toEqual(lexicalResult);
    expect(embedQuery).toHaveBeenCalledWith("zeta compound");
  });

  it("flag on, embedQuery succeeds: uses hybrid ranking, recovering a dense-only match the lexical formula misses", async () => {
    const embedQuery = vi.fn().mockResolvedValue({ embedding: [0, 1, 0], model: "text-embedding-3-small", inputTokens: 3 });
    const result = await rankOwnerChunks("zeta", ZETA_CORPUS, 10, { hybridEnabled: true, embedQuery });
    expect(result.some((row) => row.id === "dense-only")).toBe(true);
    const lexicalOnly = rankLexically("zeta", ZETA_CORPUS, 10);
    expect(lexicalOnly.some((row) => row.id === "dense-only")).toBe(false);
  });

  it("a chunk missing an embedding still surfaces via the BM25 channel under hybrid ranking", async () => {
    const embedQuery = vi.fn().mockResolvedValue({ embedding: [0, 1, 0], model: "text-embedding-3-small", inputTokens: 3 });
    const result = await rankOwnerChunks("zeta", ZETA_CORPUS, 10, { hybridEnabled: true, embedQuery });
    expect(result.some((row) => row.id === "bm25-only")).toBe(true);
  });
});
