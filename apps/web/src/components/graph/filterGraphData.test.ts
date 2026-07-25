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

// ============================================================================
// Graph P1 (data contract v2, additive): readerLevel/conceptKind filter
// semantics and alias search. Links are deliberately empty here — none of
// these predicates are edge-dependent, so node visibility alone is enough to
// pin the behavior down.
// ============================================================================

const p1Fixture: GraphData = {
  title: "Graph P1 fixture",
  stats: { works: 1, references: 5, sources: 0, concepts: 3, people: 1, missing: 0, read: 0 },
  nodes: [
    node({ id: "work:1", type: "work", state: "primary", uploaded: true, associatedWorkIds: ["work:1"] }),
    // readerLevels coverage: a single level, "all levels" (as a null-level
    // resource_role role would expand to per graph.ts), a "research"-only
    // node, and one with no readerLevels data at all.
    node({ id: "external:bib:10", type: "reference", uploaded: false, associatedWorkIds: ["work:1"], readerLevels: ["undergraduate"] }),
    node({ id: "external:bib:11", type: "reference", uploaded: false, associatedWorkIds: ["work:1"], readerLevels: ["beginner", "undergraduate", "advanced", "research"] }),
    node({ id: "external:bib:14", type: "reference", uploaded: false, associatedWorkIds: ["work:1"], readerLevels: ["research"] }),
    node({ id: "external:bib:12", type: "reference", uploaded: false, associatedWorkIds: ["work:1"] }),
    // conceptKind coverage: two concept-kind nodes, one person-kind node, and
    // a reference whose OWN `kind` (resource_type) must never be mistaken
    // for a concept kind.
    node({ id: "concept:1", type: "concept", uploaded: false, associatedWorkIds: ["work:1"], kind: "doctrine" }),
    node({ id: "concept:2", type: "concept", uploaded: false, associatedWorkIds: ["work:1"], kind: "tradition" }),
    node({ id: "person:1", type: "person", uploaded: false, associatedWorkIds: ["work:1"], kind: "person" }),
    node({ id: "external:bib:13", type: "reference", uploaded: false, associatedWorkIds: ["work:1"], kind: "webpage" }),
    // alias search coverage: label alone would never match "akrasia".
    node({ id: "concept:3", type: "concept", uploaded: false, associatedWorkIds: ["work:1"], kind: "concept", label: "Weakness of will", aliases: ["akrasia"] }),
  ],
  links: [],
};

// --- readerLevel: cumulative matching, "all levels" always matches, missing
//     data is never punished, uploaded anchor stays exempt ---
{
  const result = filterGraphData(p1Fixture, filters({ readerLevel: "undergraduate" }));
  const resultIds = ids(result);
  assert.ok(resultIds.has("external:bib:10"), "an undergraduate-scoped node matches an undergraduate filter");
  assert.ok(resultIds.has("external:bib:11"), "a node whose readerLevels covers every level (a null-level role, per graph.ts) matches any selected level");
  assert.ok(resultIds.has("external:bib:12"), "a node with no readerLevels data at all is never punished — it always matches");
  assert.ok(resultIds.has("work:1"), "the uploaded anchor stays visible regardless (D-21-10)");
  assert.ok(!resultIds.has("external:bib:14"), "a node scoped only to 'research' does not match an 'undergraduate' filter (cumulative semantics exclude higher levels)");
}
{
  const result = filterGraphData(p1Fixture, filters({ readerLevel: "research" }));
  assert.ok(ids(result).has("external:bib:14"), "the same 'research'-only node matches a 'research' filter (cumulative includes the exact level)");
}
{
  const result = filterGraphData(p1Fixture, filters({ readerLevel: "all" }));
  assert.deepEqual(ids(result), ids(p1Fixture), "readerLevel=all is a no-op");
}

// --- conceptKind: narrows only concept/person-typed nodes; every other type
//     is exempt (never punish missing data), and a node's own unrelated
//     `kind` (resource_type) is never mismatched against it ---
{
  const result = filterGraphData(p1Fixture, filters({ conceptKind: "doctrine" }));
  const resultIds = ids(result);
  assert.ok(resultIds.has("concept:1"), "a doctrine-kind concept matches");
  assert.ok(!resultIds.has("concept:2"), "a tradition-kind concept is excluded");
  assert.ok(!resultIds.has("person:1"), "a person-kind node ('person' !== 'doctrine') is excluded");
  assert.ok(resultIds.has("external:bib:10"), "non-concept/person node types stay exempt from conceptKind entirely");
  assert.ok(resultIds.has("external:bib:13"), "a reference's own unrelated `kind` (resource_type 'webpage') is never matched against conceptKind");
  assert.ok(resultIds.has("work:1"), "the uploaded anchor stays visible (D-21-10)");
}
{
  const result = filterGraphData(p1Fixture, filters({ conceptKind: "all" }));
  assert.deepEqual(ids(result), ids(p1Fixture), "conceptKind=all is a no-op");
}

// --- search extends over aliases ---
{
  const result = filterGraphData(p1Fixture, filters({ search: "akrasia" }));
  const resultIds = ids(result);
  assert.ok(resultIds.has("concept:3"), "search matches an alias even though the label itself doesn't contain the term");
  assert.ok(!resultIds.has("concept:1"), "a node with no matching alias/label/authors/kind is excluded");
  assert.ok(resultIds.has("work:1"), "the uploaded anchor stays visible under search too (D-21-10)");
}

// --- byte-identity: default filters (now including readerLevel/conceptKind
//     at "all") still return this payload completely unchanged ---
{
  const result = filterGraphData(p1Fixture, DEFAULT_GRAPH_FILTERS);
  assert.deepEqual(result.nodes, p1Fixture.nodes, "default filters leave the Graph P1 fixture byte-identical");
}

console.log("filterGraphData.test.ts: all assertions passed");
