import { describe, expect, it } from "vitest";
import { compactWorkSignal, cosineSimilarity, workSignalHash } from "./v4";

describe("v4 work signals", () => {
  it("uses only compact grounded fields and hashes them stably", () => {
    const signal = compactWorkSignal({
      title: "Ethics",
      author: "Aristotle",
      concepts: ["virtue"],
      claims: [{ claim: "Virtue is learned.", supportingExcerpt: "we become just by doing just acts" }],
    });
    expect(signal).toContain("Grounded claims");
    expect(workSignalHash(signal)).toBe(workSignalHash(signal));
  });

  it("computes cosine similarity only for compatible vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1], [1, 0])).toBeNull();
  });
});
