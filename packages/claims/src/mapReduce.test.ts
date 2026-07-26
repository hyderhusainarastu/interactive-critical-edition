import { describe, expect, it } from "vitest";
import { CLAIM_ELIGIBLE_BLOCK_KINDS, planExtractionChunks, type ExtractionBlock } from "./mapReduce";

function block(id: string, sectionLabel: string, text: string, kind = "body"): ExtractionBlock {
  return { id, kind, sectionLabel, text };
}

describe("CLAIM_ELIGIBLE_BLOCK_KINDS", () => {
  it("is an allowlist containing only 'body'", () => {
    expect(CLAIM_ELIGIBLE_BLOCK_KINDS).toEqual(["body"]);
  });
});

describe("planExtractionChunks — allowlist filtering", () => {
  it("excludes non-body block kinds entirely", () => {
    const blocks = [block("1", "intro", "real prose"), block("2", "intro", "fig 1 caption", "caption")];
    const plan = planExtractionChunks(blocks);
    const allBlockIds = plan.chunks.flatMap((c) => c.blockIds);
    expect(allBlockIds).toEqual(["1"]);
  });

  it("returns zero chunks when nothing is eligible", () => {
    const blocks = [block("1", "intro", "footnote text", "footnote")];
    const plan = planExtractionChunks(blocks);
    expect(plan.chunks).toEqual([]);
    expect(plan.coverage).toBe("full"); // vacuously — nothing was excluded because there was nothing to include
  });
});

describe("planExtractionChunks — never splits a block", () => {
  it("a single block larger than maxChunkChars still gets its own whole chunk", () => {
    const blocks = [block("1", "s", "x".repeat(50))];
    const plan = planExtractionChunks(blocks, { maxChunkChars: 10 });
    expect(plan.chunks).toHaveLength(1);
    expect(plan.chunks[0].blockIds).toEqual(["1"]);
    expect(plan.chunks[0].text).toContain("x".repeat(50));
  });
});

describe("planExtractionChunks — never crosses a section boundary", () => {
  it("two small blocks in different sections never share a chunk even with plenty of room", () => {
    const blocks = [block("1", "sectionA", "short a"), block("2", "sectionB", "short b")];
    const plan = planExtractionChunks(blocks, { maxChunkChars: 1000 });
    expect(plan.chunks).toHaveLength(2);
    const sections = plan.chunks.map((c) => c.sectionLabel).sort();
    expect(sections).toEqual(["sectionA", "sectionB"]);
    for (const c of plan.chunks) expect(c.blockIds).toHaveLength(1);
  });
});

describe("planExtractionChunks — oversized section splits at block boundaries", () => {
  it("splits into multiple chunks, each re-prefixed with the section label", () => {
    const blocks = [
      block("1", "s", "a".repeat(15)),
      block("2", "s", "b".repeat(15)),
      block("3", "s", "c".repeat(15)),
    ];
    const plan = planExtractionChunks(blocks, { maxChunkChars: 20 });
    expect(plan.chunks).toHaveLength(3);
    for (const chunk of plan.chunks) {
      expect(chunk.sectionLabel).toBe("s");
      expect(chunk.text.startsWith("s\n\n")).toBe(true);
      expect(chunk.blockIds).toHaveLength(1); // never splits a block
    }
    expect(plan.chunks.flatMap((c) => c.blockIds)).toEqual(["1", "2", "3"]);
  });
});

describe("planExtractionChunks — section-importance ordering", () => {
  it("orders abstract, conclusion, introduction, results first, then the rest in first-seen order", () => {
    const blocks = [
      block("1", "random-middle", "x"),
      block("2", "results", "x"),
      block("3", "abstract", "x"),
      block("4", "another-unlabeled", "x"),
      block("5", "conclusion", "x"),
      block("6", "introduction", "x"),
    ];
    const plan = planExtractionChunks(blocks, { maxChunks: 20 });
    expect(plan.includedSections).toEqual([
      "abstract",
      "conclusion",
      "introduction",
      "results",
      "random-middle",
      "another-unlabeled",
    ]);
  });

  it("importance matching is case-insensitive and trims whitespace", () => {
    const blocks = [block("1", "  Abstract  ", "x"), block("2", "Body", "x")];
    const plan = planExtractionChunks(blocks);
    expect(plan.includedSections[0]).toBe("  Abstract  ");
  });
});

describe("planExtractionChunks — coverage semantics", () => {
  it("'full' when every eligible section gets at least one chunk", () => {
    const blocks = [block("1", "a", "x"), block("2", "b", "x")];
    const plan = planExtractionChunks(blocks, { maxChunks: 10 });
    expect(plan.coverage).toBe("full");
    expect(plan.excludedSections).toEqual([]);
  });

  it("'partial' when some sections are included and others fully excluded", () => {
    const blocks = [
      block("1", "abstract", "x"),
      block("2", "conclusion", "x"),
      block("3", "leftover-section", "x"),
    ];
    // Budget for exactly 2 whole sections (each 1 chunk) — the 3rd is fully excluded.
    const plan = planExtractionChunks(blocks, { maxChunks: 2 });
    expect(plan.coverage).toBe("partial");
    expect(plan.includedSections).toEqual(["abstract", "conclusion"]);
    expect(plan.excludedSections).toEqual(["leftover-section"]);
  });

  it("'sampled' when the single highest-priority section alone exceeds the chunk budget", () => {
    const blocks = [
      block("1", "abstract", "a".repeat(15)),
      block("2", "abstract", "b".repeat(15)),
      block("3", "abstract", "c".repeat(15)),
    ];
    const plan = planExtractionChunks(blocks, { maxChunkChars: 20, maxChunks: 2 });
    expect(plan.coverage).toBe("sampled");
    expect(plan.includedSections).toEqual(["abstract"]);
    expect(plan.chunks).toHaveLength(2); // truncated to the budget, never zero
  });
});

describe("planExtractionChunks — defaults", () => {
  it("uses the documented default maxChunkChars/maxChunks when not specified", () => {
    const blocks = [block("1", "s", "short text")];
    const plan = planExtractionChunks(blocks);
    expect(plan.chunks).toHaveLength(1);
    expect(plan.coverage).toBe("full");
  });

  it("returns an empty plan for zero blocks", () => {
    const plan = planExtractionChunks([]);
    expect(plan).toEqual({ chunks: [], coverage: "full", includedSections: [], excludedSections: [] });
  });
});
