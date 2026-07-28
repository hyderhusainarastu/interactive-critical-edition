import assert from "node:assert/strict";
import { toDisplayLinkId, toDisplayNodeId } from "@ice/graph-display";
import { computeDisclosure } from "./disclosurePipeline";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

/** `npx tsx apps/web/src/components/knowledge-map/disclosurePipeline.computeDisclosure.test.ts` */

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

function link(id: string, source: string, target: string): KnowledgeMapDisplayLink {
  return {
    id: toDisplayLinkId(id),
    source: toDisplayNodeId(source),
    target: toDisplayNodeId(target),
    canonicalLinkId: null,
    displayFamily: "reference",
    directed: true,
    evidence: null,
    provenance: null,
    aiInferred: false,
  };
}

// 30 neighbors, zero-padded ids so string sort == numeric sort (the
// package's own deterministic tie-break rule).
const NEIGHBOR_COUNT = 30;
function neighborId(i: number): string {
  return `n-${String(i).padStart(2, "0")}`;
}

const root = node("root");
const neighbors = Array.from({ length: NEIGHBOR_COUNT }, (_, i) => node(neighborId(i)));
const nodes = [root, ...neighbors];
const links = neighbors.map((n, i) => link(`l-${i}`, "root", String(n.id)));

// --- initial disclosure: 24 (desktop cap) visible, rest aggregated ---
{
  const result = computeDisclosure(root, nodes, links, [], "desktop");
  assert.equal(result.visibleIds.size, 1 + 24, "root + 24 prioritized neighbors");
  assert.ok(result.visibleIds.has("root"));
  assert.equal(result.aggregates.length, 1, "all 6 leftover neighbors are the same kind -> one aggregate");
  assert.equal(result.aggregates[0].label, "6 more references");
  assert.deepEqual(result.omittedExpansionIds, []);
}
console.log("computeDisclosure initial (desktop): OK");

// --- mobile cap is 12 ---
{
  const result = computeDisclosure(root, nodes, links, [], "mobile");
  assert.equal(result.visibleIds.size, 1 + 12);
  assert.equal(result.aggregates[0].label, "18 more references");
}
console.log("computeDisclosure initial (mobile): OK");

// --- expanding the real aggregate reveals every remaining hidden node ---
{
  const initial = computeDisclosure(root, nodes, links, [], "desktop");
  const aggregateId = String(initial.aggregates[0].id);
  const expanded = computeDisclosure(root, nodes, links, [aggregateId], "desktop");
  assert.equal(expanded.visibleIds.size, 1 + NEIGHBOR_COUNT, "root + every neighbor now visible");
  assert.equal(expanded.aggregates.length, 0, "nothing left to aggregate");
  assert.deepEqual(expanded.omittedExpansionIds, []);
}
console.log("computeDisclosure expansion: OK");

// --- a stale/unknown trail entry is omitted with a reason, never crashes ---
{
  const result = computeDisclosure(root, nodes, links, ["aggregate:knowledge-map-disclosure:bogus-kind"], "desktop");
  assert.equal(result.omittedExpansionIds.length, 1);
  assert.equal(result.omittedExpansionIds[0].reason, "not_found");
  assert.equal(result.omittedExpansionIds[0].source, "expansionTrail");
  // The real disclosure is unaffected — same as the zero-expansion case.
  assert.equal(result.visibleIds.size, 1 + 24);
}
console.log("computeDisclosure stale trail entry: OK");

// --- expanding twice in a row (already fully expanded) omits the second, doesn't duplicate/crash ---
{
  const initial = computeDisclosure(root, nodes, links, [], "desktop");
  const aggregateId = String(initial.aggregates[0].id);
  const result = computeDisclosure(root, nodes, links, [aggregateId, aggregateId], "desktop");
  assert.equal(result.visibleIds.size, 1 + NEIGHBOR_COUNT);
  assert.equal(result.omittedExpansionIds.length, 1, "second identical expansion has nothing left to admit -> omitted");
}
console.log("computeDisclosure repeat expansion: OK");

// --- a graph small enough to need no aggregation at all ---
{
  const smallNeighbors = neighbors.slice(0, 3);
  const smallNodes = [root, ...smallNeighbors];
  const smallLinks = smallNeighbors.map((n, i) => link(`sl-${i}`, "root", String(n.id)));
  const result = computeDisclosure(root, smallNodes, smallLinks, [], "desktop");
  assert.equal(result.visibleIds.size, 4);
  assert.deepEqual(result.aggregates, []);
}
console.log("computeDisclosure no aggregation needed: OK");

console.log("disclosurePipeline.computeDisclosure.test.ts: all assertions passed");
