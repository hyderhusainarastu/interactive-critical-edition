import { describe, expect, it } from "vitest";
import { buildJudgePrompt, validateJudgeResponse } from "./judge";

const CLAIM_A = { text: "ACE feedback produced greater deal prices (p<0.001).", workTitle: "ACE Paper" };
const CLAIM_B = { text: "Dialogue metrics predicted outcomes with r=0.67.", workTitle: "Metrics Paper" };

describe("buildJudgePrompt — empirical branch", () => {
  it("includes both claims and both work titles", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(prompt).toContain("ACE Paper");
    expect(prompt).toContain("Metrics Paper");
    expect(prompt).toContain(CLAIM_A.text);
    expect(prompt).toContain(CLAIM_B.text);
  });

  it("includes the decision guide, HARD RULES, and the ported BAD/GOOD example", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(prompt).toContain("DECISION GUIDE");
    expect(prompt).toContain("HARD RULES FOR THE EXPLANATION FIELD");
    expect(prompt).toContain("Both works demonstrate that automated systems can measure negotiation performance.");
  });

  it("does not include the humanities pre-classification step or a mechanism field", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(prompt).not.toContain("first determine whether the two claims share");
    expect(prompt).not.toContain('"mechanism"');
  });
});

describe("buildJudgePrompt — humanities branch", () => {
  it("adds the pre-classification instruction and the optional mechanism field", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "humanities" });
    expect(prompt).toContain("first determine whether the two claims share the same definitions");
    expect(prompt).toContain('"mechanism" (optional)');
    expect(prompt).toContain("different_definition");
    expect(prompt).toContain("interprets_differently");
    expect(prompt).toContain("different_scope_conditions");
  });
});

describe("buildJudgePrompt — engagement context", () => {
  it("includes the direct-citation framing with the excerpt when provided", () => {
    const prompt = buildJudgePrompt({
      claimA: CLAIM_A,
      claimB: CLAIM_B,
      branch: "empirical",
      engagement: { kind: "direct_citation", excerpt: "as shown in Smith (2020)" },
    });
    expect(prompt).toContain("Work A explicitly cites Work B");
    expect(prompt).toContain("as shown in Smith (2020)");
  });

  it("includes the none-detected framing that forbids assuming either author read the other", () => {
    const prompt = buildJudgePrompt({
      claimA: CLAIM_A,
      claimB: CLAIM_B,
      branch: "empirical",
      engagement: { kind: "none_detected" },
    });
    expect(prompt).toContain("No citation link was found — do not assume either author read the other.");
  });

  it("omits any engagement block when none is provided", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(prompt).not.toContain("citation link was found");
    expect(prompt).not.toContain("explicitly cites");
  });
});

describe("validateJudgeResponse", () => {
  it("accepts a valid empirical-shaped response", () => {
    const result = validateJudgeResponse({
      relationship: "contradiction",
      category: "findings",
      explanation: "specific explanation",
      strongerEvidence: "paper_a",
      resolution: "run a replication",
    });
    expect(result.relationship).toBe("contradiction");
    expect(result.category).toBe("findings");
    expect(result.mechanism).toBeNull();
  });

  it("throws on an invalid relationship", () => {
    expect(() => validateJudgeResponse({ relationship: "agreement", category: "findings" })).toThrow(
      /not a valid valence/,
    );
  });

  it("throws on an invalid category", () => {
    expect(() => validateJudgeResponse({ relationship: "support", category: "vibes" })).toThrow(
      /not a valid category/,
    );
  });

  it("defaults strongerEvidence to 'neither' for anything but paper_a/paper_b", () => {
    const result = validateJudgeResponse({ relationship: "support", category: "findings", strongerEvidence: "bogus" });
    expect(result.strongerEvidence).toBe("neither");
  });

  it("drops a mechanism that doesn't fit the valence to null (never throws, never coerces)", () => {
    const result = validateJudgeResponse({
      relationship: "support", // mechanisms only ever pair with nuance/contradiction
      category: "findings",
      mechanism: "different_definition",
    });
    expect(result.mechanism).toBeNull();
  });

  it("drops a fabricated mechanism string to null", () => {
    const result = validateJudgeResponse({
      relationship: "nuance",
      category: "theoretical",
      mechanism: "secretly_agrees",
    });
    expect(result.mechanism).toBeNull();
  });

  it("keeps a valid stage-2 mechanism paired with an allowed valence", () => {
    const result = validateJudgeResponse({
      relationship: "nuance",
      category: "theoretical",
      mechanism: "different_scope_conditions",
    });
    expect(result.mechanism).toBe("different_scope_conditions");
  });

  it("defaults explanation/resolution to empty strings rather than throwing when absent", () => {
    const result = validateJudgeResponse({ relationship: "unrelated", category: "scope" });
    expect(result.explanation).toBe("");
    expect(result.resolution).toBe("");
  });
});
