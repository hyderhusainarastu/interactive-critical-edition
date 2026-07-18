import { describe, expect, it } from "vitest";
import { classifyWithProvider } from "./classify";
import { heuristicClassify } from "./providers/heuristic";
import { RELATIONSHIP_CATEGORIES, type ClassificationInput, type LLMProvider } from "./types";

const base: ClassificationInput = {
  primaryTitle: "Being and Time",
  primaryAuthor: "Heidegger",
  candidateTitle: "Critique of Pure Reason",
  candidateAuthor: "Kant",
  sourceText: "Here Heidegger builds on Kant's transcendental analysis.",
  resolved: true,
};

describe("heuristicClassify", () => {
  it("is deterministic for the same input", () => {
    const a = heuristicClassify(base);
    const b = heuristicClassify(base);
    expect(a).toEqual(b);
  });

  it("always returns a valid category and a 0..1 confidence", () => {
    const r = heuristicClassify(base);
    expect(RELATIONSHIP_CATEGORIES).toContain(r.category);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("flags itself as heuristic with zero token usage", () => {
    const r = heuristicClassify(base);
    expect(r.heuristic).toBe(true);
    expect(r.model).toBe("heuristic-fallback");
    expect(r.promptTokens).toBe(0);
  });

  it("detects a polemical/disagreement cue", () => {
    const r = heuristicClassify({ ...base, sourceText: "Heidegger rejects Descartes's error here." });
    expect(r.category).toBe("disagreement_polemical_target");
  });

  it("detects conceptual influence", () => {
    const r = heuristicClassify({ ...base, sourceText: "This chapter is deeply indebted to Husserl." });
    expect(r.category).toBe("conceptual_influence");
  });

  it("treats a resolved secondary-literature title as a scholarly recommendation", () => {
    const r = heuristicClassify({
      ...base,
      candidateTitle: "A Companion to Being and Time",
      sourceText: "See the standard companion volume.",
    });
    expect(r.category).toBe("secondary_scholarly_recommendation");
  });

  it("defaults an unresolved citation with no cue to ai_inferred at low confidence", () => {
    const r = heuristicClassify({ ...base, resolved: false, sourceText: "A passing mention." });
    expect(r.category).toBe("ai_inferred");
    expect(r.confidence).toBeLessThan(0.5);
  });
});

describe("classifyWithProvider", () => {
  function mockProvider(text: string): LLMProvider {
    return {
      name: "mock",
      model: "mock-1",
      async complete() {
        return { text, provider: "mock", model: "mock-1", promptTokens: 42, completionTokens: 7 };
      },
    };
  }

  it("parses a valid JSON verdict and records real provenance", async () => {
    const provider = mockProvider(
      JSON.stringify({ category: "conceptual_influence", explanation: "Builds on Kant.", confidence: 0.82 }),
    );
    const r = await classifyWithProvider(provider, base);
    expect(r.category).toBe("conceptual_influence");
    expect(r.confidence).toBeCloseTo(0.82);
    expect(r.heuristic).toBe(false);
    expect(r.provider).toBe("mock");
    expect(r.promptTokens).toBe(42);
  });

  it("extracts JSON from a chatty reply", async () => {
    const provider = mockProvider('Sure! {"category":"prerequisite","explanation":"Read first.","confidence":0.6} done');
    const r = await classifyWithProvider(provider, base);
    expect(r.category).toBe("prerequisite");
  });

  it("clamps an out-of-range confidence", async () => {
    const provider = mockProvider(JSON.stringify({ category: "explicit_reference", explanation: "x", confidence: 5 }));
    const r = await classifyWithProvider(provider, base);
    expect(r.confidence).toBe(1);
  });

  it("falls back to the heuristic on an invalid category, keeping real token counts", async () => {
    const provider = mockProvider(JSON.stringify({ category: "not_a_real_category", explanation: "x", confidence: 0.9 }));
    const r = await classifyWithProvider(provider, base);
    expect(RELATIONSHIP_CATEGORIES).toContain(r.category);
    expect(r.heuristic).toBe(true);
    expect(r.promptTokens).toBe(42); // real usage preserved for cost logging
  });

  it("falls back to the heuristic on unparseable output", async () => {
    const provider = mockProvider("the model rambled and produced no json at all");
    const r = await classifyWithProvider(provider, base);
    expect(r.heuristic).toBe(true);
    expect(RELATIONSHIP_CATEGORIES).toContain(r.category);
  });
});
