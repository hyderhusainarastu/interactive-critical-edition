import { describe, expect, it } from "vitest";
import { buildEvidenceChamberPrompt, EVIDENCE_CHAMBER_MAX_CLAIMS, EVIDENCE_CHAMBER_OUTPUT_SCHEMA, EVIDENCE_CHAMBER_PROMPT_VERSION, matchChamberPositionClaims, validateEvidenceChamberResponse } from "./evidenceChamber";

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

  it("caps the number of claims shown to EVIDENCE_CHAMBER_MAX_CLAIMS, never silently including every claim of an unboundedly large cluster", () => {
    const claims = Array.from({ length: EVIDENCE_CHAMBER_MAX_CLAIMS + 5 }, (_, i) => ({ text: `Claim ${i + 1} text.`, workTitle: `Work ${i + 1}` }));
    const prompt = buildEvidenceChamberPrompt({ clusterName: "Large cluster", claims });
    expect(prompt).toContain(`[Position ${EVIDENCE_CHAMBER_MAX_CLAIMS}]`);
    expect(prompt).not.toContain(`[Position ${EVIDENCE_CHAMBER_MAX_CLAIMS + 1}]`);
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

describe("EVIDENCE_CHAMBER_PROMPT_VERSION / EVIDENCE_CHAMBER_OUTPUT_SCHEMA", () => {
  it("is a non-empty string, never null (a chamber has no deterministic fallback path)", () => {
    expect(typeof EVIDENCE_CHAMBER_PROMPT_VERSION).toBe("string");
    expect(EVIDENCE_CHAMBER_PROMPT_VERSION.length).toBeGreaterThan(0);
  });

  it("the output schema lists every top-level field as required, matching OpenAI's strict json_schema mode", () => {
    expect(EVIDENCE_CHAMBER_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(EVIDENCE_CHAMBER_OUTPUT_SCHEMA.required).toEqual(
      expect.arrayContaining(["question", "sharedGround", "pointOfDivergence", "possibleReconciliation", "unresolvedQuestion", "missingEvidence", "nextAction", "positions"]),
    );
    expect(EVIDENCE_CHAMBER_OUTPUT_SCHEMA.properties.positions.items.additionalProperties).toBe(false);
    expect(EVIDENCE_CHAMBER_OUTPUT_SCHEMA.properties.positions.items.required).toEqual(["label", "summary", "method", "scope", "stanceConfidence"]);
  });
});

describe("matchChamberPositionClaims", () => {
  const claims = [
    { claimId: "claim-a", workTitle: "Irwin's Reading of Akrasia" },
    { claimId: "claim-b", workTitle: "Davidson on Weakness of Will" },
  ];

  it("matches a position to its claim by EXACT (normalized) work-title equality", () => {
    const result = matchChamberPositionClaims(
      [{ label: "Irwin's Reading of Akrasia" }, { label: "Davidson on Weakness of Will" }],
      claims,
    );
    expect(result).toEqual([["claim-a"], ["claim-b"]]);
  });

  it("matches case/punctuation-insensitively (the prompt's own worked example uses a bare author surname)", () => {
    const result = matchChamberPositionClaims([{ label: "irwins reading of akrasia!!" }], claims);
    expect(result).toEqual([["claim-a"]]);
  });

  it("falls back to a SUBSTRING match when no exact match exists", () => {
    const result = matchChamberPositionClaims([{ label: "Irwin" }], claims);
    expect(result).toEqual([["claim-a"]]);
  });

  it("falls back to a best WORD-OVERLAP match when neither exact nor substring matches", () => {
    // "Weakness of Will" shares two whole words with Davidson's work title
    // ("Weakness of Will" -> "on Weakness of Will") and zero with Irwin's.
    const result = matchChamberPositionClaims([{ label: "Weakness of Will, reconsidered" }], claims);
    expect(result).toEqual([["claim-b"]]);
  });

  it("a position can match MULTIPLE claims when several share the same (normalized) work title", () => {
    const twoFromSameWork = [
      { claimId: "claim-a1", workTitle: "Irwin's Reading of Akrasia" },
      { claimId: "claim-a2", workTitle: "Irwin's Reading of Akrasia" },
    ];
    const result = matchChamberPositionClaims([{ label: "Irwin's Reading of Akrasia" }], twoFromSameWork);
    expect(result).toEqual([["claim-a1", "claim-a2"]]);
  });

  it("returns null (never guesses) when a position's label shares no words with ANY claim's work title", () => {
    const result = matchChamberPositionClaims([{ label: "Zzyzx Nonexistent Treatise" }], claims);
    expect(result).toBeNull();
  });

  it("returns null when ANY position (not just the first) is unmatchable, even if earlier ones matched fine", () => {
    const result = matchChamberPositionClaims(
      [{ label: "Irwin's Reading of Akrasia" }, { label: "Completely Unrelated Nonsense" }],
      claims,
    );
    expect(result).toBeNull();
  });

  it("returns null for an empty/whitespace-only label rather than matching arbitrarily", () => {
    expect(matchChamberPositionClaims([{ label: "   " }], claims)).toBeNull();
  });

  it("is index-aligned with the input positions array", () => {
    const result = matchChamberPositionClaims(
      [{ label: "Davidson on Weakness of Will" }, { label: "Irwin's Reading of Akrasia" }],
      claims,
    );
    expect(result).toEqual([["claim-b"], ["claim-a"]]);
  });

  it("handles zero claims by returning null for any non-empty position list", () => {
    expect(matchChamberPositionClaims([{ label: "Anything" }], [])).toBeNull();
  });

  it("handles zero positions by returning an empty array", () => {
    expect(matchChamberPositionClaims([], claims)).toEqual([]);
  });
});
