import assert from "node:assert/strict";
import { computeRelationshipDistances } from "./relationshipDistance";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

/** `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/relationshipDistance.test.ts`
 *  — matches the existing tsx-script convention used across this
 *  directory (no vitest wiring exists under `apps/web`). */

function node(id: string): KnowledgeMapDisplayNode {
  return {
    id: id as KnowledgeMapDisplayNode["id"],
    displayKind: "work",
    canonicalNodeId: null,
    sourceEntity: null,
    layer: "intellectual",
    label: id,
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

// --- Root is always distance 0 ---
{
  const nodes = [node("a")];
  const distances = computeRelationshipDistances("a", nodes, []);
  assert.equal(distances.get("a"), 0);
}

// --- Straight-line chain: a -> b -> c ---
{
  const nodes = [node("a"), node("b"), node("c")];
  const links = [link("a", "b"), link("b", "c")];
  const distances = computeRelationshipDistances("a", nodes, links);
  assert.equal(distances.get("a"), 0);
  assert.equal(distances.get("b"), 1);
  assert.equal(distances.get("c"), 2);
}

// --- Direction of the link doesn't matter (undirected BFS) ---
{
  const nodes = [node("a"), node("b")];
  const links = [link("b", "a")]; // b -> a, but distance from a should still be 1
  const distances = computeRelationshipDistances("a", nodes, links);
  assert.equal(distances.get("b"), 1);
}

// --- Disconnected component: unreachable node has no entry at all ---
{
  const nodes = [node("a"), node("b"), node("isolated")];
  const links = [link("a", "b")];
  const distances = computeRelationshipDistances("a", nodes, links);
  assert.equal(distances.has("isolated"), false, "unreachable node must be absent, never 0/Infinity");
}

// --- Self-link is ignored, never contributes a distance-0-from-itself loop artifact ---
{
  const nodes = [node("a")];
  const links = [link("a", "a")];
  const distances = computeRelationshipDistances("a", nodes, links);
  assert.equal(distances.size, 1);
  assert.equal(distances.get("a"), 0);
}

// --- Dangling link endpoint (not in nodes) never crashes, never pollutes distances ---
{
  const nodes = [node("a")];
  const links = [link("a", "ghost")];
  const distances = computeRelationshipDistances("a", nodes, links);
  assert.equal(distances.has("ghost"), false);
  assert.equal(distances.size, 1);
}

// --- No root id (context still loading) -> empty map, not a crash ---
{
  assert.equal(computeRelationshipDistances(null, [node("a")], []).size, 0);
}

// --- Root id not present in the node set (stale/omitted root) -> empty map ---
{
  assert.equal(computeRelationshipDistances("missing", [node("a")], []).size, 0);
}

// --- Shortest path wins when multiple paths exist ---
{
  const nodes = [node("a"), node("b"), node("c"), node("d")];
  const links = [link("a", "b"), link("b", "c"), link("c", "d"), link("a", "d")];
  const distances = computeRelationshipDistances("a", nodes, links);
  assert.equal(distances.get("d"), 1, "the direct a-d edge is shorter than a-b-c-d");
}

console.log("relationshipDistance.test.ts: all assertions passed");
