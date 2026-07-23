import assert from "node:assert/strict";
import { stageForRelationship } from "@ice/curriculum";
import type { RoadmapItem } from "@ice/roadmap";
import type { GraphNode } from "@/components/graph/types";
import { joinRoadmapAnnotations, type RoadmapJoinProvenance } from "@/lib/roadmapGraph";

/**
 * Phase 22.7 (feature plan §2.3/§5 Feature A): the roadmap annotation-join
 * precedence chain — exact bib → collapsed bib → matched work → normalized-title
 * fallback → no-match. `joinRoadmapAnnotations` is pure, but this module
 * transitively imports `@ice/db`, so run it with a DATABASE_URL present (no
 * query is issued — the connection is lazy):
 *   DATABASE_URL=postgres://ice:ice_dev_only@localhost:5432/interactive_critical_edition \
 *     pnpm --filter web exec tsx apps/web/src/lib/roadmapGraph.test.ts
 */

function node(overrides: Partial<GraphNode> & Pick<GraphNode, "id" | "type">): GraphNode {
  return {
    label: overrides.id,
    state: "unread",
    uploaded: false,
    associatedWorkIds: [],
    destination: null,
    authors: null,
    year: null,
    url: null,
    ...overrides,
  };
}

function item(overrides: Partial<RoadmapItem> & Pick<RoadmapItem, "bibId" | "title">): RoadmapItem {
  return {
    authors: null,
    year: null,
    tier: "essential",
    sequence: 1,
    category: "prerequisite",
    confidence: 0.8,
    centrality: 1,
    estimatedMinutes: 600,
    known: false,
    inLibrary: false,
    overridden: false,
    reason: "A prerequisite.",
    overBudget: false,
    mergedCount: 0,
    addedManually: false,
    workId: null,
    ...overrides,
  };
}

const nodes: GraphNode[] = [
  node({ id: "external:bib:1", type: "reference", label: "Direct Bib" }),
  node({ id: "external:bib:2", type: "reference", label: "Edition Collapsed In" }),
  node({ id: "work:5", type: "work", uploaded: true, label: "An Owned Work" }),
  node({ id: "external:source:xyz", type: "online_source", label: "Fallback By Title" }),
];

const provenance: RoadmapJoinProvenance = {
  mergedBibIdsByBib: new Map([["99", ["2"]]]),
  rootWorkIdsByBib: new Map([
    ["1", ["work:a", "work:b"]],
    ["99", ["work:b"]],
    ["nomatch-work", ["work:a"]],
    ["nobib", ["work:a"]],
  ]),
};

const items: RoadmapItem[] = [
  item({ bibId: "1", title: "Direct Bib" }), // (a) exact bib
  item({ bibId: "99", title: "Edition Collapsed In", category: "conceptual_influence" }), // (b) via mergedBibIds → external:bib:2
  item({ bibId: "nomatch-work", title: "An Owned Work", workId: "5" }), // (c) via workId
  item({ bibId: "nobib", title: "Fallback By Title" }), // (d) normalized-title fallback
  item({ bibId: "ghost", title: "Nothing Matches This" }), // no-match
];

const result = joinRoadmapAnnotations(nodes, items, provenance);

// (a) exact bib match, and provenance is threaded through unchanged.
{
  const a = result.get("external:bib:1");
  assert.ok(a, "(a) exact external:bib:<bibId> must be annotated");
  assert.equal(a!.stage, stageForRelationship("prerequisite"), "stage derives from the item category");
  assert.deepEqual(a!.rootWorkIds, ["work:a", "work:b"], "rootWorkIds provenance is carried onto the annotation");
  assert.ok(a!.checkpoint.length > 0, "a deterministic checkpoint is attached");
}

// (b) collapsed-edition fallback: bibId 99 has no node, but mergedBibIds→2 does.
{
  const b = result.get("external:bib:2");
  assert.ok(b, "(b) a collapsed bib id must resolve to the surviving node");
  assert.equal(b!.stage, stageForRelationship("conceptual_influence"));
}

// (c) matched-owned-work fallback.
assert.ok(result.get("work:5"), "(c) item.workId must annotate the work:<id> node");

// (d) normalized-title fallback.
assert.ok(result.get("external:source:xyz"), "(d) title fallback must annotate the label-matched node");

// no-match: the ghost item annotates nothing; exactly four nodes annotated.
assert.equal(result.size, 4, "an item that matches no node adds no annotation");

// --- precedence: exact bib beats a title that also matches another node ---
{
  const twoNodes: GraphNode[] = [
    node({ id: "external:bib:7", type: "reference", label: "Shared Title" }),
    node({ id: "external:source:other", type: "online_source", label: "Shared Title" }),
  ];
  const one = joinRoadmapAnnotations(
    [twoNodes[0], twoNodes[1]],
    [item({ bibId: "7", title: "Shared Title" })],
    { mergedBibIdsByBib: new Map(), rootWorkIdsByBib: new Map() },
  );
  assert.ok(one.get("external:bib:7"), "exact bib match wins over the title fallback");
  assert.equal(one.has("external:source:other"), false, "the title-fallback node is not also annotated");
}

// --- contested node: the earlier (higher-priority) item wins ---
{
  const contested = joinRoadmapAnnotations(
    [node({ id: "external:bib:8", type: "reference", label: "Contested" })],
    [
      item({ bibId: "8", title: "Contested", sequence: 1, category: "prerequisite" }),
      item({ bibId: "8", title: "Contested", sequence: 2, category: "optional_extension" }),
    ],
    { mergedBibIdsByBib: new Map(), rootWorkIdsByBib: new Map() },
  );
  assert.equal(contested.get("external:bib:8")!.sequence, 1, "the earliest item claims a contested node");
  assert.equal(contested.get("external:bib:8")!.stage, stageForRelationship("prerequisite"));
}

console.log("roadmapGraph.test.ts: all assertions passed");
