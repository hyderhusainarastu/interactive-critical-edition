import { describe, expect, it } from "vitest";
import { buildEvidenceChamberPrompt, validateEvidenceChamberResponse } from "./evidenceChamber";

function validPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    question: "Does akrasia involve a failure of knowledge or a failure of will?",
    sharedGround: "Both agree the akratic agent acts against their better judgment.",
    pointOfDivergence: "Irwin locates the failure in incomplete practical reasoning; Davidson in weakness of will.",
    possibleReconciliation: "The two accounts may describe different stages of the same process.",
    unresolvedQuestion: "Whether the practical syllogism model can be tested independently of the reading itself.",
    missingEvidence: "A shared criterion for what counts as 'complete' practical reasoning.",
    nextAction: "Compare both readings against NE 7.3's own text directly.",
    positions: [
      { label: "Irwin", summary: "Incomplete syllogism.", method: "textual", scope: "NE 7.3", stanceConfidence: "high" },
      { label: "Davidson", summary: "Weakness of will.", method: "philosophical", scope: "general akrasia", stanceConfidence: "medium" },
    ],
    ...overrides,
  };
}

describe("buildEvidenceChamberPrompt", () => {
  it("includes the cluster name and each claim as a labeled position", () => {
    const prompt = buildEvidenceChamberPrompt({
      clusterName: "Akrasia debate",
      claims: [
        { text: "Claim 1 text.", workTitle: "Work A" },
        { text: "Claim 2 text.", workTitle: "Work B" },
      ],
    });
    expect(prompt).toContain('cluster named "Akrasia debate"');
    expect(prompt).toContain("[Position 1] Work A: Claim 1 text.");
    expect(prompt).toContain("[Position 2] Work B: Claim 2 text.");
  });

  it("explicitly forbids declaring a winner and forbids winner-like field names", () => {
    const prompt = buildEvidenceChamberPrompt({ clusterName: "X", claims: [] });
    expect(prompt).toContain("Do not declare a winner");
    expect(prompt).toContain("'winner', 'verdict', 'stronger', 'prevail', or 'rank'");
  });

  it("asks for every required field including the positions array shape", () => {
    const prompt = buildEvidenceChamberPrompt({ clusterName: "X", claims: [] });
    for (const field of [
      "question",
      "sharedGround",
      "pointOfDivergence",
      "possibleReconciliation",
      "unresolvedQuestion",
      "missingEvidence",
      "nextAction",
      "positions",
      "stanceConfidence",
    ]) {
      expect(prompt).toContain(field);
    }
  });
});

describe("validateEvidenceChamberResponse", () => {
  it("accepts a well-formed, neutral response", () => {
    const result = validateEvidenceChamberResponse(validPayload());
    expect(result.positions).toHaveLength(2);
    expect(result.positions[0].label).toBe("Irwin");
  });

  it("throws when a top-level key looks like a ranking/verdict field (e.g. 'winner')", () => {
    expect(() => validateEvidenceChamberResponse(validPayload({ winner: "Irwin" }))).toThrow(
      /forbidden ranking-like key/,
    );
  });

  it("throws for each forbidden pattern: verdict, stronger, prevail, rank", () => {
    for (const key of ["verdict", "strongerPosition", "prevailingView", "overallRank"]) {
      expect(() => validateEvidenceChamberResponse(validPayload({ [key]: "x" }))).toThrow(
        /forbidden ranking-like key/,
      );
    }
  });

  it("throws when a forbidden key is nested INSIDE a position, not just at the top level", () => {
    const payload = validPayload();
    (payload.positions[0] as Record<string, unknown>).stronger = true;
    expect(() => validateEvidenceChamberResponse(payload)).toThrow(/forbidden ranking-like key "stronger"/);
  });

  it("throws when a forbidden key is nested arbitrarily deep (recursive rejection)", () => {
    const payload = validPayload({ meta: { nested: { deeply: { verdictOfSorts: "x" } } } });
    expect(() => validateEvidenceChamberResponse(payload)).toThrow(/forbidden ranking-like key "verdictOfSorts"/);
  });

  it("is case-insensitive on the forbidden-key match", () => {
    expect(() => validateEvidenceChamberResponse(validPayload({ WINNER: "x" }))).toThrow(
      /forbidden ranking-like key/,
    );
  });

  it("throws when a required string field is missing", () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).sharedGround;
    expect(() => validateEvidenceChamberResponse(payload)).toThrow(/missing\/invalid string field "sharedGround"/);
  });

  it("throws when positions is not an array", () => {
    expect(() => validateEvidenceChamberResponse(validPayload({ positions: "not an array" }))).toThrow(
      /"positions" must be an array/,
    );
  });

  it("throws when a position has an invalid stanceConfidence", () => {
    const payload = validPayload();
    (payload.positions[0] as Record<string, unknown>).stanceConfidence = "very-high";
    expect(() => validateEvidenceChamberResponse(payload)).toThrow(/stanceConfidence" must be high\/medium\/low/);
  });

  it("throws when a position is missing a required string field", () => {
    const payload = validPayload();
    delete (payload.positions[0] as Record<string, unknown>).method;
    expect(() => validateEvidenceChamberResponse(payload)).toThrow(/position 0: missing\/invalid string field "method"/);
  });
});
