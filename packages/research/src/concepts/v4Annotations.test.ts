import { describe, expect, it } from "vitest";
import { chunkSectionAwareBlocks, dedupePassageAnnotations } from "./v4Annotations";

describe("chunkSectionAwareBlocks", () => {
  it("keeps chunks within a section and the approved character cap", () => {
    const chunks = chunkSectionAwareBlocks([
      { blockId: "one", text: "a".repeat(8_000), pageIndex: 0, blockOrder: 0, sectionTitle: "One" },
      { blockId: "two", text: "b".repeat(8_000), pageIndex: 1, blockOrder: 0, sectionTitle: "One" },
      { blockId: "three", text: "c".repeat(2_000), pageIndex: 2, blockOrder: 0, sectionTitle: "Two" },
    ]);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.totalChars <= 12_000)).toBe(true);
    expect(chunks.map((chunk) => chunk.sectionTitle)).toEqual(["One", "One", "Two"]);
  });

  it("stops at eight chunks rather than expanding cost with document length", () => {
    const chunks = chunkSectionAwareBlocks(
      Array.from({ length: 10 }, (_, index) => ({
        blockId: String(index),
        text: "x".repeat(12_000),
        pageIndex: index,
        blockOrder: 0,
        sectionTitle: `section ${index}`,
      })),
    );
    expect(chunks).toHaveLength(8);
  });
});

describe("dedupePassageAnnotations", () => {
  it("keeps the higher-confidence duplicate anchor", () => {
    const base = {
      isWholeWork: false,
      blockId: "block",
      summary: "A claim.",
      explanation: "Explanation.",
      helpfulFor: "Understand the claim.",
      annotationType: "argument" as const,
      relationship: "interpretive_aid",
      readerLevel: null,
    };
    const result = dedupePassageAnnotations([
      { ...base, quote: "The author argues that virtue is learned.", confidence: 0.4 },
      { ...base, quote: "virtue is learned", confidence: 0.9 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe(0.9);
  });
});
