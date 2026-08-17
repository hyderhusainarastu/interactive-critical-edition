import { describe, expect, it } from "vitest";
import { computeRelationshipDistances } from "./relationshipDistance";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

function node(id: string): KnowledgeMapDisplayNode {
  return {
    id: id as KnowledgeMapDisplayNode["id"],
    displayKind: "work",
    canonicalNodeId: null,
    sourceEntity: null,
    layer: "intellectual",
    label: id,
    destination: null,
    unavailableReason: null,
    projection: null,
  };
}

function link(source: string, target: string): KnowledgeMapDisplayLink {
  return {
    id: `${source}|${target}` as KnowledgeMapDisplayLink["id"],
    source: source as KnowledgeMapDisplayLink["source"],
    target: target as KnowledgeMapDisplayLink["target"],
    canonicalLinkId: null,
    displayFamily: "reference",
    directed: true,
    evidence: null,
    provenance: null,
    aiInferred: false,
  };
}

describe("computeRelationshipDistances", () => {
  // --- Root is always distance 0 ---
  it("always puts the root at distance 0", () => {
    const nodes = [node("a")];
    const distances = computeRelationshipDistances("a", nodes, []);
    expect(distances.get("a")).toBe(0);
  });

  // --- Straight-line chain: a -> b -> c ---
  it("walks a straight-line chain a -> b -> c", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const links = [link("a", "b"), link("b", "c")];
    const distances = computeRelationshipDistances("a", nodes, links);
    expect(distances.get("a")).toBe(0);
    expect(distances.get("b")).toBe(1);
    expect(distances.get("c")).toBe(2);
  });

  // --- Direction of the link doesn't matter (undirected BFS) ---
  it("ignores link direction (undirected BFS)", () => {
    const nodes = [node("a"), node("b")];
    const links = [link("b", "a")]; // b -> a, but distance from a should still be 1
    const distances = computeRelationshipDistances("a", nodes, links);
    expect(distances.get("b")).toBe(1);
  });

  // --- Disconnected component: unreachable node has no entry at all ---
  it("omits an unreachable node in a disconnected component entirely", () => {
    const nodes = [node("a"), node("b"), node("isolated")];
    const links = [link("a", "b")];
    const distances = computeRelationshipDistances("a", nodes, links);
    // unreachable node must be absent, never 0/Infinity
    expect(distances.has("isolated")).toBe(false);
  });

  // --- Self-link is ignored, never contributes a distance-0-from-itself loop artifact ---
  it("ignores a self-link, never contributing a distance-0-from-itself loop artifact", () => {
    const nodes = [node("a")];
    const links = [link("a", "a")];
    const distances = computeRelationshipDistances("a", nodes, links);
    expect(distances.size).toBe(1);
    expect(distances.get("a")).toBe(0);
  });

  // --- Dangling link endpoint (not in nodes) never crashes, never pollutes distances ---
  it("never crashes or pollutes distances on a dangling link endpoint not in the node set", () => {
    const nodes = [node("a")];
    const links = [link("a", "ghost")];
    const distances = computeRelationshipDistances("a", nodes, links);
    expect(distances.has("ghost")).toBe(false);
    expect(distances.size).toBe(1);
  });

  // --- No root id (context still loading) -> empty map, not a crash ---
  it("returns an empty map, not a crash, when there is no root id (context still loading)", () => {
    expect(computeRelationshipDistances(null, [node("a")], []).size).toBe(0);
  });

  // --- Root id not present in the node set (stale/omitted root) -> empty map ---
  it("returns an empty map when the root id is not present in the node set (stale/omitted root)", () => {
    expect(computeRelationshipDistances("missing", [node("a")], []).size).toBe(0);
  });

  // --- Shortest path wins when multiple paths exist ---
  it("takes the shortest path when multiple paths exist", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const links = [link("a", "b"), link("b", "c"), link("c", "d"), link("a", "d")];
    const distances = computeRelationshipDistances("a", nodes, links);
    // the direct a-d edge is shorter than a-b-c-d
    expect(distances.get("d")).toBe(1);
  });
});
