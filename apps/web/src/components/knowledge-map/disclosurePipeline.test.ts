import assert from "node:assert/strict";
import { toDisplayLinkId, toDisplayNodeId } from "@ice/graph-display";
import { buildInitialDisclosure, buildNeighborCandidates } from "./disclosurePipeline";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

/** `npx tsx apps/web/src/components/knowledge-map/disclosurePipeline.test.ts` */

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

// --- buildNeighborCandidates: basic adjacency, both directions ---
{
  const nodes = [node("root"), node("a"), node("b"), node("c")];
  const links = [link("l1", "root", "a"), link("l2", "b", "root"), link("l3", "a", "c")];
  const candidates = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root"]));
  const ids = candidates.map((c) => String(c.node.id)).sort();
  assert.deepEqual(ids, ["a", "b"], "only direct neighbors of root, in either link direction; c (2 hops) excluded");
}
console.log("buildNeighborCandidates basic adjacency: OK");

// --- excludeIds and already-in-fromIds are never re-offered ---
{
  const nodes = [node("root"), node("a")];
  const links = [link("l1", "root", "a")];
  const alreadyVisible = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root", "a"]));
  assert.deepEqual(alreadyVisible, [], "excludeIds suppresses a node already visible");

  const selfLoopIsh = buildNeighborCandidates(nodes, links, new Set(["root", "a"]), new Set());
  assert.deepEqual(selfLoopIsh, [], "a node already in fromIds is never re-offered as its own neighbor");
}
console.log("buildNeighborCandidates exclusion: OK");

// --- directVerifiedEvidenceAnchored: most favorable signal across multiple links wins ---
{
  const nodes = [node("root"), node("a")];
  const links = [
    link("l1", "root", "a", { evidence: null, aiInferred: false }), // not anchored (no evidence)
    link("l2", "a", "root", { evidence: { quote: "x" }, aiInferred: true }), // has evidence but AI-inferred -> not anchored
  ];
  const c1 = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root"]));
  assert.equal(c1[0].directVerifiedEvidenceAnchored, false, "neither link alone qualifies");

  const links2 = [
    link("l1", "root", "a", { evidence: null, aiInferred: false }),
    link("l2", "a", "root", { evidence: { quote: "x" }, aiInferred: false }), // real evidence, not AI-inferred -> anchored
  ];
  const c2 = buildNeighborCandidates(nodes, links2, new Set(["root"]), new Set(["root"]));
  assert.equal(c2[0].directVerifiedEvidenceAnchored, true, "one qualifying link is enough, even if another link to the same node doesn't");
}
console.log("buildNeighborCandidates anchoring: OK");

// --- confidence is always null (DisplayLink carries no confidence field — see doc comment) ---
{
  const nodes = [node("root"), node("a")];
  const links = [link("l1", "root", "a", { evidence: { x: 1 }, aiInferred: false })];
  const candidates = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root"]));
  assert.equal(candidates[0].confidence, null);
}
console.log("buildNeighborCandidates confidence: OK");

// --- a dangling link endpoint (no matching node) is silently skipped, never crashes ---
{
  const nodes = [node("root")];
  const links = [link("l1", "root", "ghost")];
  const candidates = buildNeighborCandidates(nodes, links, new Set(["root"]), new Set(["root"]));
  assert.deepEqual(candidates, []);
}
console.log("buildNeighborCandidates dangling endpoint: OK");

// --- buildInitialDisclosure: root always included, unconditionally visible ---
{
  const root = node("root");
  const nodes = [root, node("a"), node("b")];
  const links = [link("l1", "root", "a"), link("l2", "root", "b")];
  const { visible, hidden } = buildInitialDisclosure(root, nodes, links, "desktop");
  assert.equal(visible[0].id, root.id, "root is always first/included");
  assert.equal(visible.length, 3);
  assert.deepEqual(hidden, []);
}
console.log("buildInitialDisclosure: OK");

console.log("disclosurePipeline.test.ts: all assertions passed");
