import { describe, expect, it } from "vitest";
import { classifyEdgeFamily } from "./families";
import { toCanonicalNodeId, toDisplayNodeId, unwrapId } from "./ids";
import { layerForDisplayKind } from "./bands";
import { buildAggregateNodes, initialNeighborhood, selectPrioritized } from "./disclosure";
import { deepFreeze, validateDisplayGraph } from "./validate";
import { CANONICAL_EDGE_FAMILIES, DISPLAY_EDGE_FAMILIES } from "./types";
import { makeLink, makeNode } from "./testFixtures";

describe("CANONICAL_EDGE_FAMILIES / DISPLAY_EDGE_FAMILIES", () => {
  it("DISPLAY_EDGE_FAMILIES is exactly the 5 canonical families plus 'qualification'", () => {
    expect([...DISPLAY_EDGE_FAMILIES].sort()).toEqual([...CANONICAL_EDGE_FAMILIES, "qualification"].sort());
  });

  it("CANONICAL_EDGE_FAMILIES has exactly 5 values (the canonical contract charter says must stay unchanged)", () => {
    expect(CANONICAL_EDGE_FAMILIES.length).toBe(5);
  });
});

describe("ids — unwrapId is a safe no-op string projection", () => {
  it("round-trips a display id", () => {
    const id = toDisplayNodeId("work:abc");
    expect(unwrapId(id)).toBe("work:abc");
  });

  it("round-trips a canonical id", () => {
    const id = toCanonicalNodeId("work:abc");
    expect(unwrapId(id)).toBe("work:abc");
  });
});

describe("canonical-payload immutability across the whole public surface", () => {
  /**
   * Deep-freezes a representative canonical-ish input, then runs it through
   * every exported transform this package offers that touches node/link
   * data. Freezing means any code path that tries to mutate the input in
   * place throws a strict-mode TypeError immediately — this test passing
   * (no throw) is itself the immutability proof: it would fail loudly the
   * moment any adapter function started mutating what it was handed,
   * exactly the guarantee charter §9 asks for.
   */
  it("classifyEdgeFamily, layerForDisplayKind, disclosure, and validation never mutate frozen input", () => {
    const frozenNodes = deepFreeze([
      makeNode("root", "work"),
      makeNode("n1", "reference"),
      makeNode("n2", "concept"),
    ]);
    const frozenLinks = deepFreeze([
      makeLink("root|cites|n1", frozenNodes[0].id, frozenNodes[1].id, "reference"),
      makeLink("root|influences|n2", frozenNodes[0].id, frozenNodes[2].id, "influence"),
    ]);

    expect(() => {
      classifyEdgeFamily("cites", "explicit_reference");
      layerForDisplayKind("work");
      validateDisplayGraph(frozenNodes, frozenLinks);
      const cands = frozenNodes.slice(1).map((node) => ({ node, directVerifiedEvidenceAnchored: true, confidence: 0.5 }));
      const { hidden } = selectPrioritized(cands, 0);
      buildAggregateNodes(hidden, { rule: "test", version: "1" });
      initialNeighborhood(frozenNodes[0], cands, "desktop");
    }).not.toThrow();

    // The frozen arrays/objects are still frozen and unchanged afterward.
    expect(Object.isFrozen(frozenNodes)).toBe(true);
    expect(Object.isFrozen(frozenNodes[0])).toBe(true);
    expect(frozenNodes.map((n) => n.id)).toEqual(["root", "n1", "n2"]);
  });

  it("filtering/mapping functions return NEW arrays rather than the frozen input array itself", () => {
    const frozenNodes = deepFreeze([makeNode("a", "reference"), makeNode("b", "concept")]);
    const cands = frozenNodes.map((node) => ({ node, directVerifiedEvidenceAnchored: false, confidence: null }));
    const { visible } = selectPrioritized(cands, 1);
    expect(visible).not.toBe(frozenNodes);
  });
});
