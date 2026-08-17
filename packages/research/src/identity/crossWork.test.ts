import { describe, expect, it } from "vitest";
import { bm25Shortlist, mergeCandidateIds, retrievalTokens } from "./crossWork";

describe("cross-work retrieval", () => {
  it("uses substantive terms and ranks lexical overlap without claiming a relationship", () => {
    expect(retrievalTokens("The virtue and the good life")).toEqual(["virtue", "good", "life"]);
    const candidates = bm25Shortlist(
      { workId: "a", text: "virtue ethics and practical wisdom" },
      [
        { workId: "a", text: "virtue ethics and practical wisdom" },
        { workId: "b", text: "practical wisdom and virtue in ethics" },
        { workId: "c", text: "quantum mechanics and observation" },
      ],
    );
    expect(candidates.map((candidate) => candidate.targetWorkId)).toEqual(["b"]);
    expect(candidates[0]?.sharedTerms).toContain("virtue");
  });

  it("keeps the automatic candidate ceiling when lexical and vector results overlap", () => {
    const bm25 = Array.from({ length: 20 }, (_, index) => ({ targetWorkId: `b${index}`, score: 20 - index, sharedTerms: [] }));
    const embeddings = Array.from({ length: 20 }, (_, index) => ({ targetWorkId: `b${index + 10}`, score: 0.9 }));
    expect(mergeCandidateIds(bm25, embeddings, 20)).toHaveLength(20);
  });
});
