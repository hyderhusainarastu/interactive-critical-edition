import assert from "node:assert/strict";
import { formatInsertionExcerpt, isValidWriterInsertionPayload } from "./insertionHandoff";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `panelState.test.ts`/`useDocumentBroadcast.test.ts` — apps/web has no
 * vitest/DOM runner wired, so the `sessionStorage`-touching read/write
 * halves of `insertionHandoff.ts` are exercised by the e2e insertion specs
 * instead; only the pure shape-check/formatting logic is unit-tested here).
 */

const VALID = {
  projectId: "proj-1",
  quote: "Vice is a state of character concerned with choice.",
  attribution: "claim, Vice and Reason",
  sourceHref: "/works/w1/reader?annotation=abc",
  sourceLabel: "Reader" as const,
};

// --- isValidWriterInsertionPayload ----------------------------------------
assert.equal(isValidWriterInsertionPayload(VALID, "proj-1"), true);
assert.equal(isValidWriterInsertionPayload(VALID, "proj-2"), false, "mismatched projectId must never be accepted");
assert.equal(isValidWriterInsertionPayload(null, "proj-1"), false);
assert.equal(isValidWriterInsertionPayload(undefined, "proj-1"), false);
assert.equal(isValidWriterInsertionPayload("not an object", "proj-1"), false);
assert.equal(isValidWriterInsertionPayload({ ...VALID, quote: 42 }, "proj-1"), false, "non-string quote must be rejected");
assert.equal(isValidWriterInsertionPayload({ ...VALID, sourceLabel: "Somewhere else" }, "proj-1"), false, "unknown sourceLabel must be rejected");
assert.equal(isValidWriterInsertionPayload({ ...VALID, sourceLabel: "Knowledge Map" }, "proj-1"), true);
const { attribution: _omit, ...missingAttribution } = VALID;
assert.equal(isValidWriterInsertionPayload(missingAttribution, "proj-1"), false, "a missing field must be rejected, not defaulted");

// --- formatInsertionExcerpt ------------------------------------------------
assert.equal(
  formatInsertionExcerpt({ quote: "Vice is voluntary.", attribution: "claim, Vice and Reason" }),
  "“Vice is voluntary.” (claim, Vice and Reason)",
);
// Trims incidental whitespace on both fields rather than baking it into the
// inserted draft text verbatim.
assert.equal(
  formatInsertionExcerpt({ quote: "  padded quote  ", attribution: "  padded attribution  " }),
  "“padded quote” (padded attribution)",
);

console.log("insertionHandoff.test.ts: all assertions passed");
