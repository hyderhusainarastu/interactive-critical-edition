import { describe, expect, it } from "vitest";
import { LAYER_ORDER, toDisplayNodeId } from "@ice/graph-display";
import { computeVisibleNodeIds, toggleLayer } from "./attributeVisibility";
import { DEFAULT_GRAPH_FILTERS } from "../graph/filterGraphData";
import type { GraphNode } from "../graph/types";
import type { KnowledgeMapDisplayNode } from "./adapter";

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

describe("computeVisibleNodeIds", () => {
  // --- no filters: everything visible ---
  it("no filters: everything visible", () => {
    const visible = computeVisibleNodeIds(nodes, canonicalById, "root", DEFAULT_GRAPH_FILTERS, []);
    expect([...visible].sort()).toEqual(["a", "b", "root"]);
  });

  // --- root is always visible, even against a filter it would otherwise fail ---
  it("root is always visible, even against a filter it would otherwise fail", () => {
    const visible = computeVisibleNodeIds(nodes, canonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, search: "zzz-no-match" }, []);
    // root exempt from search filter
    expect(visible.has("root")).toBeTruthy();
    expect(!visible.has("a")).toBeTruthy();
    expect(!visible.has("b")).toBeTruthy();
  });

  // --- search matches label case-insensitively ---
  it("search matches label case-insensitively", () => {
    const visible = computeVisibleNodeIds(nodes, canonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, search: "soul" }, []);
    expect([...visible].sort()).toEqual(["a", "root"]);
  });

  // --- type filter uses canonical data ---
  it("type filter uses canonical data", () => {
    const visible = computeVisibleNodeIds(nodes, canonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, type: "concept" }, []);
    expect([...visible].sort()).toEqual(["b", "root"]);
  });

  // --- state filter uses canonical data ---
  it("state filter uses canonical data", () => {
    const visible = computeVisibleNodeIds(nodes, canonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, state: "read" }, []);
    expect([...visible].sort()).toEqual(["b", "root"]);
  });

  // --- a node with no canonical backing is exempt from type/state filters (never punish missing data) ---
  it("a node with no canonical backing is exempt from type/state filters (never punish missing data)", () => {
    const noCanonicalById = new Map<string, GraphNode>();
    const visible = computeVisibleNodeIds(nodes, noCanonicalById, "root", { ...DEFAULT_GRAPH_FILTERS, type: "concept" }, []);
    // no canonical data -> never excluded by a filter it can't be checked against
    expect([...visible].sort()).toEqual(["a", "b", "root"]);
  });

  // --- layer filter ---
  it("layer filter keeps only the active layers (+ always-visible root)", () => {
    const visible = computeVisibleNodeIds(nodes, canonicalById, "root", DEFAULT_GRAPH_FILTERS, ["claim"]);
    // only claim-layer nodes (+ always-visible root) survive
    expect([...visible].sort()).toEqual(["b", "root"]);
  });

  it("an empty activeLayers array means no layer filtering at all", () => {
    const visible = computeVisibleNodeIds(nodes, canonicalById, "root", DEFAULT_GRAPH_FILTERS, []);
    expect([...visible].sort()).toEqual(["a", "b", "root"]);
  });
});

describe("toggleLayer", () => {
  // --- toggleLayer: unchecking a layer from the implicit "all" (empty
  // array) state must hide EXACTLY that layer, not flip to "show only this
  // layer" (the bug a naive `includes ? remove : add` toggle produces) ---
  it("unchecking one layer from the all-shown state must hide only that layer, not invert to showing only it", () => {
    const afterUncheck = toggleLayer([], "intellectual");
    expect(afterUncheck.sort()).toEqual(LAYER_ORDER.filter((l) => l !== "intellectual").sort());
  });

  it("re-checking the one hidden layer collapses back to the canonical [] representation", () => {
    // Re-checking the one hidden layer collapses back to the canonical `[]`
    // ("no filter") representation, not a same-meaning full explicit list.
    const allButOne = LAYER_ORDER.filter((l) => l !== "claim");
    expect(toggleLayer(allButOne, "claim")).toEqual([]);
  });

  it("toggling a layer OFF from an already-explicit subset behaves like a plain removal", () => {
    // Toggling a layer OFF from an already-explicit subset behaves like a
    // plain removal.
    expect(toggleLayer(["claim", "debate"], "claim").sort()).toEqual(["debate"]);
  });

  it("toggling a layer ON from a non-full-minus-one explicit subset adds it back", () => {
    // Toggling a layer ON when it's the only one currently excluded from an
    // explicit subset adds it back (same case as the "collapses to []" one
    // above, covered again here for a non-full-minus-one starting set).
    expect(toggleLayer(["claim"], "debate").sort()).toEqual(["claim", "debate"]);
  });
});
