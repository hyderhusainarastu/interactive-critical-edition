import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../snapshot";
import { checkGraphEdgeEndpoints } from "./graphEdgeEndpoints";

describe("checkGraphEdgeEndpoints", () => {
  it("reports nothing when both endpoints exist", () => {
    const snapshot = {
      ...emptySnapshot(),
      works: [{ id: "w1", title: "T", authorName: null, workIdentityId: null, deletedAt: null }],
      bibliographicRecords: [{ id: "b1", title: "B" }],
      graphEdges: [{ id: "e1", sourceType: "work", sourceId: "w1", targetType: "bibliographic_record", targetId: "b1" }],
    };
    expect(checkGraphEdgeEndpoints(snapshot)).toEqual([]);
  });

  it("detects and repairs (deletes) an edge whose source work no longer exists", () => {
    const snapshot = {
      ...emptySnapshot(),
      bibliographicRecords: [{ id: "b1", title: "B" }],
      graphEdges: [{ id: "e1", sourceType: "work", sourceId: "ghost-work", targetType: "bibliographic_record", targetId: "b1" }],
    };
    const mismatches = checkGraphEdgeEndpoints(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe("critical");
    expect(mismatches[0].repair).toEqual({ kind: "delete", table: "graph_edge", id: "e1", reason: expect.any(String) });
  });

  it("detects a dangling target concept and reports the target side", () => {
    const snapshot = {
      ...emptySnapshot(),
      works: [{ id: "w1", title: "T", authorName: null, workIdentityId: null, deletedAt: null }],
      conceptIds: ["c1"],
      graphEdges: [{ id: "e1", sourceType: "work", sourceId: "w1", targetType: "concept", targetId: "ghost-concept" }],
    };
    const mismatches = checkGraphEdgeEndpoints(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].description).toContain("target");
  });

  it("reports (info, never deletes) an edge with an out-of-vocabulary node type instead of assuming it's dangling", () => {
    const snapshot = {
      ...emptySnapshot(),
      works: [{ id: "w1", title: "T", authorName: null, workIdentityId: null, deletedAt: null }],
      graphEdges: [{ id: "e1", sourceType: "work", sourceId: "w1", targetType: "future_node_type", targetId: "x" }],
    };
    const mismatches = checkGraphEdgeEndpoints(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].severity).toBe("info");
    expect(mismatches[0].repair).toBeNull();
  });
});
