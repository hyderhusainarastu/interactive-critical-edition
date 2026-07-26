import { describe, expect, it } from "vitest";
import { RETRIEVAL_THRESHOLDS } from "../thresholds";
import { locusPairs, sectionPairs, type ClaimLocus } from "./locus";

describe("locusPairs", () => {
  it("pairs cross-work claims sharing an exact locus at the ceiling score", () => {
    const claims: ClaimLocus[] = [
      { claimId: "a", workId: "work-1", locusKey: "NE-1151a20" },
      { claimId: "b", workId: "work-2", locusKey: "NE-1151a20" },
    ];
    expect(locusPairs(claims)).toEqual([
      { loId: "a", hiId: "b", score: RETRIEVAL_THRESHOLDS.locusScore, channel: "locus" },
    ]);
  });

  it("does not pair two claims from the SAME work even if they share a locus", () => {
    const claims: ClaimLocus[] = [
      { claimId: "a", workId: "work-1", locusKey: "NE-1151a20" },
      { claimId: "b", workId: "work-1", locusKey: "NE-1151a20" },
    ];
    expect(locusPairs(claims)).toEqual([]);
  });

  it("ignores claims with no locusKey", () => {
    const claims: ClaimLocus[] = [
      { claimId: "a", workId: "work-1", locusKey: null },
      { claimId: "b", workId: "work-2" },
    ];
    expect(locusPairs(claims)).toEqual([]);
  });

  it("produces every cross-work pair within a group of 3+ sharing the same locus, deduped", () => {
    const claims: ClaimLocus[] = [
      { claimId: "a", workId: "work-1", locusKey: "K" },
      { claimId: "b", workId: "work-2", locusKey: "K" },
      { claimId: "c", workId: "work-3", locusKey: "K" },
    ];
    const pairs = locusPairs(claims);
    expect(pairs).toHaveLength(3); // (a,b) (a,c) (b,c)
    const keys = new Set(pairs.map((p) => `${p.loId}-${p.hiId}`));
    expect(keys.size).toBe(3);
  });

  it("orders loId/hiId lexicographically regardless of input order", () => {
    const claims: ClaimLocus[] = [
      { claimId: "z", workId: "work-1", locusKey: "K" },
      { claimId: "a", workId: "work-2", locusKey: "K" },
    ];
    const pairs = locusPairs(claims);
    expect(pairs[0].loId).toBe("a");
    expect(pairs[0].hiId).toBe("z");
  });

  it("different locus keys never pair with each other", () => {
    const claims: ClaimLocus[] = [
      { claimId: "a", workId: "work-1", locusKey: "K1" },
      { claimId: "b", workId: "work-2", locusKey: "K2" },
    ];
    expect(locusPairs(claims)).toEqual([]);
  });
});

describe("sectionPairs", () => {
  it("pairs cross-work claims sharing a section at the weaker section score", () => {
    const claims: ClaimLocus[] = [
      { claimId: "a", workId: "work-1", sectionKey: "NE-book-7" },
      { claimId: "b", workId: "work-2", sectionKey: "NE-book-7" },
    ];
    expect(sectionPairs(claims)).toEqual([
      { loId: "a", hiId: "b", score: RETRIEVAL_THRESHOLDS.locusSectionScore, channel: "locus_section" },
    ]);
  });

  it("locus_section score is strictly weaker than the exact-locus score", () => {
    expect(RETRIEVAL_THRESHOLDS.locusSectionScore).toBeLessThan(RETRIEVAL_THRESHOLDS.locusScore);
  });

  it("ignores claims with no sectionKey", () => {
    const claims: ClaimLocus[] = [{ claimId: "a", workId: "work-1" }];
    expect(sectionPairs(claims)).toEqual([]);
  });
});
