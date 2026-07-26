import { describe, expect, it } from "vitest";
import { scoreTextualSupport } from "./textualSupport";

describe("scoreTextualSupport", () => {
  it("empty/whitespace-only text scores 0/weak with no mode or signals", () => {
    expect(scoreTextualSupport("")).toEqual({ score: 0, label: "weak", mode: null, signals: [] });
    expect(scoreTextualSupport("   ")).toEqual({ score: 0, label: "weak", mode: null, signals: [] });
  });

  it("a direct quotation is the strongest mode and wins over a locus citation present in the same claim", () => {
    const result = scoreTextualSupport(
      'At NE 1151a20, Aristotle writes: "the incontinent man knows in a way and yet in a way does not know."',
    );
    expect(result.mode).toBe("direct primary-text quotation");
    // modeScore 1.0*0.45=0.45
    expect(result.score).toBe(0.45);
    expect(result.label).toBe("moderate");
  });

  it("multiple independent loci outrank a single locus citation", () => {
    const single = scoreTextualSupport("This is discussed at NE 7.8.");
    const multiple = scoreTextualSupport("Compare NE 7.8 with the earlier treatment at 1145a15.");
    expect(single.mode).toBe("classical locus citation");
    expect(multiple.mode).toBe("multiple independent loci (breadth)");
    expect(multiple.score).toBeGreaterThan(single.score);
  });

  it("recognizes a Bekker-style locus", () => {
    const result = scoreTextualSupport("The passage at 1151a20-8 is central to this reading.");
    expect(result.mode).toBe("classical locus citation");
    // modeScore 0.6*0.45=0.27
    expect(result.score).toBe(0.27);
  });

  it("recognizes a Stephanus-style locus", () => {
    const result = scoreTextualSupport("This is treated at 521d in the Republic.");
    expect(result.mode).toBe("classical locus citation");
  });

  it("recognizes a book.chapter locus", () => {
    const result = scoreTextualSupport("See the discussion at NE 7.8 for the standard account.");
    expect(result.mode).toBe("classical locus citation");
  });

  it("engagement with a rival reading is recognized as a mode when no quotation/locus is present", () => {
    const result = scoreTextualSupport("Contra Irwin's reading, the agent's judgment is never fully formed.");
    expect(result.mode).toBe("engagement with rival readings");
    // modeScore 0.5*0.45=0.225
    expect(result.score).toBe(0.225);
  });

  it('an "as X argues" rival-reading pattern is recognized', () => {
    const result = scoreTextualSupport("As Nussbaum argues, the tragic dimension is irreducible.");
    expect(result.mode).toBe("engagement with rival readings");
  });

  it("original-language evidence (Greek) is an additive booster on top of any mode", () => {
    const withoutGreek = scoreTextualSupport("This is discussed at NE 7.8.");
    const withGreek = scoreTextualSupport("This is discussed at NE 7.8, where ἀκρασία is the key term.");
    expect(withGreek.signals).toContain("original-language evidence");
    expect(withGreek.score).toBeGreaterThan(withoutGreek.score);
    expect(withGreek.mode).toBe(withoutGreek.mode); // mode unaffected, only the additive boost changes
  });

  it("apparatus support (footnote markers) is an additive booster", () => {
    const result = scoreTextualSupport("This reading is defended at NE 7.8 (cf. n. 12 for the counter-argument).");
    expect(result.signals).toContain("apparatus support (footnote/cf.)");
  });

  it("rival-reading engagement still contributes additively when a stronger mode (locus) already won", () => {
    const result = scoreTextualSupport("Contra Irwin, the passage at NE 7.8 supports a different reading.");
    expect(result.mode).toBe("classical locus citation");
    expect(result.signals).toContain("engagement with rival readings");
    // The additive rival-reading signal should appear only once, not duplicated with the mode name.
    const rivalCount = result.signals.filter((s) => s === "engagement with rival readings").length;
    expect(rivalCount).toBe(1);
  });

  it("a claim with none of the six signals present scores 0/weak with no mode", () => {
    const result = scoreTextualSupport("This is a claim about the text with no citation or quotation at all.");
    expect(result.mode).toBeNull();
    expect(result.score).toBe(0);
    expect(result.label).toBe("weak");
    expect(result.signals).toEqual([]);
  });

  it("score never exceeds 1 even when every signal stacks", () => {
    const result = scoreTextualSupport(
      'Contra Irwin, at NE 7.8.1151a20 and again at 1145a15 Aristotle states: ' +
        '"the incontinent agent knows and does not know" (cf. n. 4), where ἀκρασία names the state.',
    );
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("label cutoffs match evidenceStrength's (0.66 strong / 0.33 moderate)", () => {
    // quotation alone = 0.45 -> moderate (>=0.33, <0.66)
    const moderate = scoreTextualSupport('He writes: "this passage is long enough to count as a real quotation."');
    expect(moderate.label).toBe("moderate");
    // quotation + Greek + apparatus stacks above 0.66 -> strong
    const strong = scoreTextualSupport(
      'He writes: "this passage is long enough to count as a real quotation" (cf. n. 2), using ἀρετή throughout.',
    );
    expect(strong.score).toBeGreaterThanOrEqual(0.66);
    expect(strong.label).toBe("strong");
  });
});
