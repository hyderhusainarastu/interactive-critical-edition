import { describe, expect, it } from "vitest";
import { emptySnapshot } from "../snapshot";
import { checkGraphNodeCanonicalEntity } from "./graphNodeCanonicalEntity";

describe("checkGraphNodeCanonicalEntity", () => {
  it("reports nothing when no graph-attached work's identity is stale", () => {
    const snapshot = {
      ...emptySnapshot(),
      works: [{ id: "w1", title: "T", authorName: null, workIdentityId: "wi1", deletedAt: null }],
      graphEdges: [{ id: "e1", sourceType: "work", sourceId: "w1", targetType: "bibliographic_record", targetId: "b1" }],
    };
    expect(checkGraphNodeCanonicalEntity(snapshot)).toEqual([]);
  });

  it("flags (info-only, never repaired) a graph-attached work whose identity was merged away", () => {
    const snapshot = {
      ...emptySnapshot(),
      works: [{ id: "w1", title: "T", authorName: null, workIdentityId: "loser", deletedAt: null }],
      workIdentityMerges: [{ loserIdentityId: "loser", winnerIdentityId: "winner", revertedAt: null }],
      graphEdges: [{ id: "e1", sourceType: "work", sourceId: "w1", targetType: "bibliographic_record", targetId: "b1" }],
    };
    const mismatches = checkGraphNodeCanonicalEntity(snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].repair).toBeNull();
    expect(mismatches[0].evidence).toMatchObject({ canonicalWorkIdentityId: "winner" });
  });

  it("ignores a work with a stale identity that is never graph-attached", () => {
    const snapshot = {
      ...emptySnapshot(),
      works: [{ id: "w1", title: "T", authorName: null, workIdentityId: "loser", deletedAt: null }],
      workIdentityMerges: [{ loserIdentityId: "loser", winnerIdentityId: "winner", revertedAt: null }],
    };
    expect(checkGraphNodeCanonicalEntity(snapshot)).toEqual([]);
  });
});
