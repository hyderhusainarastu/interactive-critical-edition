import { describe, expect, it } from "vitest";
import { parseAwaitingJudgmentCount } from "./pipelineSteps";

describe("parseAwaitingJudgmentCount", () => {
  // D-25-15 item 3: the "Continue judging (N pairs remaining)" affordance
  // parses this straight out of the worker's own note text — never a
  // separately-computed count that could drift from what the worker actually
  // left outstanding.
  it("parses the remaining-pairs count straight out of the worker's own note text", () => {
    expect(parseAwaitingJudgmentCount(null)).toBe(0);
    expect(parseAwaitingJudgmentCount(undefined)).toBe(0);
    expect(parseAwaitingJudgmentCount("")).toBe(0);
    expect(parseAwaitingJudgmentCount("no awaiting info here")).toBe(0);
    expect(
      parseAwaitingJudgmentCount("channels: dense=3 bm25=2 locus=0 locus_section=0 | candidates: 5 found | judge: judged=2 alreadyJudged=0 failed=0 awaitingJudgment=0"),
    ).toBe(0);
    expect(
      parseAwaitingJudgmentCount("judge: judged=3 alreadyJudged=1 failed=0 awaitingJudgment=42 (stopped early: cost budget)"),
    ).toBe(42);
    expect(parseAwaitingJudgmentCount("awaitingJudgment=1")).toBe(1);
  });
});
