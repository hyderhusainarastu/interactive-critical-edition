import assert from "node:assert/strict";
import { LAYER_ORDER, toDisplayNodeId } from "@ice/graph-display";
import { computeVisibleNodeIds, toggleLayer } from "./attributeVisibility";
import { DEFAULT_GRAPH_FILTERS, type GraphNode } from "../graph/types";
import type { KnowledgeMapDisplayNode } from "./adapter";

/** `npx tsx apps/web/src/components/knowledge-map/attributeVisibility.test.ts` */

function node(id: string, overrides: Partial<KnowledgeMapDisplayNode> = {}): KnowledgeMapDisplayNode {
  return {
    id: toDisplayNodeId(id),
    displayKind: "reference",
    canonicalNodeId: null,
    sourceEntity: null,
    layer: "intellectual",
    label: id,
    destination: null,
    unavailableReason: null,
    projection: null,
    ...overrides,
  };
}

function canonical(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    label: id,
    type: "reference",
    state: "unread",
    uploaded: false,
    associatedWorkIds: [],
    destination: null,
    authors: null,
    year: null,
    url: null,
    ...overrides,
  };
}

const root = node("root");
const a = node("a", { label: "On the Soul" });
const b = node("b", { label: "Physics", layer: "claim" });
const nodes = [root, a, b];
const canonicalById = new Map<string, GraphNode>([
  ["a", canonical("a", { type: "reference", state: "unread" })],
  ["b", canonical("b", { type: "concept", state: "read" })],
]);

// --- no filters: everything visible ---
{
  const visible = computeVisibleNodeIds(nodes, canonicalById, "root", DEFAULT_GRAPH_FILTERS, []);
  assert.deepEqual([...visible].sort(), ["a", "b", "root"]);
}
console.log("no filters: OK");

// --- root is always visible, even against a filter it would otherwise fail ---
{
  const visible = computeVisibleNodeIds(nodes, canonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, search: "zzz-no-match" }, []);
  assert.ok(visible.has("root"), "root exempt from search filter");
  assert.ok(!visible.has("a"));
  assert.ok(!visible.has("b"));
}
console.log("root always visible: OK");

// --- search matches label case-insensitively ---
{
  const visible = computeVisibleNodeIds(nodes, canonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, search: "soul" }, []);
  assert.deepEqual([...visible].sort(), ["a", "root"]);
}
console.log("search filter: OK");

// --- type filter uses canonical data ---
{
  const visible = computeVisibleNodeIds(nodes, canonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, type: "concept" }, []);
  assert.deepEqual([...visible].sort(), ["b", "root"]);
}
console.log("type filter: OK");

// --- state filter uses canonical data ---
{
  const visible = computeVisibleNodeIds(nodes, canonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, state: "read" }, []);
  assert.deepEqual([...visible].sort(), ["b", "root"]);
}
console.log("state filter: OK");

// --- a node with no canonical backing is exempt from type/state filters (never punish missing data) ---
{
  const noCanonicalById = new Map<string, GraphNode>();
  const visible = computeVisibleNodeIds(nodes, noCanonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, type: "concept" }, []);
  assert.deepEqual([...visible].sort(), ["a", "b", "root"], "no canonical data -> never excluded by a filter it can't be checked against");
}
console.log("missing canonical data exemption: OK");

// --- layer filter ---
{
  const visible = computeVisibleNodeIds(nodes, canonicalById, "root", DEFAULT_GRAPH_FILTERS, ["claim"]);
  assert.deepEqual([...visible].sort(), ["b", "root"], "only claim-layer nodes (+ always-visible root) survive");
}
{
  const visible = computeVisibleNodeIds(nodes, canonicalById, "root", DEFAULT_GRAPH_FILTERS, []);
  assert.deepEqual([...visible].sort(), ["a", "b", "root"], "an empty activeLayers array means no layer filtering at all");
}
console.log("layer filter: OK");

// --- toggleLayer: unchecking a layer from the implicit "all" (empty
// array) state must hide EXACTLY that layer, not flip to "show only this
// layer" (the bug a naive `includes ? remove : add` toggle produces) ---
{
  const afterUncheck = toggleLayer([], "intellectual");
  assert.deepEqual(
    afterUncheck.sort(),
    LAYER_ORDER.filter((l) => l !== "intellectual").sort(),
    "unchecking one layer from the all-shown state must hide only that layer, not invert to showing only it",
  );
}
{
  // Re-checking the one hidden layer collapses back to the canonical `[]`
  // ("no filter") representation, not a same-meaning full explicit list.
  const allButOne = LAYER_ORDER.filter((l) => l !== "claim");
  assert.deepEqual(toggleLayer(allButOne, "claim"), []);
}
{
  // Toggling a layer OFF from an already-explicit subset behaves like a
  // plain removal.
  assert.deepEqual(toggleLayer(["claim", "debate"], "claim").sort(), ["debate"]);
}
{
  // Toggling a layer ON when it's the only one currently excluded from an
  // explicit subset adds it back (same case as the "collapses to []" one
  // above, covered again here for a non-full-minus-one starting set).
  assert.deepEqual(toggleLayer(["claim"], "debate").sort(), ["claim", "debate"]);
}
console.log("toggleLayer: OK");

console.log("attributeVisibility.test.ts: all assertions passed");
