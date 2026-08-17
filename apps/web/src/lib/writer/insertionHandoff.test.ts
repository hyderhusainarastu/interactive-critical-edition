import { describe, expect, it } from "vitest";
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
describe("isValidWriterInsertionPayload", () => {
  it("accepts a valid payload for the matching project", () => {
    expect(isValidWriterInsertionPayload(VALID, "proj-1")).toBe(true);
  });

  it("mismatched projectId must never be accepted", () => {
    expect(isValidWriterInsertionPayload(VALID, "proj-2")).toBe(false);
  });

  it("rejects null, undefined and non-object payloads", () => {
    expect(isValidWriterInsertionPayload(null, "proj-1")).toBe(false);
    expect(isValidWriterInsertionPayload(undefined, "proj-1")).toBe(false);
    expect(isValidWriterInsertionPayload("not an object", "proj-1")).toBe(false);
  });

  it("non-string quote must be rejected", () => {
    expect(isValidWriterInsertionPayload({ ...VALID, quote: 42 }, "proj-1")).toBe(false);
  });

  it("unknown sourceLabel must be rejected", () => {
    expect(isValidWriterInsertionPayload({ ...VALID, sourceLabel: "Somewhere else" }, "proj-1")).toBe(false);
    expect(isValidWriterInsertionPayload({ ...VALID, sourceLabel: "Knowledge Map" }, "proj-1")).toBe(true);
  });

  it("a missing field must be rejected, not defaulted", () => {
    const { attribution: _omit, ...missingAttribution } = VALID;
    expect(isValidWriterInsertionPayload(missingAttribution, "proj-1")).toBe(false);
  });
});

// --- formatInsertionExcerpt ------------------------------------------------
describe("formatInsertionExcerpt", () => {
  it("formats a quote with its attribution", () => {
    expect(formatInsertionExcerpt({ quote: "Vice is voluntary.", attribution: "claim, Vice and Reason" })).toBe(
      "“Vice is voluntary.” (claim, Vice and Reason)",
    );
  });

  // Trims incidental whitespace on both fields rather than baking it into the
  // inserted draft text verbatim.
  it("trims incidental whitespace on both fields rather than baking it into the inserted draft text", () => {
    expect(formatInsertionExcerpt({ quote: "  padded quote  ", attribution: "  padded attribution  " })).toBe(
      "“padded quote” (padded attribution)",
    );
  });
});
