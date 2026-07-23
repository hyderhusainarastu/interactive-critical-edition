import assert from "node:assert/strict";
import { DEFAULT_GRAPH_FILTERS, filterGraphData, isDefaultFilters, roadmapSubset, type GraphData, type GraphFilters, type GraphNode, type RoadmapAnnotation } from "./types";

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

// ============================================================================
// Phase 22.7 (feature plan §2.2/§5 Feature A): the roadmap `stage` filter, the
// `roadmapSubset` derivation, and the annotation-free byte-identity guarantee.
// ============================================================================

// --- byte-identity regression: the new `stage` field, at its "all" default,
//     leaves an annotation-free payload filtered EXACTLY as before it existed.
{
  const result = filterGraphData(fixture, DEFAULT_GRAPH_FILTERS);
  assert.deepEqual(result.nodes, fixture.nodes, "default filters must return every node unchanged (byte-identical)");
  assert.deepEqual(result.links, fixture.links, "default filters must return every link unchanged (byte-identical)");
  // stage is a no-op regardless of how it's spelled at the default.
  assert.deepEqual(ids(filterGraphData(fixture, filters({ stage: "all" }))), ids(fixture), "stage=all is a no-op on annotation-free payloads");
  assert.deepEqual(linkIds(filterGraphData(fixture, filters({ stage: "all" }))), linkIds(fixture));
}

function ann(overrides: Partial<RoadmapAnnotation>): RoadmapAnnotation {
  return {
    stage: "prerequisites",
    tier: "essential",
    sequence: 1,
    known: false,
    reason: "",
    checkpoint: "",
    category: "prerequisite",
    confidence: 0.9,
    estimatedMinutes: 600,
    addedManually: false,
    overridden: false,
    rootWorkIds: ["work:1"],
    ...overrides,
  };
}

const roadmapFixture: GraphData = {
  title: "Roadmap fixture",
  stats: { works: 1, references: 2, sources: 0, concepts: 1, people: 0, missing: 0, read: 0 },
  nodes: [
    node({ id: "work:1", type: "work", state: "primary", uploaded: true, associatedWorkIds: ["work:1"] }),
    node({ id: "external:bib:1", type: "reference", state: "unread", uploaded: false, associatedWorkIds: ["work:1"], roadmap: ann({ stage: "prerequisites", tier: "essential", sequence: 1 }) }),
    node({ id: "external:bib:2", type: "reference", state: "unread", uploaded: false, associatedWorkIds: ["work:1"], roadmap: ann({ stage: "extension", tier: "optional", sequence: 2, category: "optional_extension" }) }),
    node({ id: "concept:1", type: "concept", state: "unread", uploaded: false, associatedWorkIds: ["work:1"] }),
  ],
  links: [
    { id: "la", source: "work:1", target: "external:bib:1", edgeType: "is_prerequisite_for", directed: true, associatedWorkIds: ["work:1"], category: null, confidence: 0.9 },
    { id: "lb", source: "work:1", target: "external:bib:2", edgeType: "is_recommended_by", directed: true, associatedWorkIds: ["work:1"], category: null, confidence: 0.6 },
    { id: "lc", source: "work:1", target: "concept:1", edgeType: "presupposes", directed: true, associatedWorkIds: ["work:1"], category: null, confidence: 0.7 },
  ],
};

// --- stage filter: keeps only the matching stage's annotated nodes; uploaded
//     anchors stay (D-21-10); unannotated nodes (concept) drop. ---
{
  const result = filterGraphData(roadmapFixture, filters({ stage: "prerequisites" }));
  assert.deepEqual(ids(result), new Set(["work:1", "external:bib:1"]), "stage=prerequisites: anchor exempt, bib:1 matches, bib:2 (extension) + concept (no roadmap) drop");
  assert.deepEqual(linkIds(result), new Set(["la"]), "only the edge between two visible nodes survives");
}
{
  const result = filterGraphData(roadmapFixture, filters({ stage: "extension" }));
  assert.deepEqual(ids(result), new Set(["work:1", "external:bib:2"]), "stage=extension keeps bib:2, drops bib:1 (prerequisites)");
}

// --- stage filter composes with D-21-1 edge-level relation filter unchanged ---
{
  const result = filterGraphData(roadmapFixture, filters({ stage: "prerequisites", relation: "is_prerequisite_for" }));
  assert.deepEqual(ids(result), new Set(["work:1", "external:bib:1"]), "stage AND relation both narrow (AND semantics)");
  assert.deepEqual(linkIds(result), new Set(["la"]), "D-21-1: the edge must itself match the relation, even with a stage filter active");
}

// --- an unannotated non-anchor node never survives a concrete stage filter ---
{
  const result = filterGraphData(roadmapFixture, filters({ stage: "core_engagement" }));
  assert.deepEqual(ids(result), new Set(["work:1"]), "no node has the core_engagement stage; only the anchor remains");
  assert.deepEqual(linkIds(result), new Set([]), "no visible reference/concept endpoints ⇒ no links");
}

// --- roadmapSubset: keeps annotated + uploaded, drops explore-only concepts ---
{
  const subset = roadmapSubset(roadmapFixture);
  assert.deepEqual(ids(subset), new Set(["work:1", "external:bib:1", "external:bib:2"]), "roadmapSubset keeps the anchor + both annotated bibs, drops the concept (explore-only)");
  assert.deepEqual(linkIds(subset), new Set(["la", "lb"]), "the dangling link to the dropped concept is removed");
  assert.notEqual(subset, roadmapFixture, "roadmapSubset returns a new object");
  assert.notEqual(subset.nodes, roadmapFixture.nodes, "roadmapSubset returns a new nodes array");
  assert.equal(roadmapFixture.nodes.length, 4, "roadmapSubset must not mutate its input");
}

// --- roadmapSubset on an annotation-free payload keeps exactly the uploaded works ---
{
  const subset = roadmapSubset(fixture);
  assert.deepEqual(ids(subset), new Set(["work:1", "work:2"]), "with no annotations, roadmapSubset keeps only the uploaded-work anchors");
}

console.log("filterGraphData.test.ts: all assertions passed");
