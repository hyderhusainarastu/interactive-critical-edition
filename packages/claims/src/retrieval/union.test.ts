import { describe, expect, it } from "vitest";
import { unionCandidates, type ChannelPair } from "./union";

describe("unionCandidates", () => {
  it("returns one candidate per unique pair across a single channel", () => {
    const dense: ChannelPair[] = [
      { loId: "a", hiId: "b", channel: "dense", score: 0.7 },
      { loId: "c", hiId: "d", channel: "dense", score: 0.8 },
    ];
    const result = unionCandidates(dense);
    expect(result).toHaveLength(2);
  });

  it("merges the same pair found by two different channels into one candidate", () => {
    const dense: ChannelPair[] = [{ loId: "a", hiId: "b", channel: "dense", score: 0.65 }];
    const bm25: ChannelPair[] = [{ loId: "a", hiId: "b", channel: "bm25", score: 0.3 }];
    const result = unionCandidates(dense, bm25);
    expect(result).toHaveLength(1);
    expect(result[0].retrievalSources).toEqual(
      expect.arrayContaining([
        { channel: "dense", score: 0.65 },
        { channel: "bm25", score: 0.3 },
      ]),
    );
  });

  it("bestScore is the max across channels, never the sum or average", () => {
    const dense: ChannelPair[] = [{ loId: "a", hiId: "b", channel: "dense", score: 0.65 }];
    const bm25: ChannelPair[] = [{ loId: "a", hiId: "b", channel: "bm25", score: 0.9 }];
    const result = unionCandidates(dense, bm25);
    expect(result[0].bestScore).toBe(0.9);
  });

  it("merges regardless of loId/hiId order across channels", () => {
    const dense: ChannelPair[] = [{ loId: "a", hiId: "b", channel: "dense", score: 0.5 }];
    const locus: ChannelPair[] = [{ loId: "b", hiId: "a", channel: "locus", score: 1.0 }];
    const result = unionCandidates(dense, locus);
    expect(result).toHaveLength(1);
    expect(result[0].loId).toBe("a");
    expect(result[0].hiId).toBe("b");
    expect(result[0].retrievalSources).toHaveLength(2);
  });

  it("never drops a channel's provenance even when scores differ", () => {
    const a: ChannelPair[] = [{ loId: "x", hiId: "y", channel: "dense", score: 0.1 }];
    const b: ChannelPair[] = [{ loId: "x", hiId: "y", channel: "locus_section", score: 0.7 }];
    const c: ChannelPair[] = [{ loId: "x", hiId: "y", channel: "locus", score: 1.0 }];
    const result = unionCandidates(a, b, c);
    expect(result[0].retrievalSources).toHaveLength(3);
    expect(result[0].bestScore).toBe(1.0);
  });

  it("returns an empty array when given no channels or all-empty channels", () => {
    expect(unionCandidates()).toEqual([]);
    expect(unionCandidates([], [])).toEqual([]);
  });
});
