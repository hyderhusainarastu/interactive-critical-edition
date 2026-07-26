import { describe, expect, it } from "vitest";
import { MIN_SIGNAL_FLOOR, scoreBothDimensions } from "./dimensions";

describe("scoreBothDimensions", () => {
  it("returns both dimensions when both scorers find at least one signal", () => {
    const result = scoreBothDimensions(
      "A randomized controlled trial (N=100) found the effect at NE 7.8 was contra Irwin's reading.",
    );
    const dimensions = result.map((r) => r.dimension).sort();
    expect(dimensions).toEqual(["evidence_strength", "textual_support"]);
  });

  it("drops a dimension entirely when it finds zero signals — never returns a fabricated 0 score", () => {
    // Empirical-shaped text: evidence_strength should find signals, textual_support should not.
    const result = scoreBothDimensions("A randomized controlled trial (N=100, p<0.001) found a large effect.");
    expect(result).toHaveLength(1);
    expect(result[0].dimension).toBe("evidence_strength");
  });

  it("returns an empty array when neither scorer finds any signal", () => {
    const result = scoreBothDimensions("This is a plain sentence with no evidentiary cues of any kind.");
    expect(result).toEqual([]);
  });

  it("unifies EvidenceStrength.design and TextualSupport.mode under one `tier` field", () => {
    const result = scoreBothDimensions("A meta-analysis pooled the trials, discussed further at NE 7.8.");
    const evidence = result.find((r) => r.dimension === "evidence_strength");
    const textual = result.find((r) => r.dimension === "textual_support");
    expect(evidence?.tier).toBe("meta-analysis / systematic review");
    expect(textual?.tier).toBe("classical locus citation");
  });

  it("MIN_SIGNAL_FLOOR is 1", () => {
    expect(MIN_SIGNAL_FLOOR).toBe(1);
  });

  it("empty text returns an empty array (both scorers report zero signals)", () => {
    expect(scoreBothDimensions("")).toEqual([]);
  });
});
