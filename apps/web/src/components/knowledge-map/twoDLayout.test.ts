import assert from "node:assert/strict";
import { LAYER_ORDER } from "@ice/graph-display";
import { computeLayerColumnPositions, computePositionExtent, LAYER_COLUMN_GAP } from "./twoDLayout";
import type { KnowledgeMapDisplayNode } from "./adapter";

/** `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/twoDLayout.test.ts` */

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

// --- Column = layer's LAYER_ORDER index ---
{
  const nodes = [node("a", "evidence"), node("b", "research")];
  const positions = computeLayerColumnPositions(nodes);
  assert.equal(positions.get("a")?.x, LAYER_ORDER.indexOf("evidence") * LAYER_COLUMN_GAP);
  assert.equal(positions.get("b")?.x, LAYER_ORDER.indexOf("research") * LAYER_COLUMN_GAP);
}

// --- Deterministic: same node set (any input order) -> identical positions ---
{
  const setA = [node("a", "claim", "Bravo"), node("b", "claim", "Alpha")];
  const setB = [node("b", "claim", "Alpha"), node("a", "claim", "Bravo")]; // reversed input order
  const posA = computeLayerColumnPositions(setA);
  const posB = computeLayerColumnPositions(setB);
  assert.deepEqual(posA.get("a"), posB.get("a"));
  assert.deepEqual(posA.get("b"), posB.get("b"));
  // Alpha sorts before Bravo -> Alpha gets the smaller row index (smaller y)
  assert.ok((posA.get("b")?.y ?? 0) < (posA.get("a")?.y ?? 0));
}

// --- Same-layer nodes get distinct rows (no overlap) ---
{
  const nodes = [node("a", "debate"), node("b", "debate"), node("c", "debate")];
  const positions = computeLayerColumnPositions(nodes);
  const ys = [...positions.values()].map((p) => p.y);
  assert.equal(new Set(ys).size, 3, "every same-layer node must get a distinct y");
}

// --- Empty input -> empty map, no crash ---
{
  const positions = computeLayerColumnPositions([]);
  assert.equal(positions.size, 0);
}

// --- computePositionExtent never returns a degenerate/negative box, even for empty input ---
{
  const extent = computePositionExtent(new Map());
  assert.ok(extent.width > 0 && extent.height > 0);
}

// --- computePositionExtent grows with content ---
{
  const nodes = Array.from({ length: 5 }, (_, i) => node(`n${i}`, "research", `N${i}`));
  const positions = computeLayerColumnPositions(nodes);
  const extent = computePositionExtent(positions);
  const emptyExtent = computePositionExtent(new Map());
  assert.ok(extent.height > emptyExtent.height, "more rows in one column must grow the height");
}

console.log("twoDLayout.test.ts: all assertions passed");
