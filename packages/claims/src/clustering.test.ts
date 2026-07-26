import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { findClaimClusters, memberHash, type ClaimRelationEdge } from "./clustering";

describe("memberHash", () => {
  it("is order-independent (sorts before hashing)", () => {
    expect(memberHash(["b", "a"])).toBe(memberHash(["a", "b"]));
  });

  it("matches a directly hand-computed sha256", () => {
    const expected = createHash("sha256").update("a b").digest("hex");
    expect(memberHash(["a", "b"])).toBe(expected);
  });

  it("differs for a different membership", () => {
    expect(memberHash(["a", "b"])).not.toBe(memberHash(["a", "c"]));
  });
});

describe("findClaimClusters", () => {
  it("finds a simple two-claim cluster from a single contradiction edge", () => {
    const edges: ClaimRelationEdge[] = [{ claimLo: "a", claimHi: "b", valence: "contradiction" }];
    const clusters = findClaimClusters(edges);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(["a", "b"]);
    expect(clusters[0].counts).toEqual({ contradiction: 1, support: 0, nuance: 0 });
    expect(clusters[0].edgeCount).toBe(1);
  });

  it("excludes 'unrelated' edges from cluster formation entirely", () => {
    const edges: ClaimRelationEdge[] = [{ claimLo: "a", claimHi: "b", valence: "unrelated" }];
    expect(findClaimClusters(edges)).toEqual([]);
  });

  it("a claim connected only via an 'unrelated' edge stays its own non-cluster (size < 2, dropped)", () => {
    const edges: ClaimRelationEdge[] = [
      { claimLo: "a", claimHi: "b", valence: "unrelated" },
      { claimLo: "c", claimHi: "d", valence: "support" },
    ];
    const clusters = findClaimClusters(edges);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(["c", "d"]);
  });

  it("merges a chain of claims into one connected component via BFS", () => {
    // a-b (support), b-c (nuance): a, b, c all end up in one cluster even
    // though a and c have no direct edge.
    const edges: ClaimRelationEdge[] = [
      { claimLo: "a", claimHi: "b", valence: "support" },
      { claimLo: "b", claimHi: "c", valence: "nuance" },
    ];
    const clusters = findClaimClusters(edges);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(["a", "b", "c"]);
    expect(clusters[0].counts).toEqual({ contradiction: 0, support: 1, nuance: 1 });
  });

  it("keeps two disconnected components separate", () => {
    const edges: ClaimRelationEdge[] = [
      { claimLo: "a", claimHi: "b", valence: "contradiction" },
      { claimLo: "x", claimHi: "y", valence: "support" },
    ];
    const clusters = findClaimClusters(edges);
    expect(clusters).toHaveLength(2);
    const memberships = clusters.map((c) => c.memberIds.sort().join(","));
    expect(memberships).toEqual(expect.arrayContaining(["a,b", "x,y"]));
  });

  it("does not double-count an edge whose endpoints are both in the component but the edge itself repeats", () => {
    const edges: ClaimRelationEdge[] = [
      { claimLo: "a", claimHi: "b", valence: "contradiction" },
      { claimLo: "a", claimHi: "b", valence: "contradiction" }, // duplicate judged edge
    ];
    const clusters = findClaimClusters(edges);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].edgeCount).toBe(2); // both edges are real (e.g. re-judged), counted as-is
    expect(clusters[0].counts.contradiction).toBe(2);
  });

  it("memberHash is deterministic and reflects the actual membership", () => {
    const edges: ClaimRelationEdge[] = [{ claimLo: "z", claimHi: "a", valence: "contradiction" }];
    const clusters = findClaimClusters(edges);
    expect(clusters[0].memberHash).toBe(memberHash(["a", "z"]));
  });

  it("returns an empty array for no edges at all", () => {
    expect(findClaimClusters([])).toEqual([]);
  });
});
