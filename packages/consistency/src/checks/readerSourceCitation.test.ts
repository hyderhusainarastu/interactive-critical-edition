import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../snapshot";
import { checkReaderSourceCitation } from "./readerSourceCitation";

describe("checkReaderSourceCitation", () => {
  it("reports nothing when processing_run_id already agrees with the text_block's own run", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: "r1", textBlockId: "tb1", resolvedBibId: null }],
      textBlocks: [{ id: "tb1", pageId: "p1" }],
      pages: [{ id: "p1", runId: "r1" }],
    };
    expect(checkReaderSourceCitation(snapshot)).toEqual([]);
  });

  it("detects and repairs a null processing_run_id by backfilling from the text_block chain", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: null, textBlockId: "tb1", resolvedBibId: null }],
      textBlocks: [{ id: "tb1", pageId: "p1" }],
      pages: [{ id: "p1", runId: "r1" }],
    };
    const mismatches = checkReaderSourceCitation(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toEqual({
      kind: "update",
      table: "citation",
      id: "c1",
      patch: { processingRunId: "r1" },
      reason: expect.any(String),
    });
  });

  it("detects and repairs a stale processing_run_id that disagrees with the text_block chain", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: "stale-run", textBlockId: "tb1", resolvedBibId: null }],
      textBlocks: [{ id: "tb1", pageId: "p1" }],
      pages: [{ id: "p1", runId: "current-run" }],
    };
    const mismatches = checkReaderSourceCitation(snapshot);
    expect(mismatches).toHaveLength(1);
    expect((mismatches[0].repair as unknown as { patch: { processingRunId: string } }).patch.processingRunId).toBe("current-run");
  });

  it("ignores a citation with no text_block_id (whole-document / unanchored citation)", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: null, textBlockId: null, resolvedBibId: null }],
    };
    expect(checkReaderSourceCitation(snapshot)).toEqual([]);
  });

  it("reports (never guesses) a text_block_id pointing at a page whose run no longer exists", () => {
    const snapshot = {
      ...emptySnapshot(),
      citations: [{ id: "c1", documentId: "d1", processingRunId: "r1", textBlockId: "tb1", resolvedBibId: null }],
      textBlocks: [{ id: "tb1", pageId: "p1" }],
    };
    const mismatches = checkReaderSourceCitation(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe("critical");
    expect(mismatches[0].repair).toBeNull();
  });
});
