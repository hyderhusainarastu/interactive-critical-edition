import assert from "node:assert/strict";
import { parseAwaitingJudgmentCount } from "./pipelineSteps";

// D-25-15 item 3: the "Continue judging (N pairs remaining)" affordance
// parses this straight out of the worker's own note text — never a
// separately-computed count that could drift from what the worker actually
// left outstanding.
assert.equal(parseAwaitingJudgmentCount(null), 0);
assert.equal(parseAwaitingJudgmentCount(undefined), 0);
assert.equal(parseAwaitingJudgmentCount(""), 0);
assert.equal(parseAwaitingJudgmentCount("no awaiting info here"), 0);
assert.equal(
  parseAwaitingJudgmentCount("channels: dense=3 bm25=2 locus=0 locus_section=0 | candidates: 5 found | judge: judged=2 alreadyJudged=0 failed=0 awaitingJudgment=0"),
  0,
);
assert.equal(
  parseAwaitingJudgmentCount("judge: judged=3 alreadyJudged=1 failed=0 awaitingJudgment=42 (stopped early: cost budget)"),
  42,
);
assert.equal(parseAwaitingJudgmentCount("awaitingJudgment=1"), 1);

console.log("pipelineSteps.test.ts: all assertions passed");
