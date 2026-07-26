import { describe, expect, it } from "vitest";
import { buildClusterNamingPrompt, deterministicFallbackName } from "./clusterNaming";

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
