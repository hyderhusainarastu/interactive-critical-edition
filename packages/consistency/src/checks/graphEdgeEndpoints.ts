import type { ConsistencyMismatch } from "../types";
import type { ConsistencySnapshot } from "../snapshot";

const KNOWN_NODE_TYPES = new Set(["work", "bibliographic_record", "concept"]);

/**
 * Check 4 — graph edge endpoints (plan §20.7 bullet 4).
 *
 * `graph_edge.source_id`/`target_id` are plain uuid columns with no FK
 * (necessarily — the table is generically polymorphic over `sourceType`/
 * `targetType`, see the schema's own doc comment), so nothing at the
 * database level stops an edge from dangling after its endpoint is
 * hard-deleted through a path that predates or doesn't yet cover graph-edge
 * cleanup. An edge whose endpoint no longer exists can never render
 * correctly — repair is a safe, non-guessing cleanup: delete the edge. A
 * node type outside the current three-type vocabulary is reported but never
 * deleted (it may be a forward-compatible type this check doesn't know
 * about yet, not necessarily a dangling reference).
 */
export function checkGraphEdgeEndpoints(snapshot: ConsistencySnapshot): ConsistencyMismatch[] {
  const mismatches: ConsistencyMismatch[] = [];
  const workIds = new Set(snapshot.works.map((w) => w.id));
  const bibIds = new Set(snapshot.bibliographicRecords.map((b) => b.id));
  const conceptIds = new Set(snapshot.conceptIds);

  const existsFor = (type: string, id: string): boolean | null => {
    if (type === "work") return workIds.has(id);
    if (type === "bibliographic_record") return bibIds.has(id);
    if (type === "concept") return conceptIds.has(id);
    return null; // unknown type — not our call to judge
  };

  for (const edge of snapshot.graphEdges) {
    const sourceOk = existsFor(edge.sourceType, edge.sourceId);
    const targetOk = existsFor(edge.targetType, edge.targetId);

    const danglingSide: "source" | "target" | null = sourceOk === false ? "source" : targetOk === false ? "target" : null;
    if (danglingSide) {
      mismatches.push({
        checkId: "graph-edge-endpoints",
        entityType: "graph_edge",
        entityId: edge.id,
        description: `graph_edge's ${danglingSide} endpoint (${danglingSide === "source" ? edge.sourceType : edge.targetType}:${danglingSide === "source" ? edge.sourceId : edge.targetId}) no longer exists.`,
        severity: "critical",
        evidence: { sourceType: edge.sourceType, sourceId: edge.sourceId, targetType: edge.targetType, targetId: edge.targetId },
        repair: {
          kind: "delete",
          table: "graph_edge",
          id: edge.id,
          reason: `${danglingSide} endpoint row is gone; an edge that can never resolve to a real node cannot render correctly, and there is no canonical replacement endpoint to guess.`,
        },
      });
      continue;
    }

    if (sourceOk === null && !KNOWN_NODE_TYPES.has(edge.sourceType)) {
      mismatches.push({
        checkId: "graph-edge-endpoints",
        entityType: "graph_edge",
        entityId: edge.id,
        description: `graph_edge.source_type "${edge.sourceType}" is outside the checked vocabulary (work/bibliographic_record/concept) — existence not verified.`,
        severity: "info",
        evidence: { sourceType: edge.sourceType },
        repair: null,
      });
    }
    if (targetOk === null && !KNOWN_NODE_TYPES.has(edge.targetType)) {
      mismatches.push({
        checkId: "graph-edge-endpoints",
        entityType: "graph_edge",
        entityId: edge.id,
        description: `graph_edge.target_type "${edge.targetType}" is outside the checked vocabulary (work/bibliographic_record/concept) — existence not verified.`,
        severity: "info",
        evidence: { targetType: edge.targetType },
        repair: null,
      });
    }
  }

  return mismatches;
}
