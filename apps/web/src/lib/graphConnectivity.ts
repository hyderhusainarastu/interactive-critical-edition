/**
 * Pure, DB-free graph-connectivity helpers extracted out of `graph.ts`
 * (Graph P1, data contract v2 — see docs/PROJECT-LOG.md "Graph redesign")
 * so the two behaviors they implement are unit-testable without a live
 * Postgres connection — the same "pure logic split from DB" pattern already
 * used by `@ice/roadmap`/`apps/web/src/lib/roadmap.ts` and
 * `graphEdgeCategory.ts`/`graph.ts` (`deriveEdgeCategory`).
 */

export interface MinimalNode {
  id: string;
}

/**
 * Which nodes survive into the visible payload. A node survives if it has at
 * least one edge (`connectedIds`), OR it is an always-kept anchor
 * (`alwaysKeepIds`, `graph.ts` passes uploaded-work node ids) — the reader's
 * own library entries, which must stay visible even freshly uploaded with
 * zero edges yet. This corrects a real prior bug: `graph.ts`'s own Phase
 * 12.5 comment already claimed an isolated work "keeps ... visible", but the
 * code silently dropped it like every other unconnected node. Every OTHER
 * isolated node class (reference/source/concept/section) still requires a
 * real edge to appear in the payload — unchanged, only the work-node
 * exemption is new.
 */
export function selectVisualNodes<T extends MinimalNode>(
  allNodes: readonly T[],
  connectedIds: ReadonlySet<string>,
  alwaysKeepIds: ReadonlySet<string>,
): T[] {
  return allNodes.filter((node) => connectedIds.has(node.id) || alwaysKeepIds.has(node.id));
}

export interface ConceptEdgeRow {
  source_id: string;
  target_id: string;
  edge_type: string;
  category: string | null;
  confidence: number;
}

export interface ConceptConceptLink {
  source: string;
  target: string;
  edgeType: string;
  category: string | null;
  confidence: number;
}

/**
 * Maps raw concept↔concept `graph_edge` rows into draft graph links
 * (`concept:<id>` endpoints on both ends). Forward-compat only (Graph P1):
 * verified nothing writes `graph_edge.source_type = 'concept'` today (the
 * only concept-touching writer is Phase 21.2's work→concept classification,
 * `apps/worker/src/analyze.ts`), so `graph.ts` always calls this with zero
 * rows in production until a future worker producer exists (e.g. an
 * inter-concept "presupposes"/"related_to" pass over the concept catalog).
 * Kept pure and separately testable so its exact output shape is pinned down
 * now, rather than only exercised the day such a producer ships.
 */
export function mapConceptConceptEdges(
  rows: readonly ConceptEdgeRow[],
  deriveCategory: (edgeType: string, category: string | null) => string | null,
): ConceptConceptLink[] {
  return rows.map((row) => ({
    source: `concept:${row.source_id}`,
    target: `concept:${row.target_id}`,
    edgeType: row.edge_type,
    category: deriveCategory(row.edge_type, row.category),
    confidence: row.confidence,
  }));
}
