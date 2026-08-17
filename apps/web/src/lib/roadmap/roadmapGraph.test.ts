import { stageForRelationship } from "@ice/curriculum";
import type { RoadmapItem } from "@ice/roadmap";
import { describe, expect, it } from "vitest";
import type { GraphNode } from "@/components/graph/types";
import { joinRoadmapAnnotations, type RoadmapJoinProvenance } from "@/lib/roadmap/roadmapGraph";

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

describe("joinRoadmapAnnotations", () => {
  // (a) exact bib match, and provenance is threaded through unchanged.
  it("(a) exact external:bib:<bibId> must be annotated", () => {
    const a = result.get("external:bib:1");
    expect(a).toBeTruthy();
    // "stage derives from the item category"
    expect(a!.stage).toBe(stageForRelationship("prerequisite"));
    // "rootWorkIds provenance is carried onto the annotation"
    expect(a!.rootWorkIds).toEqual(["work:a", "work:b"]);
    // "a deterministic checkpoint is attached"
    expect(a!.checkpoint.length > 0).toBeTruthy();
  });

  // (b) collapsed-edition fallback: bibId 99 has no node, but mergedBibIds→2 does.
  it("(b) a collapsed bib id must resolve to the surviving node", () => {
    const b = result.get("external:bib:2");
    expect(b).toBeTruthy();
    expect(b!.stage).toBe(stageForRelationship("conceptual_influence"));
  });

  // (c) matched-owned-work fallback.
  it("(c) item.workId must annotate the work:<id> node", () => {
    expect(result.get("work:5")).toBeTruthy();
  });

  // (d) normalized-title fallback.
  it("(d) title fallback must annotate the label-matched node", () => {
    expect(result.get("external:source:xyz")).toBeTruthy();
  });

  // no-match: the ghost item annotates nothing; exactly four nodes annotated.
  it("an item that matches no node adds no annotation", () => {
    expect(result.size).toBe(4);
  });

  // --- precedence: exact bib beats a title that also matches another node ---
  it("exact bib match wins over the title fallback", () => {
    const twoNodes: GraphNode[] = [
      node({ id: "external:bib:7", type: "reference", label: "Shared Title" }),
      node({ id: "external:source:other", type: "online_source", label: "Shared Title" }),
    ];
    const one = joinRoadmapAnnotations(
      [twoNodes[0], twoNodes[1]],
      [item({ bibId: "7", title: "Shared Title" })],
      { mergedBibIdsByBib: new Map(), rootWorkIdsByBib: new Map() },
    );
    expect(one.get("external:bib:7")).toBeTruthy();
    // "the title-fallback node is not also annotated"
    expect(one.has("external:source:other")).toBe(false);
  });

  // --- contested node: the earlier (higher-priority) item wins ---
  it("the earliest item claims a contested node", () => {
    const contested = joinRoadmapAnnotations(
      [node({ id: "external:bib:8", type: "reference", label: "Contested" })],
      [
        item({ bibId: "8", title: "Contested", sequence: 1, category: "prerequisite" }),
        item({ bibId: "8", title: "Contested", sequence: 2, category: "optional_extension" }),
      ],
      { mergedBibIdsByBib: new Map(), rootWorkIdsByBib: new Map() },
    );
    expect(contested.get("external:bib:8")!.sequence).toBe(1);
    expect(contested.get("external:bib:8")!.stage).toBe(stageForRelationship("prerequisite"));
  });
});
