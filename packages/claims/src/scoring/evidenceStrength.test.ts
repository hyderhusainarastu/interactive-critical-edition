import { describe, expect, it } from "vitest";
import { evidenceGap, scoreEvidenceStrength } from "./evidenceStrength";

// ── Parity cases derived directly from evidence_strength.py's own
// bottom-of-file `if __name__ == "__main__":` self-check block, so this
// port's behavior is checked against the exact same two example texts and
// assertions the Python original checks itself with. ────────────────────

const STRONG_TEXT =
  "A randomized controlled trial (N=312) found a large effect (Cohen's d=0.8, " +
  "p<0.001, 95% CI [0.6, 1.0]) of AI coaching on negotiation surplus.";
const WEAK_TEXT = "A case study suggests AI coaching may improve negotiation outcomes.";

describe("scoreEvidenceStrength — ported self-check parity", () => {
  it("strong text: design=RCT, all 5 quant signals fire, no hedge cap, score clips to 1.0", () => {
    const strong = scoreEvidenceStrength(STRONG_TEXT);
    expect(strong.design).toBe("randomized controlled trial");
    expect(strong.signals).toEqual(
      expect.arrayContaining([
        "randomized controlled trial",
        "p-value",
        "effect size",
        "confidence interval",
        "sample size",
        "reported percentage",
      ]),
    );
    expect(strong.signals).not.toContain("hedged language");
    // designScore 0.9*0.45=0.405 + quant .18+.2+.14+.2+.1=0.82 => raw 1.225, clipped to 1
    expect(strong.score).toBe(1);
    expect(strong.label).toBe("strong");
  });

  it("weak text: design=case study, no quant signals, hedge present but doesn't change already-low score", () => {
    const weak = scoreEvidenceStrength(WEAK_TEXT);
    expect(weak.design).toBe("case study / pilot");
    expect(weak.signals).toEqual(expect.arrayContaining(["case study / pilot", "hedged language"]));
    // designScore 0.2*0.45=0.09, no quant signals, hedge cap min(0.09,0.6)=0.09 (no-op)
    expect(weak.score).toBe(0.09);
    expect(weak.label).toBe("weak");
  });

  it("self-check assertions: strong outscores weak, labels are strong/weak, evidenceGap favors claim_a", () => {
    const strong = scoreEvidenceStrength(STRONG_TEXT);
    const weak = scoreEvidenceStrength(WEAK_TEXT);
    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.label).toBe("strong");
    expect(weak.label).toBe("weak");
    expect(evidenceGap(strong, weak)).toEqual({ gap: 0.91, stronger: "claim_a" });
  });
});

describe("scoreEvidenceStrength — additional coverage", () => {
  it("empty/whitespace-only text scores 0/weak with no design or signals", () => {
    expect(scoreEvidenceStrength("")).toEqual({ score: 0, label: "weak", design: null, signals: [] });
    expect(scoreEvidenceStrength("   ")).toEqual({ score: 0, label: "weak", design: null, signals: [] });
  });

  it("folds evidence/conditions fields into the same scored blob", () => {
    const result = scoreEvidenceStrength("The intervention worked.", { evidence: "p<0.01, N=200" });
    expect(result.signals).toEqual(expect.arrayContaining(["p-value", "sample size"]));
  });

  it("hedging caps an otherwise-strong score down to 0.6, demoting the label", () => {
    // design 1.0*0.45=0.45 (meta-analysis) + quant .18 (p-value) + .2 (N=500) = 0.83 raw,
    // which alone would be "strong" (>=0.66); the hedge word caps it to 0.6 ("moderate").
    const result = scoreEvidenceStrength("A meta-analysis (p<0.001, N=500) suggests a modest effect.");
    expect(result.score).toBe(0.6);
    expect(result.label).toBe("moderate");
    expect(result.signals).toContain("hedged language");
  });

  it("design tiers take the FIRST match in priority order, not the strongest overall keyword", () => {
    // Contains both "meta-analysis" (tier 1, strongest) and "case study" (tier 6, weakest);
    // the array order means meta-analysis wins regardless of position in the text.
    const result = scoreEvidenceStrength("Unlike an earlier case study, this meta-analysis pooled 40 trials.");
    expect(result.design).toBe("meta-analysis / systematic review");
  });

  it("quantitative signals are additive and each counts once even if the pattern could match twice", () => {
    const result = scoreEvidenceStrength("p<0.001 and also p<0.05 were both observed.");
    const pValueCount = result.signals.filter((s) => s === "p-value").length;
    expect(pValueCount).toBe(1);
  });

  it("score never exceeds 1 even when many signals stack", () => {
    const result = scoreEvidenceStrength(
      "A meta-analysis (N=1000, p<0.001, Cohen's d=1.2, 95% CI, SD=0.3, significant, 42%) found a huge effect.",
    );
    expect(result.score).toBeLessThanOrEqual(1);
  });
});

describe("evidenceGap", () => {
  it("treats a gap under 0.1 as a tie (neither side stronger)", () => {
    const a = scoreEvidenceStrength("p<0.001");
    const b = scoreEvidenceStrength("p<0.01");
    const gap = evidenceGap(a, b);
    expect(Math.abs(gap.gap)).toBeLessThan(0.1);
    expect(gap.stronger).toBe("neither");
  });

  it("favors claim_b when b scores higher", () => {
    const strong = scoreEvidenceStrength(STRONG_TEXT);
    const weak = scoreEvidenceStrength(WEAK_TEXT);
    expect(evidenceGap(weak, strong)).toEqual({ gap: -0.91, stronger: "claim_b" });
  });
});
