import { describe, expect, it } from "vitest";
import { buildClaimExtractionPrompt, validateClaimExtraction } from "./claimExtraction";

const BLOCKS = [
  "Aristotle discusses akrasia at length in Book VII, where he states that the incontinent man knows in a way and yet in a way does not know.",
  "This second block has entirely different content about virtue and the mean.",
];

function validItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    text: "Aristotle characterizes the akratic agent as knowing in one sense and not knowing in another.",
    nature: "interpretive",
    section: "Book VII",
    confidence: "high",
    supportingExcerpt: "the incontinent man knows in a way and yet in a way does not know",
    ...overrides,
  };
}

describe("buildClaimExtractionPrompt", () => {
  it("includes the work title and document text", () => {
    const prompt = buildClaimExtractionPrompt({ workTitle: "Nicomachean Ethics", documentText: "some text" });
    expect(prompt).toContain("Work: Nicomachean Ethics");
    expect(prompt).toContain("<document>\nsome text\n</document>");
  });

  it("includes the HARD RULES and both ported empirical BAD/GOOD examples", () => {
    const prompt = buildClaimExtractionPrompt({ workTitle: "X", documentText: "Y" });
    expect(prompt).toContain("HARD RULES");
    expect(prompt).toContain("ACE feedback produced significantly greater deal prices");
    expect(prompt).toContain("Dialogue-annotation-based metrics predicted actual negotiation outcomes");
  });

  it("includes 2 humanities BAD/GOOD pairs naming an interpreter's position and a locus", () => {
    const prompt = buildClaimExtractionPrompt({ workTitle: "X", documentText: "Y" });
    expect(prompt).toContain("Irwin reads Aristotle's account of akrasia at NE 7.3.1147a24-b19");
    expect(prompt).toContain("Cross and Woozley (Republic 509d-511e)");
  });

  it("lists all 8 claim natures", () => {
    const prompt = buildClaimExtractionPrompt({ workTitle: "X", documentText: "Y" });
    for (const nature of [
      "empirical",
      "textual",
      "interpretive",
      "historical",
      "conceptual",
      "normative",
      "definitional",
      "methodological",
    ]) {
      expect(prompt).toContain(nature);
    }
  });

  it("asks for supportingExcerpt grounding and the 1-12 claim bound", () => {
    const prompt = buildClaimExtractionPrompt({ workTitle: "X", documentText: "Y" });
    expect(prompt).toContain("supportingExcerpt");
    expect(prompt).toContain("LITERAL, VERBATIM substring");
    expect(prompt).toMatch(/never fewer than 1, never more than 12/);
  });
});

describe("validateClaimExtraction", () => {
  it("accepts a valid, grounded claim list", () => {
    const result = validateClaimExtraction([validItem()], BLOCKS);
    expect(result).toHaveLength(1);
    expect(result[0].nature).toBe("interpretive");
  });

  it("throws when the response is not an array", () => {
    expect(() => validateClaimExtraction({ not: "an array" }, BLOCKS)).toThrow(/must be a JSON array/);
  });

  it("throws when there are 0 claims", () => {
    expect(() => validateClaimExtraction([], BLOCKS)).toThrow(/must be between 1 and 12/);
  });

  it("throws when there are more than 12 claims", () => {
    const items = Array.from({ length: 13 }, () => validItem());
    expect(() => validateClaimExtraction(items, BLOCKS)).toThrow(/must be between 1 and 12/);
  });

  it("throws on a nature outside the 8-value enum", () => {
    expect(() => validateClaimExtraction([validItem({ nature: "philosophical" })], BLOCKS)).toThrow(/not one of/);
  });

  it("throws on an invalid confidence value", () => {
    expect(() => validateClaimExtraction([validItem({ confidence: "very-high" })], BLOCKS)).toThrow(
      /must be high\/medium\/low/,
    );
  });

  it("throws on missing/empty text", () => {
    expect(() => validateClaimExtraction([validItem({ text: "" })], BLOCKS)).toThrow(/missing or empty "text"/);
    expect(() => validateClaimExtraction([validItem({ text: undefined })], BLOCKS)).toThrow(/missing or empty "text"/);
  });

  it("throws on a supportingExcerpt that is NOT a literal substring of any block (fabricated)", () => {
    expect(() =>
      validateClaimExtraction([validItem({ supportingExcerpt: "this text does not appear anywhere" })], BLOCKS),
    ).toThrow(/likely fabricated/);
  });

  it("accepts a supportingExcerpt found in the SECOND block, not just the first", () => {
    const result = validateClaimExtraction(
      [validItem({ supportingExcerpt: "content about virtue and the mean" })],
      BLOCKS,
    );
    expect(result).toHaveLength(1);
  });

  it("includes the offending index in the error message", () => {
    expect(() => validateClaimExtraction([validItem(), validItem({ nature: "bogus" })], BLOCKS)).toThrow(/Claim 1:/);
  });
});
