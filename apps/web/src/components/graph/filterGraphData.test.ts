import { describe, expect, it } from "vitest";
import { DEFAULT_GRAPH_FILTERS, filterGraphData, isDefaultFilters, roadmapSubset } from "./filterGraphData";
import type { GraphData, GraphFilters, GraphNode, RoadmapAnnotation } from "./types";

/**
 * Phase 21.3 regression coverage for `filterGraphData` — the ONE filtering
 * function both the 3D scene and the accessible table consume (plan §34.4
 * 9.7, §21.1). No unit test existed for this function before this file
 * (the audit's D-21-1 finding called that out explicitly); these assertions
 * pin down the edge-level relation filter (D-21-1), the uploaded-work
 * default-visibility exemption and its one deliberate exception (D-21-10),
 * that filters never mutate the source `GraphData` object, and
 * `isDefaultFilters` (backs the new "Clear all filters" control).
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

describe("filterGraphData", () => {
  // --- D-21-1: relation filter hides non-matching EDGES, not just nodes ---
  it("D-21-1: a relation filter hides non-matching EDGES, not just nodes (cites)", () => {
    const result = filterGraphData(fixture, filters({ relation: "cites" }));
    // "cites: work anchors stay visible (D-21-10), concept has no cites edge"
    expect(ids(result)).toEqual(new Set(["work:1", "work:2", "external:bib:1"]));
    // "cites: only the cites edge itself may survive, not the co-located influences edge"
    expect(linkIds(result)).toEqual(new Set(["l1"]));
  });

  it("D-21-1: a relation filter hides non-matching EDGES, not just nodes (presupposes)", () => {
    const result = filterGraphData(fixture, filters({ relation: "presupposes" }));
    // "presupposes: bib node has no presupposes edge and is not uploaded, so it drops"
    expect(ids(result)).toEqual(new Set(["work:1", "work:2", "concept:1"]));
    // "presupposes: only l3 survives"
    expect(linkIds(result)).toEqual(new Set(["l3"]));
  });

  // --- D-21-10: uploaded-work anchors are exempt from attribute filters ---
  it("D-21-10: uploaded-work anchors are exempt from attribute filters", () => {
    const result = filterGraphData(fixture, filters({ type: "concept" }));
    // "type=concept: both uploaded works stay visible by default, bib (type=reference) does not"
    expect(ids(result)).toEqual(new Set(["work:1", "work:2", "concept:1"]));
  });

  // --- associatedWork is the one filter that CAN scope out an uploaded work ---
  it("associatedWork is the one filter that CAN scope out an uploaded work", () => {
    const result = filterGraphData(fixture, filters({ associatedWork: "work:1" }));
    // "associatedWork=work:1 scopes out work:2, unlike every other attribute filter"
    expect(ids(result)).toEqual(new Set(["work:1", "external:bib:1", "concept:1"]));
  });

  // --- explicit pinning overrides even the associatedWork scoping filter ---
  it("explicit pinning overrides even the associatedWork scoping filter", () => {
    const result = filterGraphData(fixture, filters({ associatedWork: "work:1" }), ["work:2"]);
    // "pinning work:2 must override the associatedWork scoping filter that would otherwise exclude it"
    expect(ids(result).has("work:2")).toBeTruthy();
  });

  // --- filters never mutate source data ---
  it("filters never mutate source data", () => {
    const frozenNodes = fixture.nodes.map((n) => Object.freeze({ ...n }));
    const frozenLinks = fixture.links.map((l) => Object.freeze({ ...l }));
    const frozen = Object.freeze({ ...fixture, nodes: Object.freeze(frozenNodes), links: Object.freeze(frozenLinks) }) as unknown as GraphData;
    const result = filterGraphData(frozen, filters({ relation: "cites" }));
    // "filterGraphData must return a new object, not the same reference"
    expect(result).not.toBe(frozen);
    // "filterGraphData must return a new nodes array"
    expect(result.nodes).not.toBe(frozen.nodes);
    // "filterGraphData must return a new links array"
    expect(result.links).not.toBe(frozen.links);
    // "the frozen source node list must be untouched"
    expect(frozen.nodes.length).toBe(4);
    // "the frozen source link list must be untouched"
    expect(frozen.links.length).toBe(3);
  });

  // --- isDefaultFilters backs the "Clear all filters" disabled state ---
  it('isDefaultFilters backs the "Clear all filters" disabled state', () => {
    expect(isDefaultFilters(DEFAULT_GRAPH_FILTERS)).toBe(true);
    expect(isDefaultFilters(filters({ relation: "cites" }))).toBe(false);
    // "an unchanged empty search string is still the default"
    expect(isDefaultFilters({ ...DEFAULT_GRAPH_FILTERS, search: "" })).toBe(true);
  });

  // ==========================================================================
  // Phase 22.7 (feature plan §2.2/§5 Feature A): the roadmap `stage` filter,
  // the `roadmapSubset` derivation, and the annotation-free byte-identity
  // guarantee.
  // ==========================================================================

  // --- byte-identity regression: the new `stage` field, at its "all" default,
  //     leaves an annotation-free payload filtered EXACTLY as before it existed.
  it('byte-identity regression: the new `stage` field at its "all" default leaves an annotation-free payload filtered exactly as before it existed', () => {
    const result = filterGraphData(fixture, DEFAULT_GRAPH_FILTERS);
    // "default filters must return every node unchanged (byte-identical)"
    expect(result.nodes).toEqual(fixture.nodes);
    // "default filters must return every link unchanged (byte-identical)"
    expect(result.links).toEqual(fixture.links);
    // stage is a no-op regardless of how it's spelled at the default.
    // "stage=all is a no-op on annotation-free payloads"
    expect(ids(filterGraphData(fixture, filters({ stage: "all" })))).toEqual(ids(fixture));
    expect(linkIds(filterGraphData(fixture, filters({ stage: "all" })))).toEqual(linkIds(fixture));
  });

  // --- stage filter: keeps only the matching stage's annotated nodes; uploaded
  //     anchors stay (D-21-10); unannotated nodes (concept) drop. ---
  it("stage filter keeps only the matching stage's annotated nodes; uploaded anchors stay (D-21-10); unannotated nodes drop", () => {
    const result = filterGraphData(roadmapFixture, filters({ stage: "prerequisites" }));
    // "stage=prerequisites: anchor exempt, bib:1 matches, bib:2 (extension) + concept (no roadmap) drop"
    expect(ids(result)).toEqual(new Set(["work:1", "external:bib:1"]));
    // "only the edge between two visible nodes survives"
    expect(linkIds(result)).toEqual(new Set(["la"]));
  });

  it("stage=extension keeps bib:2, drops bib:1 (prerequisites)", () => {
    const result = filterGraphData(roadmapFixture, filters({ stage: "extension" }));
    expect(ids(result)).toEqual(new Set(["work:1", "external:bib:2"]));
  });

  // --- stage filter composes with D-21-1 edge-level relation filter unchanged ---
  it("stage filter composes with the D-21-1 edge-level relation filter unchanged", () => {
    const result = filterGraphData(roadmapFixture, filters({ stage: "prerequisites", relation: "is_prerequisite_for" }));
    // "stage AND relation both narrow (AND semantics)"
    expect(ids(result)).toEqual(new Set(["work:1", "external:bib:1"]));
    // "D-21-1: the edge must itself match the relation, even with a stage filter active"
    expect(linkIds(result)).toEqual(new Set(["la"]));
  });

  // --- an unannotated non-anchor node never survives a concrete stage filter ---
  it("an unannotated non-anchor node never survives a concrete stage filter", () => {
    const result = filterGraphData(roadmapFixture, filters({ stage: "core_engagement" }));
    // "no node has the core_engagement stage; only the anchor remains"
    expect(ids(result)).toEqual(new Set(["work:1"]));
    // "no visible reference/concept endpoints ⇒ no links"
    expect(linkIds(result)).toEqual(new Set([]));
  });

  // --- roadmapSubset: keeps annotated + uploaded, drops explore-only concepts ---
  it("roadmapSubset keeps annotated + uploaded nodes and drops explore-only concepts", () => {
    const subset = roadmapSubset(roadmapFixture);
    // "roadmapSubset keeps the anchor + both annotated bibs, drops the concept (explore-only)"
    expect(ids(subset)).toEqual(new Set(["work:1", "external:bib:1", "external:bib:2"]));
    // "the dangling link to the dropped concept is removed"
    expect(linkIds(subset)).toEqual(new Set(["la", "lb"]));
    // "roadmapSubset returns a new object"
    expect(subset).not.toBe(roadmapFixture);
    // "roadmapSubset returns a new nodes array"
    expect(subset.nodes).not.toBe(roadmapFixture.nodes);
    // "roadmapSubset must not mutate its input"
    expect(roadmapFixture.nodes.length).toBe(4);
  });

  // --- roadmapSubset on an annotation-free payload keeps exactly the uploaded works ---
  it("roadmapSubset on an annotation-free payload keeps exactly the uploaded works", () => {
    const subset = roadmapSubset(fixture);
    // "with no annotations, roadmapSubset keeps only the uploaded-work anchors"
    expect(ids(subset)).toEqual(new Set(["work:1", "work:2"]));
  });

  // ==========================================================================
  // Graph P1 (data contract v2, additive): readerLevel/conceptKind filter
  // semantics and alias search. Links are deliberately empty here — none of
  // these predicates are edge-dependent, so node visibility alone is enough to
  // pin the behavior down.
  // ==========================================================================

  // --- readerLevel: mutually exclusive exact-band matching (owner directive
  //     2026-07-26), "all levels" always matches, missing data is never
  //     punished, uploaded anchor stays exempt ---
  it('readerLevel uses mutually exclusive exact-band matching, "all levels" always matches, missing data is never punished, and the uploaded anchor stays exempt', () => {
    const result = filterGraphData(p1Fixture, filters({ readerLevel: "undergraduate" }));
    const resultIds = ids(result);
    // "an undergraduate-scoped node matches an undergraduate filter"
    expect(resultIds.has("external:bib:10")).toBeTruthy();
    // "a node whose readerLevels covers every level (a null-level role, per graph.ts) matches any selected level"
    expect(resultIds.has("external:bib:11")).toBeTruthy();
    // "a node with no readerLevels data at all is never punished — it always matches"
    expect(resultIds.has("external:bib:12")).toBeTruthy();
    // "the uploaded anchor stays visible regardless (D-21-10)"
    expect(resultIds.has("work:1")).toBeTruthy();
    // "a node scoped only to 'research' does not match an 'undergraduate' filter (mutually exclusive bands exclude every other level, higher or lower)"
    expect(!resultIds.has("external:bib:14")).toBeTruthy();
  });

  it("readerLevel bands are cross-band exclusive, not a cumulative union", () => {
    const result = filterGraphData(p1Fixture, filters({ readerLevel: "research" }));
    // "the same 'research'-only node matches a 'research' filter (its own exact level)"
    expect(ids(result).has("external:bib:14")).toBeTruthy();
    // "cross-band exclusion: the undergraduate-only node does NOT match a 'research' filter (no cumulative union)"
    expect(!ids(result).has("external:bib:10")).toBeTruthy();
  });

  it("readerLevel=all is a no-op", () => {
    const result = filterGraphData(p1Fixture, filters({ readerLevel: "all" }));
    expect(ids(result)).toEqual(ids(p1Fixture));
  });

  // --- conceptKind: narrows only concept/person-typed nodes; every other type
  //     is exempt (never punish missing data), and a node's own unrelated
  //     `kind` (resource_type) is never mismatched against it ---
  it("conceptKind narrows only concept/person-typed nodes, and a node's own unrelated `kind` (resource_type) is never mismatched against it", () => {
    const result = filterGraphData(p1Fixture, filters({ conceptKind: "doctrine" }));
    const resultIds = ids(result);
    // "a doctrine-kind concept matches"
    expect(resultIds.has("concept:1")).toBeTruthy();
    // "a tradition-kind concept is excluded"
    expect(!resultIds.has("concept:2")).toBeTruthy();
    // "a person-kind node ('person' !== 'doctrine') is excluded"
    expect(!resultIds.has("person:1")).toBeTruthy();
    // "non-concept/person node types stay exempt from conceptKind entirely"
    expect(resultIds.has("external:bib:10")).toBeTruthy();
    // "a reference's own unrelated `kind` (resource_type 'webpage') is never matched against conceptKind"
    expect(resultIds.has("external:bib:13")).toBeTruthy();
    // "the uploaded anchor stays visible (D-21-10)"
    expect(resultIds.has("work:1")).toBeTruthy();
  });

  it("conceptKind=all is a no-op", () => {
    const result = filterGraphData(p1Fixture, filters({ conceptKind: "all" }));
    expect(ids(result)).toEqual(ids(p1Fixture));
  });

  // --- search extends over aliases ---
  it("search extends over aliases", () => {
    const result = filterGraphData(p1Fixture, filters({ search: "akrasia" }));
    const resultIds = ids(result);
    // "search matches an alias even though the label itself doesn't contain the term"
    expect(resultIds.has("concept:3")).toBeTruthy();
    // "a node with no matching alias/label/authors/kind is excluded"
    expect(!resultIds.has("concept:1")).toBeTruthy();
    // "the uploaded anchor stays visible under search too (D-21-10)"
    expect(resultIds.has("work:1")).toBeTruthy();
  });

  // --- byte-identity: default filters (now including readerLevel/conceptKind
  //     at "all") still return this payload completely unchanged ---
  it('byte-identity: default filters (now including readerLevel/conceptKind at "all") still return this payload completely unchanged', () => {
    const result = filterGraphData(p1Fixture, DEFAULT_GRAPH_FILTERS);
    // "default filters leave the Graph P1 fixture byte-identical"
    expect(result.nodes).toEqual(p1Fixture.nodes);
  });
});
