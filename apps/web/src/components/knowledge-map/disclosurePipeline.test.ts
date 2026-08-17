import { describe, expect, it } from "vitest";
import { toDisplayLinkId, toDisplayNodeId } from "@ice/graph-display";
import { buildInitialDisclosure, buildNeighborCandidates } from "./disclosurePipeline";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

function node(id: string, overrides: Partial<KnowledgeMapDisplayNode> = {}): KnowledgeMapDisplayNode {
  return {
    id: toDisplayNodeId(id),
    displayKind: "work",
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

function link(id: string, source: string, target: string, overrides: Partial<KnowledgeMapDisplayLink> = {}): KnowledgeMapDisplayLink {
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
    ...overrides,
  };
}

describe("buildNeighborCandidates", () => {
  // --- buildNeighborCandidates: basic adjacency, both directions ---
  it("basic adjacency, both directions", () => {
    const nodes = [node("root"), node("a"), node("b"), node("c")];
    const links = [link("l1", "root", "a"), link("l2", "b", "root"), link("l3", "a", "c")];
    const candidates = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root"]));
    const ids = candidates.map((c) => String(c.node.id)).sort();
    // only direct neighbors of root, in either link direction; c (2 hops) excluded
    expect(ids).toEqual(["a", "b"]);
  });

  // --- excludeIds and already-in-fromIds are never re-offered ---
  it("excludeIds and already-in-fromIds are never re-offered", () => {
    const nodes = [node("root"), node("a")];
    const links = [link("l1", "root", "a")];
    const alreadyVisible = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root", "a"]));
    // excludeIds suppresses a node already visible
    expect(alreadyVisible).toEqual([]);

    const selfLoopIsh = buildNeighborCandidates(nodes, links, new Set(["root", "a"]), new Set());
    // a node already in fromIds is never re-offered as its own neighbor
    expect(selfLoopIsh).toEqual([]);
  });

  // --- directVerifiedEvidenceAnchored: most favorable signal across multiple links wins ---
  it("directVerifiedEvidenceAnchored: most favorable signal across multiple links wins", () => {
    const nodes = [node("root"), node("a")];
    const links = [
      link("l1", "root", "a", { evidence: null, aiInferred: false }), // not anchored (no evidence)
      link("l2", "a", "root", { evidence: { quote: "x" }, aiInferred: true }), // has evidence but AI-inferred -> not anchored
    ];
    const c1 = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root"]));
    // neither link alone qualifies
    expect(c1[0].directVerifiedEvidenceAnchored).toBe(false);

    const links2 = [
      link("l1", "root", "a", { evidence: null, aiInferred: false }),
      link("l2", "a", "root", { evidence: { quote: "x" }, aiInferred: false }), // real evidence, not AI-inferred -> anchored
    ];
    const c2 = buildNeighborCandidates(nodes, links2, new Set(["root"]), new Set(["root"]));
    // one qualifying link is enough, even if another link to the same node doesn't
    expect(c2[0].directVerifiedEvidenceAnchored).toBe(true);
  });

  // --- confidence is always null (DisplayLink carries no confidence field — see doc comment) ---
  it("confidence is always null (DisplayLink carries no confidence field)", () => {
    const nodes = [node("root"), node("a")];
    const links = [link("l1", "root", "a", { evidence: { x: 1 }, aiInferred: false })];
    const candidates = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root"]));
    expect(candidates[0].confidence).toBe(null);
  });

  // --- a dangling link endpoint (no matching node) is silently skipped, never crashes ---
  it("a dangling link endpoint (no matching node) is silently skipped, never crashes", () => {
    const nodes = [node("root")];
    const links = [link("l1", "root", "ghost")];
    const candidates = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root"]));
    expect(candidates).toEqual([]);
  });
});

describe("buildInitialDisclosure", () => {
  // --- buildInitialDisclosure: root always included, unconditionally visible ---
  it("root always included, unconditionally visible", () => {
    const root = node("root");
    const nodes = [root, node("a"), node("b")];
    const links = [link("l1", "root", "a"), link("l2", "root", "b")];
    const { visible, hidden } = buildInitialDisclosure(root, nodes, links, "desktop");
    // root is always first/included
    expect(visible[0].id).toBe(root.id);
    expect(visible.length).toBe(3);
    expect(hidden).toEqual([]);
  });
});
