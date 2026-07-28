import assert from "node:assert/strict";
import { unwrapId } from "@ice/graph-display";

import type { GraphLink, GraphNode, GraphPayload } from "../graph/types";
import { adaptGraphPayload } from "./adapter";

/**
 * Stage 3 scene-camera step — coverage for the base canonical → display
 * adapter (spec §1.1/§1.4/§2). Run via
 * `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/adapter.test.ts`
 * — same tsx-invocation convention as `graph/filterGraphData.test.ts` (no
 * vitest wiring exists under `apps/web`).
 */

function node(overrides: Partial<GraphNode> & Pick<GraphNode, "id" | "type" | "state">): GraphNode {
  return {
    label: overrides.id,
    uploaded: false,
    associatedWorkIds: [],
    destination: null,
    authors: null,
    year: null,
    url: null,
    ...overrides,
  };
}

function link(overrides: Partial<GraphLink> & Pick<GraphLink, "id" | "source" | "target" | "edgeType">): GraphLink {
  return {
    directed: true,
    associatedWorkIds: [],
    category: null,
    confidence: 0.8,
    ...overrides,
  };
}

function payload(nodes: GraphNode[], links: GraphLink[]): GraphPayload {
  return { nodes, links, stats: { works: 0, references: 0, sources: 0, concepts: 0, people: 0, missing: 0, read: 0 } };
}

// --- basic mapping: displayKind/layer/label/destination/unavailableReason ---
{
  const p = payload(
    [
      node({ id: "work:1", type: "work", state: "primary", label: "Being and Time", destination: "/works/1" }),
      node({ id: "external:bib:1", type: "reference", state: "missing", label: "Sein und Zeit" }),
      node({ id: "concept:1", type: "concept", state: "unread", label: "Dasein" }),
      node({ id: "section:1", type: "section", state: "structural", label: "Introduction" }),
      node({ id: "claim:1", type: "claim", state: "unread", label: "A claim" }),
      node({ id: "debate:1", type: "debate", state: "unread", label: "A debate" }),
    ],
    [],
  );
  const result = adaptGraphPayload(p);
  assert.equal(result.nodes.length, 6);

  const work = result.nodes.find((n) => unwrapId(n.id) === "work:1")!;
  assert.equal(work.displayKind, "work");
  assert.equal(work.layer, "intellectual");
  assert.equal(work.destination, "/works/1");
  assert.equal(work.unavailableReason, null);
  assert.deepEqual(work.sourceEntity, { kind: "work", id: "1" });

  const reference = result.nodes.find((n) => unwrapId(n.id) === "external:bib:1")!;
  assert.equal(reference.unavailableReason, "Referenced, not acquired — not held in your library");
  assert.deepEqual(reference.sourceEntity, { kind: "bibliographic_record", id: "1" });

  const section = result.nodes.find((n) => unwrapId(n.id) === "section:1")!;
  assert.equal(section.layer, "evidence");
  assert.deepEqual(section.sourceEntity, { kind: "text_block", id: "1" });

  const claim = result.nodes.find((n) => unwrapId(n.id) === "claim:1")!;
  assert.equal(claim.layer, "claim");
  assert.deepEqual(claim.sourceEntity, { kind: "research_claim", id: "1" });

  const debate = result.nodes.find((n) => unwrapId(n.id) === "debate:1")!;
  assert.equal(debate.layer, "debate");
  assert.deepEqual(debate.sourceEntity, { kind: "debate_cluster", id: "1" });

  console.log("basic mapping: OK");
}

// --- edge family classification, including the ai_inferred provenance overlay ---
{
  const p = payload(
    [node({ id: "work:1", type: "work", state: "primary" }), node({ id: "work:2", type: "work", state: "primary" })],
    [
      link({ id: "l1", source: "work:1", target: "work:2", edgeType: "cites", category: null }),
      link({ id: "l2", source: "work:1", target: "work:2", edgeType: "provides_context_for", category: "ai_inferred" }),
      link({ id: "l3", source: "work:1", target: "work:2", edgeType: "claim_nuances", category: null, directed: false }),
    ],
  );
  const result = adaptGraphPayload(p);
  assert.equal(result.links.length, 3);
  const cites = result.links.find((l) => unwrapId(l.id) === "l1")!;
  assert.equal(cites.displayFamily, "reference");
  assert.equal(cites.aiInferred, false);

  const inferred = result.links.find((l) => unwrapId(l.id) === "l2")!;
  assert.equal(inferred.displayFamily, "influence"); // underlying semantic family preserved
  assert.equal(inferred.aiInferred, true); // provenance overlay, never a distinct family

  const nuanced = result.links.find((l) => unwrapId(l.id) === "l3")!;
  assert.equal(nuanced.displayFamily, "qualification");
  assert.equal(result.adapterDiagnostics.length, 0);
  console.log("edge family classification: OK");
}

// --- unclassified edge: never silently defaults to influence/agreement ---
{
  const p = payload(
    [node({ id: "work:1", type: "work", state: "primary" }), node({ id: "work:2", type: "work", state: "primary" })],
    [link({ id: "l1", source: "work:1", target: "work:2", edgeType: "totally_unknown_edge_type", category: null })],
  );
  const result = adaptGraphPayload(p);
  assert.equal(result.links[0].displayFamily, "structural");
  assert.equal(result.adapterDiagnostics.length, 1);
  assert.equal(result.adapterDiagnostics[0].kind, "unclassified_edge");
  assert.equal(result.adapterDiagnostics[0].linkId, "l1");
  console.log("unclassified edge fallback + diagnostic: OK");
}

// --- direction mismatch is recorded, not silently corrected ---
{
  const p = payload(
    [node({ id: "work:1", type: "work", state: "primary" }), node({ id: "work:2", type: "work", state: "primary" })],
    [link({ id: "l1", source: "work:1", target: "work:2", edgeType: "is_comparable_to", directed: true })],
  );
  const result = adaptGraphPayload(p);
  assert.equal(result.links[0].directed, true, "the link's own directed flag is preserved even when flagged inconsistent");
  assert.equal(result.adapterDiagnostics.length, 1);
  assert.equal(result.adapterDiagnostics[0].kind, "direction_mismatch");
  console.log("direction mismatch diagnostic: OK");
}

// --- duplicate node/link ids: first occurrence wins, never a crash ---
{
  const p = payload(
    [node({ id: "work:1", type: "work", state: "primary", label: "First" }), node({ id: "work:1", type: "work", state: "primary", label: "Second" })],
    [
      link({ id: "l1", source: "work:1", target: "work:1", edgeType: "cites" }), // also a self-link, see next block
    ],
  );
  const result = adaptGraphPayload(p);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].label, "First");
  console.log("duplicate node id dedup: OK");
}

// --- self-links and dangling endpoints are excluded from the production selection ---
{
  const p = payload(
    [node({ id: "work:1", type: "work", state: "primary" })],
    [
      link({ id: "self", source: "work:1", target: "work:1", edgeType: "cites" }),
      link({ id: "dangling", source: "work:1", target: "external:bib:missing", edgeType: "cites" }),
    ],
  );
  const result = adaptGraphPayload(p);
  assert.equal(result.links.length, 0);
  console.log("self-link + dangling-endpoint exclusion: OK");
}

// --- canonical payload immutability: adapting never mutates the input ---
{
  const p = payload([node({ id: "work:1", type: "work", state: "primary" })], []);
  const before = JSON.stringify(p);
  adaptGraphPayload(p);
  assert.equal(JSON.stringify(p), before);
  assert.equal(Object.isFrozen(p.nodes[0]), true, "adaptGraphPayload must deep-freeze the payload it was handed");
  // Strict-mode ESM throws on this assignment; tsx's CJS transpile of this
  // file may instead silently no-op it (non-strict semantics) — either way
  // the value must not actually change, which is the guarantee that
  // matters (charter §9 "canonical payload remains immutable").
  try {
    (p.nodes[0] as { label: string }).label = "mutated";
  } catch {
    // expected in strict mode
  }
  assert.notEqual(p.nodes[0].label, "mutated", "a frozen node's field must never actually change value");
  console.log("canonical payload immutability: OK");
}

console.log("adapter.test.ts: all assertions passed");
