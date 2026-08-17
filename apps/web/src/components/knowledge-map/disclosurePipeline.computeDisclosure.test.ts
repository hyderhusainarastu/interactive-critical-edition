import { describe, expect, it } from "vitest";
import { toDisplayLinkId, toDisplayNodeId } from "@ice/graph-display";
import { computeDisclosure } from "./disclosurePipeline";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

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

describe("computeDisclosure", () => {
  // --- initial disclosure: 24 (desktop cap) visible, rest aggregated ---
  it("initial disclosure: 24 (desktop cap) visible, rest aggregated", () => {
    const result = computeDisclosure(root, nodes, links, [], "desktop");
    // root + 24 prioritized neighbors
    expect(result.visibleIds.size).toBe(1 + 24);
    expect(result.visibleIds.has("root")).toBeTruthy();
    // all 6 leftover neighbors are the same kind -> one aggregate
    expect(result.aggregates.length).toBe(1);
    expect(result.aggregates[0].label).toBe("6 more references");
    expect(result.omittedExpansionIds).toEqual([]);
  });

  // --- mobile cap is 12 ---
  it("mobile cap is 12", () => {
    const result = computeDisclosure(root, nodes, links, [], "mobile");
    expect(result.visibleIds.size).toBe(1 + 12);
    expect(result.aggregates[0].label).toBe("18 more references");
  });

  // --- expanding the real aggregate reveals every remaining hidden node ---
  it("expanding the real aggregate reveals every remaining hidden node", () => {
    const initial = computeDisclosure(root, nodes, links, [], "desktop");
    const aggregateId = String(initial.aggregates[0].id);
    const expanded = computeDisclosure(root, nodes, links, [aggregateId], "desktop");
    // root + every neighbor now visible
    expect(expanded.visibleIds.size).toBe(1 + NEIGHBOR_COUNT);
    // nothing left to aggregate
    expect(expanded.aggregates.length).toBe(0);
    expect(expanded.omittedExpansionIds).toEqual([]);
  });

  // --- a stale/unknown trail entry is omitted with a reason, never crashes ---
  it("a stale/unknown trail entry is omitted with a reason, never crashes", () => {
    const result = computeDisclosure(root, nodes, links, ["aggregate:knowledge-map-disclosure:bogus-kind"], "desktop");
    expect(result.omittedExpansionIds.length).toBe(1);
    expect(result.omittedExpansionIds[0].reason).toBe("not_found");
    expect(result.omittedExpansionIds[0].source).toBe("expansionTrail");
    // The real disclosure is unaffected — same as the zero-expansion case.
    expect(result.visibleIds.size).toBe(1 + 24);
  });

  // --- expanding twice in a row (already fully expanded) omits the second, doesn't duplicate/crash ---
  it("expanding twice in a row (already fully expanded) omits the second, doesn't duplicate/crash", () => {
    const initial = computeDisclosure(root, nodes, links, [], "desktop");
    const aggregateId = String(initial.aggregates[0].id);
    const result = computeDisclosure(root, nodes, links, [aggregateId, aggregateId], "desktop");
    expect(result.visibleIds.size).toBe(1 + NEIGHBOR_COUNT);
    // second identical expansion has nothing left to admit -> omitted
    expect(result.omittedExpansionIds.length).toBe(1);
  });

  // --- a graph small enough to need no aggregation at all ---
  it("a graph small enough to need no aggregation at all", () => {
    const smallNeighbors = neighbors.slice(0, 3);
    const smallNodes = [root, ...smallNeighbors];
    const smallLinks = smallNeighbors.map((n, i) => link(`sl-${i}`, "root", String(n.id)));
    const result = computeDisclosure(root, smallNodes, smallLinks, [], "desktop");
    expect(result.visibleIds.size).toBe(4);
    expect(result.aggregates).toEqual([]);
  });
});
