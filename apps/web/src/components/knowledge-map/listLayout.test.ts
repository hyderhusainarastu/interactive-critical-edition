import assert from "node:assert/strict";
import { buildListRows, LAYER_LABEL, paginateListRows, sortListRows, type ListRow } from "./listLayout";
import { LAYER_ORDER } from "@ice/graph-display";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

/** `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/listLayout.test.ts` */

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

// --- LAYER_LABEL is total over every Layer value ---
{
  for (const layer of LAYER_ORDER) assert.ok(LAYER_LABEL[layer], `LAYER_LABEL missing entry for ${layer}`);
}

// --- buildListRows carries layer + distance per row ---
{
  const nodes = [node("root", "intellectual"), node("child", "claim")];
  const links = [link("root", "child")];
  const rows = buildListRows(nodes, "root", links);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.node.id, r.layer, r.distance]),
    [
      ["root", "intellectual", 0],
      ["child", "claim", 1],
    ],
  );
}

// --- sortListRows groups by LAYER_ORDER first, distance second, within a layer ---
{
  const rows: ListRow[] = [
    { node: node("debate-far", "debate", "Zebra"), layer: "debate", distance: 3 },
    { node: node("evidence-a", "evidence", "Apple"), layer: "evidence", distance: 2 },
    { node: node("evidence-b", "evidence", "Banana"), layer: "evidence", distance: 1 },
  ];
  const sorted = sortListRows(rows, "distance", true);
  // evidence comes before debate in LAYER_ORDER, and within evidence, distance 1 before 2
  assert.deepEqual(
    sorted.map((r) => r.node.id),
    ["evidence-b", "evidence-a", "debate-far"],
  );
}

// --- sortListRows by label, unknown distance never crashes and sorts last ---
{
  const rows: ListRow[] = [
    { node: node("b", "claim", "Beta"), layer: "claim", distance: null },
    { node: node("a", "claim", "Alpha"), layer: "claim", distance: 5 },
  ];
  const byDistance = sortListRows(rows, "distance", true);
  assert.deepEqual(byDistance.map((r) => r.node.id), ["a", "b"], "unknown distance sorts after every known one");

  const byLabel = sortListRows(rows, "label", true);
  assert.deepEqual(byLabel.map((r) => r.node.id), ["a", "b"]);
}

// --- sortListRows descending still respects layer order (layer isn't reversed) ---
{
  const rows: ListRow[] = [
    { node: node("d", "debate", "D"), layer: "debate", distance: 1 },
    { node: node("e", "evidence", "E"), layer: "evidence", distance: 1 },
  ];
  const sorted = sortListRows(rows, "distance", false);
  assert.deepEqual(sorted.map((r) => r.node.id), ["e", "d"], "layer grouping order is stable regardless of ascending/descending");
}

// --- paginateListRows clamps an out-of-range page and reports counts ---
{
  const rows: ListRow[] = Array.from({ length: 120 }, (_, i) => ({
    node: node(`n${i}`, "claim", `Node ${i}`),
    layer: "claim" as const,
    distance: i,
  }));
  const page1 = paginateListRows(rows, 1, 50);
  assert.equal(page1.pageRows.length, 50);
  assert.equal(page1.pageCount, 3);
  assert.equal(page1.page, 1);
  assert.equal(page1.totalRows, 120);

  const page3 = paginateListRows(rows, 3, 50);
  assert.equal(page3.pageRows.length, 20);

  const overRequested = paginateListRows(rows, 99, 50);
  assert.equal(overRequested.page, 3, "an out-of-range page clamps to the last real page");

  const underRequested = paginateListRows(rows, 0, 50);
  assert.equal(underRequested.page, 1, "page below 1 clamps to 1");
}

// --- paginateListRows on an empty list never divides by zero into a 0-page state ---
{
  const empty = paginateListRows([], 1, 50);
  assert.equal(empty.pageCount, 1);
  assert.equal(empty.pageRows.length, 0);
}

console.log("listLayout.test.ts: all assertions passed");
