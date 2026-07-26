import { describe, expect, it } from "vitest";
import { buildJudgePrompt, buildJudgePromptVariant, validateJudgeResponse, JUDGE_PROMPT_VERSION } from "./judge";

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

  it("does NOT include the decision-tree preamble — the Phase 25.5b variant selection found few-shot alone scored higher on train (0.582 vs 0.540 for the full combination)", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(prompt).not.toContain("DECISION TREE");
    expect(prompt).not.toContain("ORTHOGONAL");
  });

  it("includes the anti-catch-all instruction for nuance", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(prompt).toContain("SPECIFIC boundary condition");
    expect(prompt).toContain("If you cannot name");
  });

  it("includes 4-6 boundary-case few-shot examples from domains outside the gold set", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(prompt).toContain("FEW-SHOT EXAMPLES");
    // Domains not present in relationshipPairs.empirical.json or .humanities.json.
    expect(prompt).toContain("shift workers");
    expect(prompt).toContain("Minimum-wage");
    expect(prompt).not.toContain("Aristotle");
    const exampleCount = (prompt.match(/→ `(nuance|contradiction|support|unrelated)`/g) ?? []).length;
    expect(exampleCount).toBeGreaterThanOrEqual(4);
    expect(exampleCount).toBeLessThanOrEqual(6);
  });

  it("keeps the HARD RULES and JSON-schema instructions unchanged from v1", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(prompt).toContain("HARD RULES FOR THE EXPLANATION FIELD");
    expect(prompt).toContain('Return ONLY valid JSON with these fields');
    expect(prompt).toContain('"strongerEvidence": "paper_a", "paper_b", or "neither"');
    expect(prompt).toContain("No preamble, no markdown fences.");
  });
});

describe("buildJudgePromptVariant — the Phase 25.5b A/B harness's toggle surface", () => {
  it("with includeDecisionTree:true, includes the decision-tree preamble before DECISION GUIDE", () => {
    const prompt = buildJudgePromptVariant(
      { claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" },
      { includeDecisionTree: true, includeAntiCatchAll: true, includeFewShot: true },
    );
    expect(prompt).toContain("DECISION TREE");
    expect(prompt).toContain("ORTHOGONAL");
    expect(prompt).toContain("Step 1");
    expect(prompt).toContain("Step 2");
    expect(prompt).toContain("Step 3");
    expect(prompt.indexOf("DECISION TREE")).toBeLessThan(prompt.indexOf("DECISION GUIDE"));
  });

  it("with includeFewShot:false, omits the few-shot examples block", () => {
    const prompt = buildJudgePromptVariant(
      { claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" },
      { includeDecisionTree: true, includeAntiCatchAll: true, includeFewShot: false },
    );
    expect(prompt).not.toContain("FEW-SHOT EXAMPLES");
  });

  it("with every flag omitted, defaults to all three blocks on (variant C, the 'kitchen sink' combination the harness measured — NOT what buildJudgePrompt ships)", () => {
    const allDefaults = buildJudgePromptVariant({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(allDefaults).toContain("DECISION TREE");
    expect(allDefaults).toContain("FEW-SHOT EXAMPLES");
    expect(allDefaults).toContain("SPECIFIC boundary condition");
  });
});

describe("JUDGE_PROMPT_VERSION", () => {
  it("is bumped to a v2 identifier reflecting the shipped few-shot/anti-catch-all iteration", () => {
    expect(JUDGE_PROMPT_VERSION).not.toBe("v1");
    expect(JUDGE_PROMPT_VERSION).toMatch(/v2/);
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

  it("omits any block for kind=none_detected — the framing text was measured non-neutral (2/10 flips) and is dropped entirely", () => {
    const prompt = buildJudgePrompt({
      claimA: CLAIM_A,
      claimB: CLAIM_B,
      branch: "empirical",
      engagement: { kind: "none_detected" },
    });
    expect(prompt).not.toContain("citation link was found");
    expect(prompt).not.toContain("explicitly cites");
  });

  it("omits any engagement block when none is provided", () => {
    const prompt = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    expect(prompt).not.toContain("citation link was found");
    expect(prompt).not.toContain("explicitly cites");
  });

  it("produces byte-identical output for omitted engagement and kind=none_detected", () => {
    const omitted = buildJudgePrompt({ claimA: CLAIM_A, claimB: CLAIM_B, branch: "empirical" });
    const noneDetected = buildJudgePrompt({
      claimA: CLAIM_A,
      claimB: CLAIM_B,
      branch: "empirical",
      engagement: { kind: "none_detected" },
    });
    expect(noneDetected).toBe(omitted);
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
