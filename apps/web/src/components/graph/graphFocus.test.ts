import assert from "node:assert/strict";
import {
  buildNodeAdjacency,
  computeFocusEmphasis,
  connectedNodeIds,
  emphasisStateForNode,
  EMPTY_FOCUS_EMPHASIS,
} from "./graphFocus";
import type { GraphData, GraphLink, GraphNode } from "./types";

/**
 * Phase 21.6 (D-21-2) regression. Pure decision logic only — no WebGL, no
 * force-layout, no DB — run via `pnpm --filter worker exec tsx
 * <absolute-path>` (same convention as `graphSceneScaling.test.ts`).
 *
 * Fixture: work -> bib (cites), work -> concept (presupposes),
 * work -> section (outline_section) — the exact shape
 * `seedWorkWithGraphData()` produces, so `bib`/`concept`/`section` are each
 * one hop from `work` and NOT connected to each other. Selecting `bib`
 * therefore has exactly one one-hop neighbor (`work`) and two genuinely
 * unrelated nodes (`concept`, `section`) — the shape needed to prove fade
 * actually excludes something, not just that everything stays lit.
 */

function node(id: string, label: string): GraphNode {
  return {
    id,
    label,
    type: "reference",
    state: "unread",
    uploaded: false,
    associatedWorkIds: [],
    destination: null,
    authors: null,
    year: null,
    url: null,
  };
}

function link(id: string, source: string, target: string, edgeType: string): GraphLink {
  return { id, source, target, edgeType, directed: true, associatedWorkIds: [], category: null, confidence: 0.8 };
}

const data: Pick<GraphData, "nodes" | "links"> = {
  nodes: [node("work:1", "On the Soul"), node("external:bib:1", "Physics"), node("concept:1", "Hylomorphism"), node("section:1", "Book II")],
  links: [
    link("l1", "work:1", "external:bib:1", "cites"),
    link("l2", "work:1", "concept:1", "presupposes"),
    link("l3", "work:1", "section:1", "outline_section"),
  ],
};

// --- buildNodeAdjacency --------------------------------------------------

{
  const adjacency = buildNodeAdjacency(data.links);
  assert.deepEqual([...(adjacency.get("work:1") ?? [])].sort(), ["concept:1", "external:bib:1", "section:1"]);
  assert.deepEqual([...(adjacency.get("external:bib:1") ?? [])], ["work:1"]);
  assert.equal(adjacency.get("concept:1")?.size, 1);
  assert.equal(adjacency.has("nonexistent"), false, "a node with no edges has no adjacency entry at all");
}

// --- computeFocusEmphasis: no selection / full mode ----------------------

{
  assert.deepEqual(computeFocusEmphasis(data, null, "focus"), EMPTY_FOCUS_EMPHASIS, "no selection -> no emphasis regardless of mode");
  assert.deepEqual(computeFocusEmphasis(data, undefined, "expand"), EMPTY_FOCUS_EMPHASIS);
  assert.deepEqual(computeFocusEmphasis(data, "external:bib:1", "full"), EMPTY_FOCUS_EMPHASIS, "'full' mode always returns empty, even with a real selection");
  assert.deepEqual(computeFocusEmphasis(data, "nonexistent-id", "focus"), EMPTY_FOCUS_EMPHASIS, "a selection that doesn't exist in the data degrades to empty, not a ghost focus");
}

// --- computeFocusEmphasis: "focus" mode (one hop) ------------------------

{
  const emphasis = computeFocusEmphasis(data, "external:bib:1", "focus");
  assert.deepEqual([...emphasis.emphasizedNodeIds].sort(), ["external:bib:1", "work:1"]);
  assert.deepEqual([...emphasis.dimmedNodeIds].sort(), ["concept:1", "section:1"], "concept and section are NOT neighbors of bib, so they fade");
  assert.deepEqual([...emphasis.emphasizedLinkIds], ["l1"], "only the cites edge has both endpoints emphasized");
}

// --- computeFocusEmphasis: "expand" mode (two hops) ----------------------

{
  const emphasis = computeFocusEmphasis(data, "external:bib:1", "expand");
  assert.deepEqual(
    [...emphasis.emphasizedNodeIds].sort(),
    ["concept:1", "external:bib:1", "section:1", "work:1"],
    "expand reaches work's other one-hop neighbors too (concept, section)",
  );
  assert.deepEqual([...emphasis.dimmedNodeIds], [], "nothing left to dim once every node is within two hops");
  assert.deepEqual([...emphasis.emphasizedLinkIds].sort(), ["l1", "l2", "l3"], "every edge now has both endpoints emphasized");
}

// --- emphasisStateForNode -------------------------------------------------

{
  const emphasis = computeFocusEmphasis(data, "external:bib:1", "focus");
  assert.equal(emphasisStateForNode("external:bib:1", "external:bib:1", emphasis), "selected");
  assert.equal(emphasisStateForNode("work:1", "external:bib:1", emphasis), "neighbor");
  assert.equal(emphasisStateForNode("concept:1", "external:bib:1", emphasis), "dimmed");
  // "full" mode (or no selection): every node reports "none", even the
  // literally-selected one — data-selected and data-emphasis are two
  // different signals, not the same fact twice.
  const noFocus = computeFocusEmphasis(data, "external:bib:1", "full");
  assert.equal(emphasisStateForNode("external:bib:1", "external:bib:1", noFocus), "none");
  assert.equal(emphasisStateForNode("external:bib:1", null, EMPTY_FOCUS_EMPHASIS), "none");
}

// --- connectedNodeIds: deterministic label-sorted order -------------------

{
  // "Book II" < "Hylomorphism" < "Physics" alphabetically.
  assert.deepEqual(connectedNodeIds(data, "work:1"), ["section:1", "concept:1", "external:bib:1"]);
  assert.deepEqual(connectedNodeIds(data, "external:bib:1"), ["work:1"]);
  assert.deepEqual(connectedNodeIds(data, "nonexistent-id"), [], "an id with no adjacency entry returns an empty list, not a crash");
}

// --- connectedNodeIds: tie-break by id when labels collide -----------------

{
  const tieData: Pick<GraphData, "nodes" | "links"> = {
    nodes: [node("hub", "Hub"), node("b-node", "Same label"), node("a-node", "Same label")],
    links: [link("t1", "hub", "b-node", "cites"), link("t2", "hub", "a-node", "cites")],
  };
  assert.deepEqual(connectedNodeIds(tieData, "hub"), ["a-node", "b-node"], "equal labels tie-break by id, not by insertion/Set-iteration order");
}

console.log("graphFocus.test.ts: all assertions passed");
