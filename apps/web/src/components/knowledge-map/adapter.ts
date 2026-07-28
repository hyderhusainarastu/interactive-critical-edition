/**
 * Canonical → display adapter (charter §9, spec §1.1/§1.4/§2). The ONLY
 * place a real `GraphNode`/`GraphLink` (`../graph/types`, "THE
 * graph data contract") is translated into `@ice/graph-display`'s
 * `DisplayNode<NodeType>`/`DisplayLink` — every downstream Knowledge Map
 * consumer (3D scene, 2D view, List view, inspector) reads only the
 * `DisplayNode`/`DisplayLink` shape this module produces, never the
 * canonical types directly.
 *
 * Scope note (this is the "scene-camera" implementation step): this module
 * covers the mechanical base-payload mapping the spec's §1.4 table
 * describes (`GraphNode[]`/`GraphLink[]` → `DisplayNode[]`/`DisplayLink[]`
 * via the package's generic exports, immutability, structural validation).
 * It deliberately does NOT implement §2.2's context-scoped synthesis
 * (passage/evidence/question/position/hypothesis/gap/writing_project nodes
 * synthesized only inside a debate/claim/passage context expansion) — that
 * is data-flow/context-chooser territory for a later Stage 3 step, not
 * needed to port the scene/camera rendering pipeline itself. Every
 * `DisplayKind` value this module can currently PRODUCE is a real
 * canonical `NodeType` (the 9 values `buildGraph()` emits today); the
 * display-only kinds are still fully handled by the theme/sizing/scene code
 * this step ports (so nothing crashes if a later step starts emitting one),
 * simply not synthesized here yet.
 */
import {
  assertNotMutated,
  classifyEdgeFamily,
  deepFreeze,
  layerForDisplayKind,
  toCanonicalLinkId,
  toCanonicalNodeId,
  toDisplayLinkId,
  toDisplayNodeId,
  unavailableReasonForState,
  validateDisplayGraph,
  validateLinkDirection,
  type DisplayEdgeFamily,
  type DisplayLink,
  type DisplayNode,
  type DisplaySourceEntity,
  type GraphDiagnostic,
  type SourceEntityKind,
} from "@ice/graph-display";

import type { GraphLink, GraphNode, GraphPayload, NodeType } from "../graph/types";

/** This module's concrete `DisplayNode` instantiation — every Knowledge Map
 *  file downstream of the adapter imports these two aliases rather than
 *  re-parameterizing `DisplayNode<NodeType>` at every call site. */
export type KnowledgeMapDisplayNode = DisplayNode<NodeType>;
export type KnowledgeMapDisplayLink = DisplayLink;

/** Adapter-level findings that don't fit `@ice/graph-display/validate.ts`'s
 *  closed `GraphDiagnosticCode` union (that union is a structural-shape
 *  contract — duplicate ids, dangling endpoints — owned by the package;
 *  extending it for adapter-specific concerns like "no display-family
 *  mapping" would conflate two different kinds of diagnostic). Never
 *  thrown, always collected — same "log, never crash the whole scene for
 *  one bad row" posture as the package's own diagnostics (charter §14). */
export interface AdapterDiagnostic {
  kind: "unclassified_edge" | "direction_mismatch";
  message: string;
  linkId: string;
}

export interface AdaptedGraph {
  nodes: KnowledgeMapDisplayNode[];
  links: KnowledgeMapDisplayLink[];
  /** Structural diagnostics from `@ice/graph-display`'s own
   *  `validateDisplayGraph`, run as a post-adapt safety net (see this
   *  module's doc comment on `adaptGraphPayload` for why duplicates/
   *  dangling-endpoints/self-links are excluded by construction rather
   *  than reverse-engineered from this list — an "error"-severity entry
   *  appearing here after that exclusion pass would indicate a genuine
   *  adapter bug, not expected data). */
  structuralDiagnostics: GraphDiagnostic[];
  adapterDiagnostics: AdapterDiagnostic[];
}

/**
 * Derives a `DisplaySourceEntity` from a canonical `GraphNode.id`'s known
 * prefix convention (`apps/web/src/lib/graph.ts`'s own id-minting scheme —
 * `work:<uuid>`, `external:bib:<uuid>`, `external:source:<key>`,
 * `concept:<uuid>`, `section:<uuid>` [= a `text_block.id`, confirmed by
 * reading `graph.ts`'s `sectionRows` query], `claim:<uuid>`
 * [`graphDebate.ts`], `debate:<uuid>` [`graphDebate.ts`]). `external:source:`
 * is mapped to `research_resource` as a documented, deliberate
 * approximation — that id can back either a `research_resource` row or its
 * durable `learning_resource` projection (same `normalized_key`), and
 * nothing in the display/render pipeline needs to distinguish the two, so
 * this picks the base per-run table rather than inventing a third
 * disambiguation rule. Any id with no recognized prefix maps to
 * `"synthetic"` rather than throwing — a genuinely new canonical id shape
 * should degrade to "no clean single-entity provenance" instead of
 * crashing the adapter.
 */
function inferSourceEntity(canonicalId: string): DisplaySourceEntity {
  const prefixed = (prefix: string, kind: SourceEntityKind): DisplaySourceEntity | null =>
    canonicalId.startsWith(prefix) ? { kind, id: canonicalId.slice(prefix.length) } : null;

  return (
    prefixed("work:", "work") ??
    prefixed("external:bib:", "bibliographic_record") ??
    prefixed("external:source:", "research_resource") ??
    prefixed("concept:", "concept") ??
    prefixed("section:", "text_block") ??
    prefixed("claim:", "research_claim") ??
    prefixed("debate:", "debate_cluster") ?? { kind: "synthetic", id: canonicalId }
  );
}

function adaptNode(node: GraphNode): KnowledgeMapDisplayNode {
  return {
    id: toDisplayNodeId(node.id),
    displayKind: node.type,
    canonicalNodeId: toCanonicalNodeId(node.id),
    sourceEntity: inferSourceEntity(node.id),
    layer: layerForDisplayKind(node.type),
    label: node.label,
    destination: node.destination,
    unavailableReason: unavailableReasonForState(node.state),
    projection: null,
  };
}

function endpointId(end: GraphLink["source"] | GraphLink["target"]): string {
  return typeof end === "string" ? end : (end as { id: string }).id;
}

function adaptLink(link: GraphLink, adapterDiagnostics: AdapterDiagnostic[]): KnowledgeMapDisplayLink {
  const classification = classifyEdgeFamily(link.edgeType, link.category);

  let displayFamily: DisplayEdgeFamily;
  let aiInferred: boolean;
  if (classification.family === "unclassified") {
    // Charter §10: "An unknown value must render as a labeled neutral
    // 'Unclassified relationship' with provenance and a recorded
    // diagnostic; it must not silently default to agreement/influence" —
    // "structural" is the one family that asserts nothing about
    // scholarly agreement/influence/opposition/prerequisite, so it is the
    // safe rendering fallback here (never "influence", the CURRENT app's
    // confirmed bug). The diagnostic below is what actually satisfies
    // "recorded" and "provenance" — the legend/inspector's own
    // "Unclassified relationship" labeling is a later step's job (this
    // adapter's contract is data, not UI copy), but the fact is never
    // silently dropped. In practice this branch is defensive: `families.ts`'s
    // own audit (see that module's doc comment) already covers every
    // edgeType/category value the live codebase currently emits.
    displayFamily = "structural";
    aiInferred = classification.aiInferred;
    adapterDiagnostics.push({
      kind: "unclassified_edge",
      message: classification.diagnostic.reason,
      linkId: link.id,
    });
  } else {
    displayFamily = classification.family;
    aiInferred = classification.aiInferred;
  }

  const directionIssue = validateLinkDirection(link.edgeType, link.directed);
  if (directionIssue) {
    adapterDiagnostics.push({ kind: "direction_mismatch", message: directionIssue, linkId: link.id });
  }

  return {
    id: toDisplayLinkId(link.id),
    source: toDisplayNodeId(endpointId(link.source)),
    target: toDisplayNodeId(endpointId(link.target)),
    canonicalLinkId: toCanonicalLinkId(link.id),
    displayFamily,
    directed: link.directed,
    evidence: link.evidence ?? link.evidences ?? null,
    provenance: link.provenance ?? null,
    aiInferred,
  };
}

/**
 * The base-payload adapter (spec §2's top pipeline stage, before
 * disclosure/filters run). Freezes the raw payload immediately (charter §9
 * "Canonical server payload remains immutable" — a mutation attempt during
 * adaptation throws a strict-mode `TypeError` right away instead of
 * silently corrupting shared state), then builds the display node/link set.
 *
 * Duplicates/dangling-endpoint/self-link exclusion happens HERE, by
 * construction, during the single pass over `payload.nodes`/`payload.links`
 * — not by reverse-engineering `validateDisplayGraph`'s diagnostics after
 * the fact (its `nodeId`/`linkId` fields identify *which* row is
 * duplicate/dangling, not *which occurrence*, so post-hoc filtering from
 * its output alone would be ambiguous for a true duplicate id). Self-links
 * are excluded from the production selection the same way — real
 * scholarly relationship data has no legitimate self-citation edge, and
 * `validateDisplayGraph` itself flags every self-link as `error` severity
 * — but the ported scene/layout code (`layout.ts`'s curvature logic) stays
 * defensively self-link-aware regardless, exactly matching the charter
 * §16 fixture requirement that the RENDERER must not crash on one, even
 * though the production adapter pipeline does not intentionally emit one.
 * `validateDisplayGraph` is then run over the already-clean result as a
 * safety net: any `error`-severity diagnostic surviving that construction
 * would indicate a genuine adapter bug, not expected data, and is still
 * respected (the offending node/link is dropped) rather than assumed
 * impossible.
 */
export function adaptGraphPayload(payload: GraphPayload): AdaptedGraph {
  const frozen = deepFreeze(payload);
  const snapshotJson = JSON.stringify(frozen);

  const adapterDiagnostics: AdapterDiagnostic[] = [];

  const seenNodeIds = new Set<string>();
  const nodes: KnowledgeMapDisplayNode[] = [];
  for (const node of frozen.nodes) {
    if (seenNodeIds.has(node.id)) continue; // first occurrence wins
    seenNodeIds.add(node.id);
    nodes.push(adaptNode(node));
  }

  const seenLinkIds = new Set<string>();
  const links: KnowledgeMapDisplayLink[] = [];
  for (const link of frozen.links) {
    if (seenLinkIds.has(link.id)) continue; // first occurrence wins
    const sourceId = endpointId(link.source);
    const targetId = endpointId(link.target);
    if (!seenNodeIds.has(sourceId) || !seenNodeIds.has(targetId)) continue; // dangling
    if (sourceId === targetId) continue; // self-link — see doc comment above
    seenLinkIds.add(link.id);
    links.push(adaptLink(link, adapterDiagnostics));
  }

  // Safety net (see doc comment): drop anything validateDisplayGraph still
  // flags as error-severity despite the construction above, rather than
  // assuming that can never happen.
  let structuralDiagnostics = validateDisplayGraph(nodes, links);
  const erroredNodeIds = new Set(structuralDiagnostics.filter((d) => d.severity === "error" && d.nodeId).map((d) => d.nodeId!));
  const erroredLinkIds = new Set(structuralDiagnostics.filter((d) => d.severity === "error" && d.linkId).map((d) => d.linkId!));
  let finalNodes = nodes;
  let finalLinks = links;
  if (erroredNodeIds.size > 0 || erroredLinkIds.size > 0) {
    finalNodes = nodes.filter((n) => !erroredNodeIds.has(n.id));
    const finalNodeIds = new Set(finalNodes.map((n) => n.id));
    finalLinks = links.filter((l) => !erroredLinkIds.has(l.id) && finalNodeIds.has(l.source) && finalNodeIds.has(l.target));
    structuralDiagnostics = validateDisplayGraph(finalNodes, finalLinks);
  }

  assertNotMutated(frozen, snapshotJson, "GraphPayload passed to adaptGraphPayload");

  return { nodes: finalNodes, links: finalLinks, structuralDiagnostics, adapterDiagnostics };
}
