import assert from "node:assert/strict";
import { computeConceptAttractionPairs, CONCEPT_ATTRACTION_STRENGTH } from "./graphForces";

/**
 * Graph P4 (concept clustering). Run via bare `tsx` (same convention as
 * `graphSceneScaling.test.ts`/`graphFocus.test.ts` — no DB import, no
 * DATABASE_URL needed):
 *   pnpm --filter worker exec tsx apps/web/src/components/graph/graphForces.test.ts
 */

function node(id: string, type: "work" | "reference" | "peer_reviewed_source" | "online_source" | "concept" | "person" | "section") {
  return { id, type };
}

// A resource -> concept edge becomes exactly one pair, normalized to
// {source: resource, target: concept} regardless of the edge's own
// source/target order.
{
  const nodes = [node("work:1", "work"), node("concept:1", "concept")];
  const forward = computeConceptAttractionPairs(nodes, [{ source: "work:1", target: "concept:1" }]);
  assert.deepEqual(forward, [{ source: "work:1", target: "concept:1" }]);
  const reversed = computeConceptAttractionPairs(nodes, [{ source: "concept:1", target: "work:1" }]);
  assert.deepEqual(reversed, [{ source: "work:1", target: "concept:1" }], "normalized to {source: resource, target: concept} regardless of the edge's own direction");
}

// Every resource type counts (work/reference/peer_reviewed_source/online_source).
{
  const nodes = [
    node("reference:1", "reference"),
    node("peer_reviewed_source:1", "peer_reviewed_source"),
    node("online_source:1", "online_source"),
    node("concept:1", "concept"),
  ];
  const links = [
    { source: "reference:1", target: "concept:1" },
    { source: "peer_reviewed_source:1", target: "concept:1" },
    { source: "online_source:1", target: "concept:1" },
  ];
  const pairs = computeConceptAttractionPairs(nodes, links);
  assert.equal(pairs.length, 3);
}

// Concept-to-concept, person-to-concept, and resource-to-resource edges are
// all excluded -- only resource<->concept pairs qualify.
{
  const nodes = [
    node("concept:1", "concept"),
    node("concept:2", "concept"),
    node("person:1", "person"),
    node("work:1", "work"),
    node("work:2", "work"),
  ];
  const links = [
    { source: "concept:1", target: "concept:2" },
    { source: "person:1", target: "concept:1" },
    { source: "work:1", target: "work:2" },
  ];
  assert.deepEqual(computeConceptAttractionPairs(nodes, links), []);
}

// A GraphLink's source/target can already be a live node OBJECT (the same
// shape react-force-graph-3d mutates it into once the simulation runs) --
// the endpoint-normalization helper must handle both string ids and
// {id: string} objects, matching every other endpoint-id helper in this
// component family.
{
  const nodes = [node("work:1", "work"), node("concept:1", "concept")];
  // Cast needed: `GraphLink.source`/`target` are TYPED as plain `string`
  // (react-force-graph-3d's runtime mutation into `{id}` objects isn't
  // reflected in the contract type — same tolerated gap
  // `KnowledgeGraph3D.tsx`'s own `endpointId()` helper works around with an
  // `as GraphLink` cast at its call sites, never a raw literal like this).
  const objectShapedLink = { source: { id: "work:1" }, target: { id: "concept:1" } } as unknown as { source: string; target: string };
  const pairs = computeConceptAttractionPairs(nodes, [objectShapedLink]);
  assert.deepEqual(pairs, [{ source: "work:1", target: "concept:1" }]);
}

// An edge referencing an id absent from `nodes` (should never happen in a
// real filtered payload, but defensive) is skipped rather than throwing or
// producing a pair with an undefined type.
{
  const nodes = [node("work:1", "work")];
  const pairs = computeConceptAttractionPairs(nodes, [{ source: "work:1", target: "concept:missing" }]);
  assert.deepEqual(pairs, []);
}

// Empty input -> empty output, never throws.
assert.deepEqual(computeConceptAttractionPairs([], []), []);

// Strength is genuinely "mild" -- noticeably weaker than a full link force
// (1.0) or even a typical default (~1/min(deg)), never zero (that would be
// no force at all, contradicting "mild attraction").
assert.ok(CONCEPT_ATTRACTION_STRENGTH > 0 && CONCEPT_ATTRACTION_STRENGTH < 0.2);

console.log("graphForces.test.ts: all assertions passed");
