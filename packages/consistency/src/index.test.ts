import { describe, expect, it } from "vitest";
import { ALL_CHECKS, runAllConsistencyChecks } from "./index";
import { emptySnapshot } from "./snapshot";

describe("runAllConsistencyChecks", () => {
  it("returns an empty report for an empty snapshot", () => {
    expect(runAllConsistencyChecks(emptySnapshot())).toEqual({ mismatches: [], repairs: [] });
  });

  it("runs all 9 checks named in plan §20.7 and aggregates their mismatches", () => {
    expect(ALL_CHECKS).toHaveLength(9);

    const snapshot = {
      ...emptySnapshot(),
      // One mismatch from graph-edge-endpoints...
      graphEdges: [{ id: "e1", sourceType: "work", sourceId: "ghost", targetType: "bibliographic_record", targetId: "b1" }],
      bibliographicRecords: [{ id: "b1", title: "B" }],
      // ...and one from rag-citation-anchor, deliberately from two different checks.
      ragChunks: [{ id: "chunk1", userId: "user-b" }],
      ragConversations: [{ id: "conv1", userId: "user-a" }],
      ragMessages: [{ id: "msg1", conversationId: "conv1" }],
      ragMessageCitations: [{ id: "cite1", messageId: "msg1", chunkId: "chunk1" }],
    };

    const report = runAllConsistencyChecks(snapshot);
    expect(report.mismatches.map((m) => m.checkId).sort()).toEqual(["graph-edge-endpoints", "rag-citation-anchor"]);
    expect(report.repairs).toHaveLength(2);
    // Every repair in the report must exactly be the non-null repair from one of the mismatches.
    for (const repair of report.repairs) {
      expect(report.mismatches.some((m) => m.repair === repair)).toBe(true);
    }
  });

  it("never includes a null repair in the repairs projection", () => {
    const snapshot = {
      ...emptySnapshot(),
      annotations: [{ id: "a1", targetBibId: "ghost", targetLabel: "X" }], // dangling FK -> repair: null
    };
    const report = runAllConsistencyChecks(snapshot);
    expect(report.mismatches).toHaveLength(1);
    expect(report.repairs).toHaveLength(0);
  });
});
