import { describe, expect, it } from "vitest";
import { buildListRows, LAYER_LABEL, paginateListRows, sortListRows, type ListRow } from "./listLayout";
import { LAYER_ORDER } from "@ice/graph-display";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

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

describe("LAYER_LABEL", () => {
  // --- LAYER_LABEL is total over every Layer value ---
  it("is total over every Layer value", () => {
    for (const layer of LAYER_ORDER) {
      // LAYER_LABEL missing entry for `${layer}`
      expect(LAYER_LABEL[layer]).toBeTruthy();
    }
  });
});

describe("buildListRows", () => {
  // --- buildListRows carries layer + distance per row ---
  it("carries layer + distance per row", () => {
    const nodes = [node("root", "intellectual"), node("child", "claim")];
    const links = [link("root", "child")];
    const rows = buildListRows(nodes, "root", links);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => [r.node.id, r.layer, r.distance])).toEqual([
      ["root", "intellectual", 0],
      ["child", "claim", 1],
    ]);
  });
});

describe("sortListRows", () => {
  // --- sortListRows groups by LAYER_ORDER first, distance second, within a layer ---
  it("groups by LAYER_ORDER first, distance second within a layer", () => {
    const rows: ListRow[] = [
      { node: node("debate-far", "debate", "Zebra"), layer: "debate", distance: 3 },
      { node: node("evidence-a", "evidence", "Apple"), layer: "evidence", distance: 2 },
      { node: node("evidence-b", "evidence", "Banana"), layer: "evidence", distance: 1 },
    ];
    const sorted = sortListRows(rows, "distance", true);
    // evidence comes before debate in LAYER_ORDER, and within evidence, distance 1 before 2
    expect(sorted.map((r) => r.node.id)).toEqual(["evidence-b", "evidence-a", "debate-far"]);
  });

  // --- sortListRows by label, unknown distance never crashes and sorts last ---
  it("sorts an unknown distance last and never crashes, by distance or by label", () => {
    const rows: ListRow[] = [
      { node: node("b", "claim", "Beta"), layer: "claim", distance: null },
      { node: node("a", "claim", "Alpha"), layer: "claim", distance: 5 },
    ];
    const byDistance = sortListRows(rows, "distance", true);
    // unknown distance sorts after every known one
    expect(byDistance.map((r) => r.node.id)).toEqual(["a", "b"]);

    const byLabel = sortListRows(rows, "label", true);
    expect(byLabel.map((r) => r.node.id)).toEqual(["a", "b"]);
  });

  // --- sortListRows descending still respects layer order (layer isn't reversed) ---
  it("respects layer order when descending (layer grouping isn't reversed)", () => {
    const rows: ListRow[] = [
      { node: node("d", "debate", "D"), layer: "debate", distance: 1 },
      { node: node("e", "evidence", "E"), layer: "evidence", distance: 1 },
    ];
    const sorted = sortListRows(rows, "distance", false);
    // layer grouping order is stable regardless of ascending/descending
    expect(sorted.map((r) => r.node.id)).toEqual(["e", "d"]);
  });
});

describe("paginateListRows", () => {
  // --- paginateListRows clamps an out-of-range page and reports counts ---
  it("clamps an out-of-range page and reports counts", () => {
    const rows: ListRow[] = Array.from({ length: 120 }, (_, i) => ({
      node: node(`n${i}`, "claim", `Node ${i}`),
      layer: "claim" as const,
      distance: i,
    }));
    const page1 = paginateListRows(rows, 1, 50);
    expect(page1.pageRows.length).toBe(50);
    expect(page1.pageCount).toBe(3);
    expect(page1.page).toBe(1);
    expect(page1.totalRows).toBe(120);

    const page3 = paginateListRows(rows, 3, 50);
    expect(page3.pageRows.length).toBe(20);

    const overRequested = paginateListRows(rows, 99, 50);
    // an out-of-range page clamps to the last real page
    expect(overRequested.page).toBe(3);

    const underRequested = paginateListRows(rows, 0, 50);
    // page below 1 clamps to 1
    expect(underRequested.page).toBe(1);
  });

  // --- paginateListRows on an empty list never divides by zero into a 0-page state ---
  it("never divides by zero into a 0-page state on an empty list", () => {
    const empty = paginateListRows([], 1, 50);
    expect(empty.pageCount).toBe(1);
    expect(empty.pageRows.length).toBe(0);
  });
});
