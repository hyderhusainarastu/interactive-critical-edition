import { describe, expect, it } from "vitest";
import {
  resolveCitedOnlyInfo,
  resolveDestination,
  resolveLinkActions,
  resolveNodeScholarlyActions,
  resolveReadingStatusTarget,
  resolveWriterInsertionCandidate,
} from "./inspectorActions";
import type { GraphNode } from "../graph/types";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

function displayNode(overrides: Partial<KnowledgeMapDisplayNode> & Pick<KnowledgeMapDisplayNode, "id">): KnowledgeMapDisplayNode {
  return {
    displayKind: "work",
    canonicalNodeId: null,
    sourceEntity: null,
    layer: "intellectual",
    label: String(overrides.id),
    destination: null,
    unavailableReason: null,
    projection: null,
    ...overrides,
  } as KnowledgeMapDisplayNode;
}

function canonicalNode(overrides: Partial<GraphNode> & Pick<GraphNode, "id" | "type" | "state">): GraphNode {
  return {
    label: overrides.id,
    uploaded: false,
    associatedWorkIds: [],
    destination: null,
    authors: null,
    year: null,
    url: null,
    ...overrides,
  } as GraphNode;
}

// =====================================================================
// resolveDestination
// =====================================================================

describe("resolveDestination", () => {
  // --- Real destination always wins ---
  it("real destination always wins", () => {
    const node = displayNode({ id: "x" as KnowledgeMapDisplayNode["id"], destination: "/library/abc" });
    const result = resolveDestination(node, null);
    expect(result).toEqual({ href: "/library/abc" });
  });

  // --- research_claim constructs the real project-independent route ---
  it("research_claim constructs the real project-independent route", () => {
    const node = displayNode({
      id: "claim:1" as KnowledgeMapDisplayNode["id"],
      sourceEntity: { kind: "research_claim", id: "claim-uuid" },
    });
    const result = resolveDestination(node, null);
    expect(result).toEqual({ href: "/research/claims/claim-uuid" });
  });

  // --- debate_cluster with no destination -> honest unavailable, never a guessed route ---
  it("debate_cluster with no destination -> honest unavailable, never a guessed route", () => {
    const node = displayNode({
      id: "debate:1" as KnowledgeMapDisplayNode["id"],
      sourceEntity: { kind: "debate_cluster", id: "debate-uuid" },
    });
    const result = resolveDestination(node, null);
    expect(result && "unavailableReason" in result).toBeTruthy();
  });

  // --- text_block resolves to the owning work's Reader via associatedWorkIds ---
  it("text_block resolves to the owning work's Reader via associatedWorkIds", () => {
    const node = displayNode({
      id: "section:1" as KnowledgeMapDisplayNode["id"],
      sourceEntity: { kind: "text_block", id: "block-uuid" },
    });
    const canonical = canonicalNode({ id: "section:1", type: "section", state: "structural", associatedWorkIds: ["work:work-uuid"] });
    const result = resolveDestination(node, canonical);
    expect(result).toEqual({ href: "/works/work-uuid/reader" });
  });

  // --- text_block with no known owning work -> unavailable, never fabricated ---
  it("text_block with no known owning work -> unavailable, never fabricated", () => {
    const node = displayNode({
      id: "section:1" as KnowledgeMapDisplayNode["id"],
      sourceEntity: { kind: "text_block", id: "block-uuid" },
    });
    const result = resolveDestination(node, null);
    expect(result && "unavailableReason" in result).toBeTruthy();
  });

  // --- aggregate/synthetic node has no "open" concept at all -> null, not an error state ---
  it("aggregate/synthetic node has no open concept at all -> null, not an error state", () => {
    const node = displayNode({ id: "aggregate:1" as KnowledgeMapDisplayNode["id"], displayKind: "aggregate", sourceEntity: null });
    expect(resolveDestination(node, null)).toBe(null);
  });
});

// =====================================================================
// resolveNodeScholarlyActions
// =====================================================================

describe("resolveNodeScholarlyActions", () => {
  // --- claim gets the full set: verify/dispute/edit/reclassify/update-excerpt ---
  it("claim gets the full set: verify/dispute/edit/reclassify/update-excerpt", () => {
    const node = displayNode({ id: "claim:1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "research_claim", id: "c1" } });
    const { available, unavailable } = resolveNodeScholarlyActions(node);
    const ids = available.map((a) => a.id).sort();
    expect(ids).toEqual(["dispute", "edit", "reclassify", "update-excerpt", "verify"]);
    // a claim is never a work, so reprocess must be unavailable
    expect(unavailable.some((u) => u.id === "reprocess")).toBe(true);
    const dispute = available.find((a) => a.id === "dispute")!;
    expect(dispute.requiresReason).toBe(true);
    expect(dispute.request.url).toBe("/api/research/corrections");
    expect(dispute.request.body).toEqual({ objectType: "claim", objectId: "c1", action: "disputed" });
    const updateExcerpt = available.find((a) => a.id === "update-excerpt")!;
    // must never say Add evidence — no multi-evidence-list capability exists
    expect(updateExcerpt.label).toBe("Update supporting excerpt");
  });

  // --- cluster (debate) gets only verify/dispute, edit/reclassify explicitly unavailable ---
  it("cluster (debate) gets only verify/dispute, edit/reclassify explicitly unavailable", () => {
    const node = displayNode({ id: "debate:1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "debate_cluster", id: "d1" } });
    const { available, unavailable } = resolveNodeScholarlyActions(node);
    expect(available.map((a) => a.id).sort()).toEqual(["dispute", "verify"]);
    expect(unavailable.some((u) => u.id === "edit")).toBe(true);
    expect(unavailable.some((u) => u.id === "reclassify")).toBe(true);
    const verify = available.find((a) => a.id === "verify")!;
    expect(verify.request.body).toEqual({ objectType: "cluster", objectId: "d1", action: "verified" });
  });

  // --- work node: reprocess available, no verify/dispute (not a research object) ---
  it("work node: reprocess available, no verify/dispute (not a research object)", () => {
    const node = displayNode({ id: "work:1" as KnowledgeMapDisplayNode["id"], displayKind: "work", sourceEntity: { kind: "work", id: "w1" } });
    const { available, unavailable } = resolveNodeScholarlyActions(node);
    expect(available.some((a) => a.id === "reprocess")).toBe(true);
    const reprocess = available.find((a) => a.id === "reprocess")!;
    expect(reprocess.request.url).toBe("/api/works/w1/reprocess");
    expect(reprocess.request.method).toBe("POST");
    expect(unavailable.some((u) => u.id === "verify")).toBe(true);
  });

  // --- concept node (no matching source entity kind) -> every action unavailable, never a crash ---
  it("concept node (no matching source entity kind) -> every action unavailable, never a crash", () => {
    const node = displayNode({ id: "concept:1" as KnowledgeMapDisplayNode["id"], displayKind: "concept", sourceEntity: { kind: "concept", id: "c1" } });
    const { available, unavailable } = resolveNodeScholarlyActions(node);
    expect(available.length).toBe(0);
    expect(unavailable.length > 0).toBeTruthy();
  });
});

// =====================================================================
// resolveLinkActions
// =====================================================================

function displayLink(overrides: Partial<KnowledgeMapDisplayLink>): KnowledgeMapDisplayLink {
  return {
    id: "l1" as KnowledgeMapDisplayLink["id"],
    source: "a" as KnowledgeMapDisplayLink["source"],
    target: "b" as KnowledgeMapDisplayLink["target"],
    canonicalLinkId: null,
    displayFamily: "reference",
    directed: true,
    evidence: null,
    provenance: null,
    aiInferred: false,
    ...overrides,
  };
}

describe("resolveLinkActions", () => {
  // --- Remove relationship is always unavailable today (no synthesized relationship edges yet) ---
  it("Remove relationship is always unavailable today (no synthesized relationship edges yet)", () => {
    const link = displayLink({ provenance: { relationId: "rel1", runId: "run1", depth: 1 } });
    const result = resolveLinkActions(link, "work-1");
    expect("reason" in result.removeRelationship).toBeTruthy();
  });

  // --- Mark uncertain resolves for a passage-annotation-sourced edge inside a work context ---
  it("Mark uncertain resolves for a passage-annotation-sourced edge inside a work context", () => {
    const link = displayLink({ provenance: { relationId: "annotation-1", runId: "run1", depth: 1 } });
    const result = resolveLinkActions(link, "work-1");
    expect("request" in result.markUncertain).toBeTruthy();
    if ("request" in result.markUncertain) {
      expect(result.markUncertain.request.url).toBe("/api/works/work-1/reader/passage-annotations/annotation-1");
      expect(result.markUncertain.request.method).toBe("PATCH");
      expect(result.markUncertain.request.body).toEqual({ verificationStatus: "disputed" });
    }
  });

  // --- Mark uncertain unavailable with no provenance, or outside a work context ---
  it("Mark uncertain unavailable with no provenance, or outside a work context", () => {
    const linkNoProvenance = displayLink({ provenance: null });
    expect("reason" in resolveLinkActions(linkNoProvenance, "work-1").markUncertain).toBeTruthy();

    const linkWithProvenance = displayLink({ provenance: { relationId: "annotation-1", runId: "run1", depth: 1 } });
    expect("reason" in resolveLinkActions(linkWithProvenance, null).markUncertain).toBeTruthy();
  });
});

// =====================================================================
// resolveReadingStatusTarget
// =====================================================================

describe("resolveReadingStatusTarget", () => {
  // --- bibliographic_record + a work context -> roadmap/item, real bibId ---
  it("bibliographic_record + a work context -> roadmap/item, real bibId", () => {
    const node = displayNode({ id: "external:bib:b1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "bibliographic_record", id: "b1" } });
    const target = resolveReadingStatusTarget(node, "work-1");
    expect(target).toEqual({ kind: "roadmap-item", url: "/api/works/work-1/roadmap/item", bibId: "b1" });
  });

  // --- No rootWorkId -> unavailable, never guesses a scope ---
  it("No rootWorkId -> unavailable, never guesses a scope", () => {
    const node = displayNode({ id: "external:bib:b1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "bibliographic_record", id: "b1" } });
    expect(resolveReadingStatusTarget(node, null)).toBe(null);
  });

  // --- research_resource-backed node -> deliberately unresolved (ambiguous id shape) ---
  it("research_resource-backed node -> deliberately unresolved (ambiguous id shape)", () => {
    const node = displayNode({ id: "external:source:s1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "research_resource", id: "s1" } });
    expect(resolveReadingStatusTarget(node, "work-1")).toBe(null);
  });
});

// =====================================================================
// resolveCitedOnlyInfo
// =====================================================================

describe("resolveCitedOnlyInfo", () => {
  // --- "missing" state -> cited-only, associatedWorkIds unwrapped ---
  it('"missing" state -> cited-only, associatedWorkIds unwrapped', () => {
    const node = canonicalNode({ id: "external:bib:b1", type: "reference", state: "missing", associatedWorkIds: ["work:w1", "work:w2"] });
    const info = resolveCitedOnlyInfo(node);
    expect(info).toEqual({ citingWorkIds: ["w1", "w2"] });
  });

  // --- Any other state -> null (not cited-only) ---
  it("Any other state -> null (not cited-only)", () => {
    const node = canonicalNode({ id: "work:w1", type: "work", state: "primary" });
    expect(resolveCitedOnlyInfo(node)).toBe(null);
  });

  // --- No canonical node at all -> null, never crashes ---
  it("No canonical node at all -> null, never crashes", () => {
    expect(resolveCitedOnlyInfo(null)).toBe(null);
  });
});

describe("resolveWriterInsertionCandidate", () => {
  // --- Insert into Writer (integration step "writer-insertion-dialogs"): a
  // claim node's own real label becomes the quote --------------------------
  it("a claim node's own real label becomes the quote", () => {
    const node = displayNode({
      id: "claim:1" as KnowledgeMapDisplayNode["id"],
      sourceEntity: { kind: "research_claim", id: "claim-uuid" },
      label: "Vice is a state of character concerned with choice.",
    });
    const result = resolveWriterInsertionCandidate(node);
    expect(result).toEqual({ quote: "Vice is a state of character concerned with choice.", attribution: "Claim, Knowledge Map" });
  });

  // --- Every other node kind -> null, never fabricates a quote from a
  // non-claim label ----------------------------------------------------------
  it("every other node kind -> null, never fabricates a quote from a non-claim label", () => {
    const work = displayNode({ id: "work:1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "work", id: "work-uuid" } });
    expect(resolveWriterInsertionCandidate(work)).toBe(null);
    const section = displayNode({ id: "section:1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "text_block", id: "block-uuid" } });
    expect(resolveWriterInsertionCandidate(section)).toBe(null);
    const aggregate = displayNode({ id: "agg:1" as KnowledgeMapDisplayNode["id"], sourceEntity: null });
    expect(resolveWriterInsertionCandidate(aggregate)).toBe(null);
  });
});
