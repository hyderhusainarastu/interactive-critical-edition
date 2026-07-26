import { describe, expect, it } from "vitest";
import { buildHypothesisPrompt, validateHypothesisResponse, type HypothesisConflictInput } from "./hypothesis";

function conflict(overrides: Partial<HypothesisConflictInput> = {}): HypothesisConflictInput {
  return {
    id: "real-uuid-1",
    relationship: "contradiction",
    category: "findings",
    workATitle: "Paper A",
    claimAText: "Claim A text.",
    workBTitle: "Paper B",
    claimBText: "Claim B text.",
    explanation: "explains the tension",
    resolution: "run a follow-up study",
    ...overrides,
  };
}

describe("buildHypothesisPrompt", () => {
  it("labels conflicts CONFLICT_1, CONFLICT_2, ... in order and maps them to real ids", () => {
    const { prompt, labelToReal } = buildHypothesisPrompt(
      [conflict({ id: "id-a" }), conflict({ id: "id-b" })],
      null,
    );
    expect(prompt).toContain("[CONFLICT_1]");
    expect(prompt).toContain("[CONFLICT_2]");
    expect(labelToReal.get("CONFLICT_1")).toBe("id-a");
    expect(labelToReal.get("CONFLICT_2")).toBe("id-b");
  });

  it("never leaks the real id string into the prompt itself", () => {
    const { prompt } = buildHypothesisPrompt([conflict({ id: "super-secret-real-uuid" })], null);
    expect(prompt).not.toContain("super-secret-real-uuid");
  });

  it("includes a focused question block when a research question is given", () => {
    const { prompt } = buildHypothesisPrompt([conflict()], "What explains the akrasia disagreement?");
    expect(prompt).toContain("What explains the akrasia disagreement?");
  });

  it("includes the no-specific-question fallback block otherwise", () => {
    const { prompt } = buildHypothesisPrompt([conflict()], null);
    expect(prompt).toContain("No specific question given.");
  });

  it("forbids inventing labels and forbids self-assessed novelty/impact fields", () => {
    const { prompt } = buildHypothesisPrompt([conflict()], null);
    expect(prompt).toContain("do not invent labels");
    expect(prompt).toContain("Do NOT include novelty or impact fields");
  });
});

describe("validateHypothesisResponse", () => {
  it("resolves a valid CONFLICT_N label to its real id", () => {
    const labelToReal = new Map([["CONFLICT_1", "real-id-1"]]);
    const result = validateHypothesisResponse(
      [
        {
          statement: "A testable hypothesis.",
          rationale: "because X",
          sourceConflictLabels: ["CONFLICT_1"],
          methodology: "do Y",
          challenges: ["hard to measure"],
        },
      ],
      labelToReal,
    );
    expect(result[0].sourceConflictIds).toEqual(["real-id-1"]);
  });

  it("also resolves a bare numeric reference ('1' -> CONFLICT_1)", () => {
    const labelToReal = new Map([["CONFLICT_1", "real-id-1"]]);
    const result = validateHypothesisResponse(
      [{ statement: "x", sourceConflictLabels: ["1"] }],
      labelToReal,
    );
    expect(result[0].sourceConflictIds).toEqual(["real-id-1"]);
  });

  it("drops a fabricated label that was never supplied", () => {
    const labelToReal = new Map([["CONFLICT_1", "real-id-1"]]);
    const result = validateHypothesisResponse(
      [{ statement: "x", sourceConflictLabels: ["CONFLICT_1", "CONFLICT_99"] }],
      labelToReal,
    );
    expect(result[0].sourceConflictIds).toEqual(["real-id-1"]);
  });

  it("throws when the response is not an array", () => {
    expect(() => validateHypothesisResponse({ not: "array" }, new Map())).toThrow(/must be a JSON array/);
  });

  it("throws when statement is missing or empty", () => {
    expect(() => validateHypothesisResponse([{ statement: "" }], new Map())).toThrow(
      /missing or empty "statement"/,
    );
  });

  it("throws when a forbidden self-assessed novelty field is present", () => {
    expect(() =>
      validateHypothesisResponse([{ statement: "x", novelty: 0.8 }], new Map()),
    ).toThrow(/forbidden self-assessed field "novelty"/);
  });

  it("throws when a forbidden self-assessed impact field is present", () => {
    expect(() =>
      validateHypothesisResponse([{ statement: "x", impactScore: 5 }], new Map()),
    ).toThrow(/forbidden self-assessed field "impactScore"/);
  });

  it("defaults rationale/methodology/challenges when absent", () => {
    const result = validateHypothesisResponse([{ statement: "x" }], new Map());
    expect(result[0].rationale).toBe("");
    expect(result[0].methodology).toBe("");
    expect(result[0].challenges).toEqual([]);
  });

  it("filters non-string entries out of challenges", () => {
    const result = validateHypothesisResponse([{ statement: "x", challenges: ["ok", 42, null] }], new Map());
    expect(result[0].challenges).toEqual(["ok"]);
  });
});
