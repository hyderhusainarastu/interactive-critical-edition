import { describe, expect, it } from "vitest";
import { Bm25Index, rank } from "./bm25";

describe("Bm25Index", () => {
  it("returns an empty array for fewer than 2 documents", () => {
    expect(new Bm25Index([]).query("anything")).toEqual([]);
    expect(new Bm25Index(["only doc"]).query("only doc")).toEqual([]);
  });

  it("returns an empty array when the query shares no tokens with the corpus", () => {
    const index = new Bm25Index(["BERT fails on long documents", "transformer attention degrades"]);
    expect(index.query("completely unrelated topic zzz")).toEqual([]);
  });

  it("ranks the document with the most shared rare terms highest", () => {
    const docs = [
      "BERT fails on documents exceeding 512 tokens", // 0 — shares "tokens", "512"
      "transformer attention degrades on long-context inputs", // 1 — shares nothing distinctive
      "GPT-4 achieved 90% accuracy on the benchmark", // 2 — unrelated
    ];
    const index = new Bm25Index(docs);
    const matches = index.query("the model handles 512 tokens well");
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].docIndex).toBe(0);
  });

  it("normalizes scores to [0,1] with the top match at 1.0", () => {
    const docs = ["shared term shared term", "shared term only once", "nothing in common"];
    const index = new Bm25Index(docs);
    const matches = index.query("shared term");
    expect(matches[0].score).toBeCloseTo(1, 6);
    for (const m of matches) {
      expect(m.score).toBeGreaterThan(0);
      expect(m.score).toBeLessThanOrEqual(1);
    }
  });

  it("keeps acronyms and numbers intact, splitting on hyphens (per the ported tokenizer)", () => {
    // "GPT-4" should tokenize to ["gpt", "4"], not be destroyed or merged.
    // A 3rd, unrelated doc keeps this out of the 2-doc degenerate case where
    // a term present in exactly one of two docs has a genuinely zero IDF
    // under the classic Okapi formula (ln(2-1+0.5)-ln(1+0.5) = 0) — see the
    // "rank" describe block below for the same fixture-size note.
    const index = new Bm25Index([
      "GPT-4 outperforms baselines",
      "an unrelated sentence about cats",
      "a third, entirely different filler document",
    ]);
    const matches = index.query("GPT-4 results");
    expect(matches[0].docIndex).toBe(0);
  });

  it("respects the top-n limit", () => {
    const docs = ["shared", "shared shared", "shared shared shared", "shared shared shared shared"];
    const index = new Bm25Index(docs);
    const matches = index.query("shared", 2);
    expect(matches.length).toBeLessThanOrEqual(2);
  });

  it("exposes corpus size via .size", () => {
    expect(new Bm25Index(["a", "b", "c"]).size).toBe(3);
  });
});

describe("rank (one-shot helper)", () => {
  it("builds an index and queries it in one call", () => {
    // 3 docs, not 2: with only 2 docs, a query term present in exactly one
    // of them has IDF = ln(2-1+0.5)-ln(1+0.5) = ln(1.5)-ln(1.5) = 0 under
    // the classic Okapi formula this ports — a real, correct property of
    // the math (not a bug), but a degenerate corpus size for THIS test's
    // purpose of showing a real ranking.
    const matches = rank(["cats are great", "dogs are great", "birds are nice too"], "cats");
    expect(matches[0].docIndex).toBe(0);
  });
});
