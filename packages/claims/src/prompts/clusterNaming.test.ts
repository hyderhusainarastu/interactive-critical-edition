import { describe, expect, it } from "vitest";
import {
  CLUSTER_NAMING_OUTPUT_SCHEMA,
  buildClusterNamingPrompt,
  deterministicFallbackName,
  validateClusterNamingResponse,
} from "./clusterNaming";

describe("buildClusterNamingPrompt", () => {
  it("formats each claim as a bullet", () => {
    const prompt = buildClusterNamingPrompt({ claimTexts: ["Claim one.", "Claim two."] });
    expect(prompt).toContain("- Claim one.");
    expect(prompt).toContain("- Claim two.");
  });

  it("samples to at most the first 6 claims", () => {
    const claimTexts = Array.from({ length: 10 }, (_, i) => `Claim ${i}.`);
    const prompt = buildClusterNamingPrompt({ claimTexts });
    expect(prompt).toContain("Claim 5.");
    expect(prompt).not.toContain("Claim 6.");
    expect(prompt).not.toContain("Claim 9.");
  });

  it("asks for name/researchQuestion/description fields", () => {
    const prompt = buildClusterNamingPrompt({ claimTexts: ["x"] });
    expect(prompt).toContain('"name"');
    expect(prompt).toContain('"researchQuestion"');
    expect(prompt).toContain('"description"');
  });
});

describe("deterministicFallbackName", () => {
  it('prefixes with "Debate: " and the first six words of the first claim', () => {
    const name = deterministicFallbackName(["The akratic agent knows and does not know at the same time in different ways."]);
    expect(name).toBe("Debate: The akratic agent knows and does");
  });

  it("uses fewer than six words when the claim is shorter", () => {
    expect(deterministicFallbackName(["Short claim here."])).toBe("Debate: Short claim here.");
  });

  it('falls back to plain "Debate" for an empty claim list', () => {
    expect(deterministicFallbackName([])).toBe("Debate");
  });

  it('falls back to plain "Debate" for a whitespace-only first claim', () => {
    expect(deterministicFallbackName(["   "])).toBe("Debate");
  });
});

describe("CLUSTER_NAMING_OUTPUT_SCHEMA", () => {
  it("requires every declared property (OpenAI strict-mode contract)", () => {
    expect([...CLUSTER_NAMING_OUTPUT_SCHEMA.required].sort()).toEqual(
      Object.keys(CLUSTER_NAMING_OUTPUT_SCHEMA.properties).sort(),
    );
    expect(CLUSTER_NAMING_OUTPUT_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("validateClusterNamingResponse", () => {
  it("accepts a full valid response", () => {
    const result = validateClusterNamingResponse({
      name: "Akrasia and Practical Knowledge",
      researchQuestion: "Does the akratic agent know what they are doing?",
      description: "Two readings of NE 7 disagree on whether akrasia involves ignorance.",
    });
    expect(result).toEqual({
      name: "Akrasia and Practical Knowledge",
      researchQuestion: "Does the akratic agent know what they are doing?",
      description: "Two readings of NE 7 disagree on whether akrasia involves ignorance.",
    });
  });

  it("normalizes null/missing researchQuestion and description to null", () => {
    const result = validateClusterNamingResponse({ name: "A Debate", researchQuestion: null, description: null });
    expect(result.researchQuestion).toBeNull();
    expect(result.description).toBeNull();
  });

  it("throws on a missing name", () => {
    expect(() => validateClusterNamingResponse({ researchQuestion: null, description: null })).toThrow(/name/i);
  });

  it("throws on an empty/whitespace-only name", () => {
    expect(() => validateClusterNamingResponse({ name: "   ", researchQuestion: null, description: null })).toThrow(/name/i);
  });

  it("trims whitespace from every field", () => {
    const result = validateClusterNamingResponse({
      name: "  A Debate  ",
      researchQuestion: "  A question?  ",
      description: "  A description.  ",
    });
    expect(result).toEqual({ name: "A Debate", researchQuestion: "A question?", description: "A description." });
  });
});
