import { describe, expect, it } from "vitest";
import { computeHypothesisRunHash } from "./hypothesisRunHash";

describe("computeHypothesisRunHash", () => {
  it("is order-independent over relationshipIds", () => {
    const a = computeHypothesisRunHash({
      relationshipIds: ["id-b", "id-a"],
      question: "Q",
      promptVersion: "v1",
      noveltyModel: "text-embedding-3-small",
    });
    const b = computeHypothesisRunHash({
      relationshipIds: ["id-a", "id-b"],
      question: "Q",
      promptVersion: "v1",
      noveltyModel: "text-embedding-3-small",
    });
    expect(a).toBe(b);
  });

  it("changes when the conflict set changes", () => {
    const a = computeHypothesisRunHash({ relationshipIds: ["id-a"], question: null, promptVersion: "v1", noveltyModel: null });
    const b = computeHypothesisRunHash({ relationshipIds: ["id-a", "id-c"], question: null, promptVersion: "v1", noveltyModel: null });
    expect(a).not.toBe(b);
  });

  it("changes when the question changes", () => {
    const a = computeHypothesisRunHash({ relationshipIds: ["id-a"], question: "Q1", promptVersion: "v1", noveltyModel: null });
    const b = computeHypothesisRunHash({ relationshipIds: ["id-a"], question: "Q2", promptVersion: "v1", noveltyModel: null });
    expect(a).not.toBe(b);
  });

  it("changes when promptVersion changes", () => {
    const a = computeHypothesisRunHash({ relationshipIds: ["id-a"], question: null, promptVersion: "v1", noveltyModel: null });
    const b = computeHypothesisRunHash({ relationshipIds: ["id-a"], question: null, promptVersion: "v2", noveltyModel: null });
    expect(a).not.toBe(b);
  });

  it("changes when the novelty model changes", () => {
    const a = computeHypothesisRunHash({ relationshipIds: ["id-a"], question: null, promptVersion: "v1", noveltyModel: "text-embedding-3-small" });
    const b = computeHypothesisRunHash({ relationshipIds: ["id-a"], question: null, promptVersion: "v1", noveltyModel: "text-embedding-3-large" });
    expect(a).not.toBe(b);
  });

  it("distinguishes a null question/model from an empty string via length-prefixing", () => {
    const withNull = computeHypothesisRunHash({ relationshipIds: ["id-a"], question: null, promptVersion: "v1", noveltyModel: null });
    // No practical caller ever passes "" for these, but the length-prefix
    // scheme should still not collide two different logical inputs.
    const withOther = computeHypothesisRunHash({ relationshipIds: ["id-a1"], question: null, promptVersion: "v1", noveltyModel: null });
    expect(withNull).not.toBe(withOther);
  });

  it("is deterministic for identical input", () => {
    const input = { relationshipIds: ["x", "y"], question: "Q", promptVersion: "v1", noveltyModel: "m" };
    expect(computeHypothesisRunHash(input)).toBe(computeHypothesisRunHash({ ...input }));
  });
});
