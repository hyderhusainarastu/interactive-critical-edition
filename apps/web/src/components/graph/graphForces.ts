// Relative import, not the `@/*` alias: this module (like
// `graphSceneScaling.ts`/`graphFocus.ts`) is invoked directly via bare
// `tsx` for its unit test — no Next.js/webpack path-alias resolution
// available there.
import type { GraphLink, GraphNode } from "./types";

/**
 * Graph P4 (concept clustering, plan's "mild attraction ... between
 * resources and their shared concept nodes"): the pure half of the new
 * clustering force — which node PAIRS should feel it — kept out of
 * `KnowledgeGraph3D.tsx` and registered via `d3-force-3d`'s own `forceLink`
 * (not hand-rolled force math) in the existing `d3Force` effect, the same
 * "reuse a well-tested d3 force rather than reinventing one" choice the
 * pre-existing `forceCollide` registration already makes.
 *
 * A "resource" is any node type a reader actually READS (work/reference/
 * peer_reviewed_source/online_source) — concept/person/section nodes are
 * never resources themselves, so a concept-to-concept edge (were one to
 * exist) is deliberately excluded; the plan's own wording is specifically
 * "resources and their shared concept nodes".
 */
const RESOURCE_TYPES: ReadonlySet<GraphNode["type"]> = new Set(["work", "reference", "peer_reviewed_source", "online_source"]);

/** Mild — noticeably weaker than the ordinary link force so clusters form
 *  without collapsing the whole graph onto its concept nodes. */
export const CONCEPT_ATTRACTION_STRENGTH = 0.03;

export interface ConceptAttractionPair {
  /** Always the RESOURCE end, normalized regardless of the source edge's
   *  own source/target order — a caller iterating pairs never has to
   *  re-check which end is which. */
  source: string;
  /** Always the CONCEPT end. */
  target: string;
}

function linkEndpointId(end: GraphLink["source"] | GraphLink["target"]): string {
  return typeof end === "string" ? end : (end as { id: string }).id;
}

/**
 * Every graph edge that directly connects a resource-type node to a
 * concept-type node becomes one attraction pair — "shared concept" is
 * exactly the set of concepts a resource is already linked to in the
 * payload (no second, independently-derived notion of "shares a concept
 * with"). Pure and deterministic: same input, same pairs, in the same
 * order every time (stable for both the force registration and this
 * module's own tests).
 */
export function computeConceptAttractionPairs(
  nodes: readonly Pick<GraphNode, "id" | "type">[],
  links: readonly Pick<GraphLink, "source" | "target">[],
): ConceptAttractionPair[] {
  const typeById = new Map(nodes.map((node) => [node.id, node.type]));
  const pairs: ConceptAttractionPair[] = [];
  for (const link of links) {
    const sourceId = linkEndpointId(link.source);
    const targetId = linkEndpointId(link.target);
    const sourceType = typeById.get(sourceId);
    const targetType = typeById.get(targetId);
    if (sourceType == null || targetType == null) continue;
    if (RESOURCE_TYPES.has(sourceType) && targetType === "concept") {
      pairs.push({ source: sourceId, target: targetId });
    } else if (RESOURCE_TYPES.has(targetType) && sourceType === "concept") {
      pairs.push({ source: targetId, target: sourceId });
    }
  }
  return pairs;
}
