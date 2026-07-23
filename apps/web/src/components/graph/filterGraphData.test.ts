import assert from "node:assert/strict";
import { DEFAULT_GRAPH_FILTERS, filterGraphData, isDefaultFilters, type GraphData, type GraphFilters, type GraphNode } from "./types";

/**
 * Phase 21.3 regression coverage for `filterGraphData` — the ONE filtering
 * function both the 3D scene and the accessible table consume (plan §34.4
 * 9.7, §21.1). No unit test existed for this function before this file
 * (the audit's D-21-1 finding called that out explicitly); these assertions
 * pin down the edge-level relation filter (D-21-1), the uploaded-work
 * default-visibility exemption and its one deliberate exception (D-21-10),
 * that filters never mutate the source `GraphData` object, and
 * `isDefaultFilters` (backs the new "Clear all filters" control). Run via
 * `pnpm --filter web exec tsx apps/web/src/components/graph/filterGraphData.test.ts`
 * — same tsx-invocation precedent as `edgeTypeForRelationshipCategory.test.ts`
 * (no vitest wiring exists under `apps/web`, see that file's own comment).
 */

function node(overrides: Partial<GraphNode> & Pick<GraphNode, "id" | "type" | "uploaded" | "associatedWorkIds">): GraphNode {
  return {
    label: overrides.id,
    state: "unread",
    destination: null,
    authors: null,
    year: null,
    url: null,
    authority: null,
    provider: null,
    providers: [],
    ...overrides,
  };
}

const fixture: GraphData = {
  title: "Fixture",
  stats: { works: 2, references: 1, sources: 0, concepts: 1, people: 0, missing: 1, read: 0 },
  nodes: [
    node({ id: "work:1", type: "work", state: "primary", uploaded: true, associatedWorkIds: ["work:1"] }),
    node({ id: "work:2", type: "work", state: "primary", uploaded: true, associatedWorkIds: ["work:2"] }),
    node({ id: "external:bib:1", type: "reference", state: "missing", uploaded: false, associatedWorkIds: ["work:1"], authority: "A", provider: "crossref", providers: ["crossref"] }),
    node({ id: "concept:1", type: "concept", state: "unread", uploaded: false, associatedWorkIds: ["work:1"] }),
  ],
  links: [
    // D-21-1 fixture: TWO edges of different types between the same pair.
    { id: "l1", source: "work:1", target: "external:bib:1", edgeType: "cites", directed: true, associatedWorkIds: ["work:1"], category: null, confidence: 0.9 },
    { id: "l2", source: "work:1", target: "external:bib:1", edgeType: "influences", directed: true, associatedWorkIds: ["work:1"], category: null, confidence: 0.5 },
    { id: "l3", source: "work:1", target: "concept:1", edgeType: "presupposes", directed: true, associatedWorkIds: ["work:1"], category: null, confidence: 0.7 },
  ],
};

const ids = (data: GraphData) => new Set(data.nodes.map((n) => n.id));
const linkIds = (data: GraphData) => new Set(data.links.map((l) => l.id));

function filters(overrides: Partial<GraphFilters>): GraphFilters {
  return { ...DEFAULT_GRAPH_FILTERS, ...overrides };
}

// --- D-21-1: relation filter hides non-matching EDGES, not just nodes ---
{
  const result = filterGraphData(fixture, filters({ relation: "cites" }));
  assert.deepEqual(ids(result), new Set(["work:1", "work:2", "external:bib:1"]), "cites: work anchors stay visible (D-21-10), concept has no cites edge");
  assert.deepEqual(linkIds(result), new Set(["l1"]), "cites: only the cites edge itself may survive, not the co-located influences edge");
}
{
  const result = filterGraphData(fixture, filters({ relation: "presupposes" }));
  assert.deepEqual(ids(result), new Set(["work:1", "work:2", "concept:1"]), "presupposes: bib node has no presupposes edge and is not uploaded, so it drops");
  assert.deepEqual(linkIds(result), new Set(["l3"]), "presupposes: only l3 survives");
}

// --- D-21-10: uploaded-work anchors are exempt from attribute filters ---
{
  const result = filterGraphData(fixture, filters({ type: "concept" }));
  assert.deepEqual(ids(result), new Set(["work:1", "work:2", "concept:1"]), "type=concept: both uploaded works stay visible by default, bib (type=reference) does not");
}

// --- associatedWork is the one filter that CAN scope out an uploaded work ---
{
  const result = filterGraphData(fixture, filters({ associatedWork: "work:1" }));
  assert.deepEqual(ids(result), new Set(["work:1", "external:bib:1", "concept:1"]), "associatedWork=work:1 scopes out work:2, unlike every other attribute filter");
}

// --- explicit pinning overrides even the associatedWork scoping filter ---
{
  const result = filterGraphData(fixture, filters({ associatedWork: "work:1" }), ["work:2"]);
  assert.ok(ids(result).has("work:2"), "pinning work:2 must override the associatedWork scoping filter that would otherwise exclude it");
}

// --- filters never mutate source data ---
{
  const frozenNodes = fixture.nodes.map((n) => Object.freeze({ ...n }));
  const frozenLinks = fixture.links.map((l) => Object.freeze({ ...l }));
  const frozen = Object.freeze({ ...fixture, nodes: Object.freeze(frozenNodes), links: Object.freeze(frozenLinks) }) as unknown as GraphData;
  const result = filterGraphData(frozen, filters({ relation: "cites" }));
  assert.notEqual(result, frozen, "filterGraphData must return a new object, not the same reference");
  assert.notEqual(result.nodes, frozen.nodes, "filterGraphData must return a new nodes array");
  assert.notEqual(result.links, frozen.links, "filterGraphData must return a new links array");
  assert.equal(frozen.nodes.length, 4, "the frozen source node list must be untouched");
  assert.equal(frozen.links.length, 3, "the frozen source link list must be untouched");
}

// --- isDefaultFilters backs the "Clear all filters" disabled state ---
assert.equal(isDefaultFilters(DEFAULT_GRAPH_FILTERS), true);
assert.equal(isDefaultFilters(filters({ relation: "cites" })), false);
assert.equal(isDefaultFilters({ ...DEFAULT_GRAPH_FILTERS, search: "" }), true, "an unchanged empty search string is still the default");

console.log("filterGraphData.test.ts: all assertions passed");
