import assert from "node:assert/strict";
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

/** `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/inspectorActions.test.ts` */

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

// --- Real destination always wins ---
{
  const node = displayNode({ id: "x" as KnowledgeMapDisplayNode["id"], destination: "/library/abc" });
  const result = resolveDestination(node, null);
  assert.deepEqual(result, { href: "/library/abc" });
}

// --- research_claim constructs the real project-independent route ---
{
  const node = displayNode({
    id: "claim:1" as KnowledgeMapDisplayNode["id"],
    sourceEntity: { kind: "research_claim", id: "claim-uuid" },
  });
  const result = resolveDestination(node, null);
  assert.deepEqual(result, { href: "/research/claims/claim-uuid" });
}

// --- debate_cluster with no destination -> honest unavailable, never a guessed route ---
{
  const node = displayNode({
    id: "debate:1" as KnowledgeMapDisplayNode["id"],
    sourceEntity: { kind: "debate_cluster", id: "debate-uuid" },
  });
  const result = resolveDestination(node, null);
  assert.ok(result && "unavailableReason" in result);
}

// --- text_block resolves to the owning work's Reader via associatedWorkIds ---
{
  const node = displayNode({
    id: "section:1" as KnowledgeMapDisplayNode["id"],
    sourceEntity: { kind: "text_block", id: "block-uuid" },
  });
  const canonical = canonicalNode({ id: "section:1", type: "section", state: "structural", associatedWorkIds: ["work:work-uuid"] });
  const result = resolveDestination(node, canonical);
  assert.deepEqual(result, { href: "/works/work-uuid/reader" });
}

// --- text_block with no known owning work -> unavailable, never fabricated ---
{
  const node = displayNode({
    id: "section:1" as KnowledgeMapDisplayNode["id"],
    sourceEntity: { kind: "text_block", id: "block-uuid" },
  });
  const result = resolveDestination(node, null);
  assert.ok(result && "unavailableReason" in result);
}

// --- aggregate/synthetic node has no "open" concept at all -> null, not an error state ---
{
  const node = displayNode({ id: "aggregate:1" as KnowledgeMapDisplayNode["id"], displayKind: "aggregate", sourceEntity: null });
  assert.equal(resolveDestination(node, null), null);
}

// =====================================================================
// resolveNodeScholarlyActions
// =====================================================================

// --- claim gets the full set: verify/dispute/edit/reclassify/update-excerpt ---
{
  const node = displayNode({ id: "claim:1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "research_claim", id: "c1" } });
  const { available, unavailable } = resolveNodeScholarlyActions(node);
  const ids = available.map((a) => a.id).sort();
  assert.deepEqual(ids, ["dispute", "edit", "reclassify", "update-excerpt", "verify"]);
  assert.equal(unavailable.some((u) => u.id === "reprocess"), true, "a claim is never a work, so reprocess must be unavailable");
  const dispute = available.find((a) => a.id === "dispute")!;
  assert.equal(dispute.requiresReason, true);
  assert.equal(dispute.request.url, "/api/research/corrections");
  assert.deepEqual(dispute.request.body, { objectType: "claim", objectId: "c1", action: "disputed" });
  const updateExcerpt = available.find((a) => a.id === "update-excerpt")!;
  assert.equal(updateExcerpt.label, "Update supporting excerpt", "must never say Add evidence — no multi-evidence-list capability exists");
}

// --- cluster (debate) gets only verify/dispute, edit/reclassify explicitly unavailable ---
{
  const node = displayNode({ id: "debate:1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "debate_cluster", id: "d1" } });
  const { available, unavailable } = resolveNodeScholarlyActions(node);
  assert.deepEqual(available.map((a) => a.id).sort(), ["dispute", "verify"]);
  assert.equal(unavailable.some((u) => u.id === "edit"), true);
  assert.equal(unavailable.some((u) => u.id === "reclassify"), true);
  const verify = available.find((a) => a.id === "verify")!;
  assert.deepEqual(verify.request.body, { objectType: "cluster", objectId: "d1", action: "verified" });
}

// --- work node: reprocess available, no verify/dispute (not a research object) ---
{
  const node = displayNode({ id: "work:1" as KnowledgeMapDisplayNode["id"], displayKind: "work", sourceEntity: { kind: "work", id: "w1" } });
  const { available, unavailable } = resolveNodeScholarlyActions(node);
  assert.equal(available.some((a) => a.id === "reprocess"), true);
  const reprocess = available.find((a) => a.id === "reprocess")!;
  assert.equal(reprocess.request.url, "/api/works/w1/reprocess");
  assert.equal(reprocess.request.method, "POST");
  assert.equal(unavailable.some((u) => u.id === "verify"), true);
}

// --- concept node (no matching source entity kind) -> every action unavailable, never a crash ---
{
  const node = displayNode({ id: "concept:1" as KnowledgeMapDisplayNode["id"], displayKind: "concept", sourceEntity: { kind: "concept", id: "c1" } });
  const { available, unavailable } = resolveNodeScholarlyActions(node);
  assert.equal(available.length, 0);
  assert.ok(unavailable.length > 0);
}

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

// --- Remove relationship is always unavailable today (no synthesized relationship edges yet) ---
{
  const link = displayLink({ provenance: { relationId: "rel1", runId: "run1", depth: 1 } });
  const result = resolveLinkActions(link, "work-1");
  assert.ok("reason" in result.removeRelationship);
}

// --- Mark uncertain resolves for a passage-annotation-sourced edge inside a work context ---
{
  const link = displayLink({ provenance: { relationId: "annotation-1", runId: "run1", depth: 1 } });
  const result = resolveLinkActions(link, "work-1");
  assert.ok("request" in result.markUncertain);
  if ("request" in result.markUncertain) {
    assert.equal(result.markUncertain.request.url, "/api/works/work-1/reader/passage-annotations/annotation-1");
    assert.equal(result.markUncertain.request.method, "PATCH");
    assert.deepEqual(result.markUncertain.request.body, { verificationStatus: "disputed" });
  }
}

// --- Mark uncertain unavailable with no provenance, or outside a work context ---
{
  const linkNoProvenance = displayLink({ provenance: null });
  assert.ok("reason" in resolveLinkActions(linkNoProvenance, "work-1").markUncertain);

  const linkWithProvenance = displayLink({ provenance: { relationId: "annotation-1", runId: "run1", depth: 1 } });
  assert.ok("reason" in resolveLinkActions(linkWithProvenance, null).markUncertain);
}

// =====================================================================
// resolveReadingStatusTarget
// =====================================================================

// --- bibliographic_record + a work context -> roadmap/item, real bibId ---
{
  const node = displayNode({ id: "external:bib:b1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "bibliographic_record", id: "b1" } });
  const target = resolveReadingStatusTarget(node, "work-1");
  assert.deepEqual(target, { kind: "roadmap-item", url: "/api/works/work-1/roadmap/item", bibId: "b1" });
}

// --- No rootWorkId -> unavailable, never guesses a scope ---
{
  const node = displayNode({ id: "external:bib:b1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "bibliographic_record", id: "b1" } });
  assert.equal(resolveReadingStatusTarget(node, null), null);
}

// --- research_resource-backed node -> deliberately unresolved (ambiguous id shape) ---
{
  const node = displayNode({ id: "external:source:s1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "research_resource", id: "s1" } });
  assert.equal(resolveReadingStatusTarget(node, "work-1"), null);
}

// =====================================================================
// resolveCitedOnlyInfo
// =====================================================================

// --- "missing" state -> cited-only, associatedWorkIds unwrapped ---
{
  const node = canonicalNode({ id: "external:bib:b1", type: "reference", state: "missing", associatedWorkIds: ["work:w1", "work:w2"] });
  const info = resolveCitedOnlyInfo(node);
  assert.deepEqual(info, { citingWorkIds: ["w1", "w2"] });
}

// --- Any other state -> null (not cited-only) ---
{
  const node = canonicalNode({ id: "work:w1", type: "work", state: "primary" });
  assert.equal(resolveCitedOnlyInfo(node), null);
}

// --- No canonical node at all -> null, never crashes ---
{
  assert.equal(resolveCitedOnlyInfo(null), null);
}

// --- Insert into Writer (integration step "writer-insertion-dialogs"): a
// claim node's own real label becomes the quote --------------------------
{
  const node = displayNode({
    id: "claim:1" as KnowledgeMapDisplayNode["id"],
    sourceEntity: { kind: "research_claim", id: "claim-uuid" },
    label: "Vice is a state of character concerned with choice.",
  });
  const result = resolveWriterInsertionCandidate(node);
  assert.deepEqual(result, { quote: "Vice is a state of character concerned with choice.", attribution: "Claim, Knowledge Map" });
}

// --- Every other node kind -> null, never fabricates a quote from a
// non-claim label ----------------------------------------------------------
{
  const work = displayNode({ id: "work:1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "work", id: "work-uuid" } });
  assert.equal(resolveWriterInsertionCandidate(work), null);
  const section = displayNode({ id: "section:1" as KnowledgeMapDisplayNode["id"], sourceEntity: { kind: "text_block", id: "block-uuid" } });
  assert.equal(resolveWriterInsertionCandidate(section), null);
  const aggregate = displayNode({ id: "agg:1" as KnowledgeMapDisplayNode["id"], sourceEntity: null });
  assert.equal(resolveWriterInsertionCandidate(aggregate), null);
}

console.log("inspectorActions.test.ts: all assertions passed");
