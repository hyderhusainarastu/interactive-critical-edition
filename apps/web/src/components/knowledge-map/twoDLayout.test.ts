import { describe, expect, it } from "vitest";
import { LAYER_ORDER } from "@ice/graph-display";
import { computeLayerColumnPositions, computePositionExtent, LAYER_COLUMN_GAP } from "./twoDLayout";
import type { KnowledgeMapDisplayNode } from "./adapter";

function node(id: string, layer: KnowledgeMapDisplayNode["layer"], label = id): KnowledgeMapDisplayNode {
  return {
    id: id as KnowledgeMapDisplayNode["id"],
    displayKind: "work",
    canonicalNodeId: null,
    sourceEntity: null,
    layer,
    label,
    destination: null,
    unavailableReason: null,
    projection: null,
  };
}

describe("computeLayerColumnPositions", () => {
  // --- Column = layer's LAYER_ORDER index ---
  it("puts each node in the column matching its layer's LAYER_ORDER index", () => {
    const nodes = [node("a", "evidence"), node("b", "research")];
    const positions = computeLayerColumnPositions(nodes);
    expect(positions.get("a")?.x).toBe(LAYER_ORDER.indexOf("evidence") * LAYER_COLUMN_GAP);
    expect(positions.get("b")?.x).toBe(LAYER_ORDER.indexOf("research") * LAYER_COLUMN_GAP);
  });

  // --- Deterministic: same node set (any input order) -> identical positions ---
  it("is deterministic: the same node set in any input order gives identical positions", () => {
    const setA = [node("a", "claim", "Bravo"), node("b", "claim", "Alpha")];
    const setB = [node("b", "claim", "Alpha"), node("a", "claim", "Bravo")]; // reversed input order
    const posA = computeLayerColumnPositions(setA);
    const posB = computeLayerColumnPositions(setB);
    expect(posA.get("a")).toEqual(posB.get("a"));
    expect(posA.get("b")).toEqual(posB.get("b"));
    // Alpha sorts before Bravo -> Alpha gets the smaller row index (smaller y)
    expect((posA.get("b")?.y ?? 0) < (posA.get("a")?.y ?? 0)).toBeTruthy();
  });

  // --- Same-layer nodes get distinct rows (no overlap) ---
  it("gives same-layer nodes distinct rows (no overlap)", () => {
    const nodes = [node("a", "debate"), node("b", "debate"), node("c", "debate")];
    const positions = computeLayerColumnPositions(nodes);
    const ys = [...positions.values()].map((p) => p.y);
    // every same-layer node must get a distinct y
    expect(new Set(ys).size).toBe(3);
  });

  // --- Empty input -> empty map, no crash ---
  it("returns an empty map for empty input, no crash", () => {
    const positions = computeLayerColumnPositions([]);
    expect(positions.size).toBe(0);
  });
});

describe("computePositionExtent", () => {
  // --- computePositionExtent never returns a degenerate/negative box, even for empty input ---
  it("never returns a degenerate/negative box, even for empty input", () => {
    const extent = computePositionExtent(new Map());
    expect(extent.width > 0 && extent.height > 0).toBeTruthy();
  });

  // --- computePositionExtent grows with content ---
  it("grows with content", () => {
    const nodes = Array.from({ length: 5 }, (_, i) => node(`n${i}`, "research", `N${i}`));
    const positions = computeLayerColumnPositions(nodes);
    const extent = computePositionExtent(positions);
    const emptyExtent = computePositionExtent(new Map());
    // more rows in one column must grow the height
    expect(extent.height > emptyExtent.height).toBeTruthy();
  });
});
