import { describe, expect, it } from "vitest";
import {
  buildEvidenceChamberPrompt,
  EVIDENCE_CHAMBER_MAX_CLAIMS,
  EVIDENCE_CHAMBER_MIN_SURVIVING_POSITIONS,
  EVIDENCE_CHAMBER_OUTPUT_SCHEMA,
  EVIDENCE_CHAMBER_PROMPT_VERSION,
  validateEvidenceChamberResponse,
} from "./evidenceChamber";

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
      { label: "Incomplete Practical Syllogism", summary: "Incomplete syllogism.", method: "textual", scope: "NE 7.3", stanceConfidence: "high", claimLabels: ["CLAIM_1", "CLAIM_2"] },
      { label: "Corrupt Rational Endorsement", summary: "Weakness of will.", method: "philosophical", scope: "general akrasia", stanceConfidence: "medium", claimLabels: ["CLAIM_3", "CLAIM_4"] },
    ],
    ...overrides,
  };
}

/** Standard 4-claim label map matching `validPayload()`'s two positions
 *  above (2 claims each) — the fixture most tests reuse. */
function standardLabelMap(): Map<string, string> {
  return new Map([
    ["CLAIM_1", "claim-1"],
    ["CLAIM_2", "claim-2"],
    ["CLAIM_3", "claim-3"],
    ["CLAIM_4", "claim-4"],
  ]);
}

describe("buildEvidenceChamberPrompt", () => {
  it("includes the cluster name and each claim as a labeled CLAIM_N entry", () => {
    const { prompt, labelToClaimId } = buildEvidenceChamberPrompt({
      clusterName: "Akrasia debate",
      claims: [
        { id: "claim-a", text: "Claim 1 text.", workTitle: "Work A" },
        { id: "claim-b", text: "Claim 2 text.", workTitle: "Work B" },
      ],
    });
    expect(prompt).toContain('cluster named "Akrasia debate"');
    expect(prompt).toContain("[CLAIM_1] Work A: Claim 1 text.");
    expect(prompt).toContain("[CLAIM_2] Work B: Claim 2 text.");
    expect(labelToClaimId.get("CLAIM_1")).toBe("claim-a");
    expect(labelToClaimId.get("CLAIM_2")).toBe("claim-b");
  });

  it("caps the number of claims shown to EVIDENCE_CHAMBER_MAX_CLAIMS, never silently including every claim of an unboundedly large cluster", () => {
    const claims = Array.from({ length: EVIDENCE_CHAMBER_MAX_CLAIMS + 5 }, (_, i) => ({ id: `claim-${i + 1}`, text: `Claim ${i + 1} text.`, workTitle: `Work ${i + 1}` }));
    const { prompt, labelToClaimId } = buildEvidenceChamberPrompt({ clusterName: "Large cluster", claims });
    expect(prompt).toContain(`[CLAIM_${EVIDENCE_CHAMBER_MAX_CLAIMS}]`);
    expect(prompt).not.toContain(`[CLAIM_${EVIDENCE_CHAMBER_MAX_CLAIMS + 1}]`);
    expect(labelToClaimId.size).toBe(EVIDENCE_CHAMBER_MAX_CLAIMS);
    expect(labelToClaimId.has(`CLAIM_${EVIDENCE_CHAMBER_MAX_CLAIMS + 1}`)).toBe(false);
  });

  it("explicitly forbids declaring a winner and forbids winner-like field names", () => {
    const { prompt } = buildEvidenceChamberPrompt({ clusterName: "X", claims: [] });
    expect(prompt).toContain("Do not declare a winner");
    expect(prompt).toContain("'winner', 'verdict', 'stronger', 'prevail', or 'rank'");
  });

  it("asks for every required field including claimLabels, and instructs never inventing a label", () => {
    const { prompt } = buildEvidenceChamberPrompt({ clusterName: "X", claims: [] });
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
      "claimLabels",
    ]) {
      expect(prompt).toContain(field);
    }
    expect(prompt).toContain("never invent one");
  });

  it("returns an empty labelToClaimId map for zero claims (the instructional example's own '[CLAIM_1]' text is not a real claim entry)", () => {
    const { labelToClaimId } = buildEvidenceChamberPrompt({ clusterName: "X", claims: [] });
    expect(labelToClaimId.size).toBe(0);
  });
});

describe("validateEvidenceChamberResponse", () => {
  it("accepts a well-formed, neutral response and resolves claimLabels to claimIds via the map", () => {
    const result = validateEvidenceChamberResponse(validPayload(), standardLabelMap());
    expect(result.positions).toHaveLength(2);
    expect(result.positions[0].label).toBe("Incomplete Practical Syllogism");
    expect(result.positions[0].claimIds).toEqual(["claim-1", "claim-2"]);
    expect(result.positions[1].claimIds).toEqual(["claim-3", "claim-4"]);
  });

  it("throws when a top-level key looks like a ranking/verdict field (e.g. 'winner')", () => {
    expect(() => validateEvidenceChamberResponse(validPayload({ winner: "Irwin" }), standardLabelMap())).toThrow(
      /forbidden ranking-like key/,
    );
  });

  it("throws for each forbidden pattern: verdict, stronger, prevail, rank", () => {
    for (const key of ["verdict", "strongerPosition", "prevailingView", "overallRank"]) {
      expect(() => validateEvidenceChamberResponse(validPayload({ [key]: "x" }), standardLabelMap())).toThrow(
        /forbidden ranking-like key/,
      );
    }
  });

  it("throws when a forbidden key is nested INSIDE a position, not just at the top level", () => {
    const payload = validPayload();
    (payload.positions[0] as Record<string, unknown>).stronger = true;
    expect(() => validateEvidenceChamberResponse(payload, standardLabelMap())).toThrow(/forbidden ranking-like key "stronger"/);
  });

  it("throws when a forbidden key is nested arbitrarily deep (recursive rejection)", () => {
    const payload = validPayload({ meta: { nested: { deeply: { verdictOfSorts: "x" } } } });
    expect(() => validateEvidenceChamberResponse(payload, standardLabelMap())).toThrow(/forbidden ranking-like key "verdictOfSorts"/);
  });

  it("is case-insensitive on the forbidden-key match", () => {
    expect(() => validateEvidenceChamberResponse(validPayload({ WINNER: "x" }), standardLabelMap())).toThrow(
      /forbidden ranking-like key/,
    );
  });

  it("the forbidden-key check runs even with the default (empty) map, before any label resolution", () => {
    expect(() => validateEvidenceChamberResponse(validPayload({ winner: "x" }))).toThrow(/forbidden ranking-like key/);
  });

  it("throws when a required string field is missing", () => {
    const payload = validPayload();
    delete (payload as Record<string, unknown>).sharedGround;
    expect(() => validateEvidenceChamberResponse(payload, standardLabelMap())).toThrow(/missing\/invalid string field "sharedGround"/);
  });

  it("throws when positions is not an array", () => {
    expect(() => validateEvidenceChamberResponse(validPayload({ positions: "not an array" }), standardLabelMap())).toThrow(
      /"positions" must be an array/,
    );
  });

  it("throws when a position has an invalid stanceConfidence", () => {
    const payload = validPayload();
    (payload.positions[0] as Record<string, unknown>).stanceConfidence = "very-high";
    expect(() => validateEvidenceChamberResponse(payload, standardLabelMap())).toThrow(/stanceConfidence" must be high\/medium\/low/);
  });

  it("throws when a position is missing a required string field", () => {
    const payload = validPayload();
    delete (payload.positions[0] as Record<string, unknown>).method;
    expect(() => validateEvidenceChamberResponse(payload, standardLabelMap())).toThrow(/position 0: missing\/invalid string field "method"/);
  });

  it('throws when a position\'s "claimLabels" is not an array', () => {
    const payload = validPayload();
    (payload.positions[0] as Record<string, unknown>).claimLabels = "CLAIM_1";
    expect(() => validateEvidenceChamberResponse(payload, standardLabelMap())).toThrow(/position 0: "claimLabels" must be an array/);
  });

  // -------------------------------------------------------------------------
  // Label round-trip.
  // -------------------------------------------------------------------------

  it("label round-trip: buildEvidenceChamberPrompt's own labelToClaimId map resolves validateEvidenceChamberResponse's claimLabels end to end", () => {
    const { labelToClaimId } = buildEvidenceChamberPrompt({
      clusterName: "Akrasia debate",
      claims: [
        { id: "real-claim-a", text: "A", workTitle: "Work A" },
        { id: "real-claim-b", text: "B", workTitle: "Work B" },
        { id: "real-claim-c", text: "C", workTitle: "Work C" },
        { id: "real-claim-d", text: "D", workTitle: "Work D" },
      ],
    });
    const result = validateEvidenceChamberResponse(validPayload(), labelToClaimId);
    expect(result.positions[0].claimIds).toEqual(["real-claim-a", "real-claim-b"]);
    expect(result.positions[1].claimIds).toEqual(["real-claim-c", "real-claim-d"]);
  });

  it("deduplicates a claim cited twice under the same label within one position, without treating it as fabricated", () => {
    const payload = validPayload({
      positions: [{ label: "X", summary: "s", method: "m", scope: "sc", stanceConfidence: "high", claimLabels: ["CLAIM_1", "CLAIM_1", "CLAIM_2"] }],
    });
    // Only one position provided — pad with a second valid one so the
    // overall response still clears the min-surviving-positions floor.
    (payload.positions as unknown[]).push({ label: "Y", summary: "s", method: "m", scope: "sc", stanceConfidence: "low", claimLabels: ["CLAIM_3"] });
    const result = validateEvidenceChamberResponse(payload, standardLabelMap());
    expect(result.positions[0].claimIds).toEqual(["claim-1", "claim-2"]);
  });

  // -------------------------------------------------------------------------
  // Fabricated-label drop.
  // -------------------------------------------------------------------------

  it("drops a fabricated claim label (one that doesn't resolve via the map) but keeps the position when a valid label remains", () => {
    const payload = validPayload({
      positions: [
        { label: "X", summary: "s", method: "m", scope: "sc", stanceConfidence: "high", claimLabels: ["CLAIM_1", "CLAIM_99"] },
        { label: "Y", summary: "s", method: "m", scope: "sc", stanceConfidence: "low", claimLabels: ["CLAIM_3"] },
      ],
    });
    const result = validateEvidenceChamberResponse(payload, standardLabelMap());
    expect(result.positions).toHaveLength(2);
    expect(result.positions[0].claimIds).toEqual(["claim-1"]); // CLAIM_99 silently dropped, not fabricated onto the output
  });

  it("never fabricates: a non-string entry in claimLabels is dropped, not coerced", () => {
    const payload = validPayload({
      positions: [
        { label: "X", summary: "s", method: "m", scope: "sc", stanceConfidence: "high", claimLabels: ["CLAIM_1", 42, null] },
        { label: "Y", summary: "s", method: "m", scope: "sc", stanceConfidence: "low", claimLabels: ["CLAIM_3"] },
      ],
    });
    const result = validateEvidenceChamberResponse(payload, standardLabelMap());
    expect(result.positions[0].claimIds).toEqual(["claim-1"]);
  });

  // -------------------------------------------------------------------------
  // Position drop (zero valid claims after dropping fabricated labels).
  // -------------------------------------------------------------------------

  it("drops an entire position whose every claimLabel is fabricated, while keeping other valid positions (>= 2 survive)", () => {
    const payload = validPayload({
      positions: [
        { label: "Ungrounded", summary: "s", method: "m", scope: "sc", stanceConfidence: "high", claimLabels: ["CLAIM_97", "CLAIM_98"] },
        { label: "Grounded A", summary: "s", method: "m", scope: "sc", stanceConfidence: "medium", claimLabels: ["CLAIM_1"] },
        { label: "Grounded B", summary: "s", method: "m", scope: "sc", stanceConfidence: "low", claimLabels: ["CLAIM_2"] },
      ],
    });
    const result = validateEvidenceChamberResponse(payload, standardLabelMap());
    expect(result.positions).toHaveLength(2);
    expect(result.positions.map((p) => p.label)).toEqual(["Grounded A", "Grounded B"]);
  });

  it("drops a position with an empty claimLabels array outright (nothing to resolve)", () => {
    const payload = validPayload({
      positions: [
        { label: "Empty", summary: "s", method: "m", scope: "sc", stanceConfidence: "high", claimLabels: [] },
        { label: "Grounded A", summary: "s", method: "m", scope: "sc", stanceConfidence: "medium", claimLabels: ["CLAIM_1"] },
        { label: "Grounded B", summary: "s", method: "m", scope: "sc", stanceConfidence: "low", claimLabels: ["CLAIM_2"] },
      ],
    });
    const result = validateEvidenceChamberResponse(payload, standardLabelMap());
    expect(result.positions).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Fewer than EVIDENCE_CHAMBER_MIN_SURVIVING_POSITIONS survive -> whole
  // response fails (retry -> skip), never persisted partial.
  // -------------------------------------------------------------------------

  it("throws (fails the whole response) when fewer than 2 positions survive after dropping ungrounded ones", () => {
    const payload = validPayload({
      positions: [
        { label: "Grounded", summary: "s", method: "m", scope: "sc", stanceConfidence: "high", claimLabels: ["CLAIM_1"] },
        { label: "Ungrounded", summary: "s", method: "m", scope: "sc", stanceConfidence: "low", claimLabels: ["CLAIM_99"] },
      ],
    });
    expect(() => validateEvidenceChamberResponse(payload, standardLabelMap())).toThrow(
      /only 1 valid position\(s\).*needs at least 2/,
    );
  });

  it("throws when every single position is entirely fabricated (0 survive)", () => {
    const payload = validPayload({
      positions: [
        { label: "A", summary: "s", method: "m", scope: "sc", stanceConfidence: "high", claimLabels: ["CLAIM_97"] },
        { label: "B", summary: "s", method: "m", scope: "sc", stanceConfidence: "low", claimLabels: ["CLAIM_98"] },
      ],
    });
    expect(() => validateEvidenceChamberResponse(payload, standardLabelMap())).toThrow(/only 0 valid position\(s\)/);
  });

  it("throws when positions is a valid empty array (0 positions, well below the floor)", () => {
    expect(() => validateEvidenceChamberResponse(validPayload({ positions: [] }), standardLabelMap())).toThrow(
      /only 0 valid position\(s\)/,
    );
  });

  it("accepts exactly EVIDENCE_CHAMBER_MIN_SURVIVING_POSITIONS surviving positions (the floor itself, not just above it)", () => {
    const payload = validPayload({
      positions: [
        { label: "A", summary: "s", method: "m", scope: "sc", stanceConfidence: "high", claimLabels: ["CLAIM_1"] },
        { label: "B", summary: "s", method: "m", scope: "sc", stanceConfidence: "low", claimLabels: ["CLAIM_2"] },
      ],
    });
    const result = validateEvidenceChamberResponse(payload, standardLabelMap());
    expect(result.positions).toHaveLength(EVIDENCE_CHAMBER_MIN_SURVIVING_POSITIONS);
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
    expect(EVIDENCE_CHAMBER_OUTPUT_SCHEMA.properties.positions.items.required).toEqual(["label", "summary", "method", "scope", "stanceConfidence", "claimLabels"]);
  });

  it("the schema's claimLabels property is an array of strings", () => {
    expect(EVIDENCE_CHAMBER_OUTPUT_SCHEMA.properties.positions.items.properties.claimLabels).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });
});
