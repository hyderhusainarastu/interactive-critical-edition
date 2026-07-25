import assert from "node:assert/strict";
import { mapConceptConceptEdges, selectVisualNodes } from "./graphConnectivity";

/**
 * Graph P1 (data contract v2) regression coverage for the two pure helpers
 * extracted out of `graph.ts` so they're testable without a live Postgres
 * connection — the isolated-uploaded-work-node retention rule and the
 * concept↔concept edge mapping. Run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `graphEdgeCategory.test.ts`/`matchNoteToBlock.test.ts` — this module has
 * no DB import, so it needs no DATABASE_URL).
 */

// --- selectVisualNodes: isolated uploaded-work-node retention ---
{
  const nodes = [
    { id: "work:1" }, // uploaded, isolated — must survive (the fix)
    { id: "work:2" }, // uploaded, connected — must survive
    { id: "external:bib:1" }, // connected reference — must survive
    { id: "concept:1" }, // isolated concept — must still drop
    { id: "external:bib:2" }, // isolated reference — must still drop
  ];
  const connectedIds = new Set(["work:2", "external:bib:1"]);
  const alwaysKeepIds = new Set(["work:1", "work:2"]);
  const result = selectVisualNodes(nodes, connectedIds, alwaysKeepIds);
  assert.deepEqual(
    new Set(result.map((n) => n.id)),
    new Set(["work:1", "work:2", "external:bib:1"]),
    "an isolated uploaded work survives via alwaysKeepIds; every other isolated node class still drops",
  );
}

// --- selectVisualNodes: a work with zero edges AND not in alwaysKeepIds still drops ---
// (guards against alwaysKeepIds silently becoming a global escape hatch —
// only ids the caller actually names survive on that basis alone.)
{
  const nodes = [{ id: "work:1" }, { id: "work:2" }];
  const result = selectVisualNodes(nodes, new Set<string>(), new Set(["work:1"]));
  assert.deepEqual(new Set(result.map((n) => n.id)), new Set(["work:1"]), "only the named anchor survives, not every node of the same shape");
}

// --- selectVisualNodes never mutates its input ---
{
  const nodes = Object.freeze([Object.freeze({ id: "work:1" })]);
  const result = selectVisualNodes(nodes, new Set<string>(), new Set(["work:1"]));
  assert.notEqual(result, nodes, "must return a new array");
}

// --- mapConceptConceptEdges: shape + category derivation ---
{
  const deriveCategory = (edgeType: string, category: string | null) => category ?? (edgeType === "presupposes" ? "prerequisite" : null);
  const rows = [
    { source_id: "a", target_id: "b", edge_type: "presupposes", category: null, confidence: 0.8 },
    { source_id: "c", target_id: "d", edge_type: "influences", category: "conceptual_influence", confidence: 0.5 },
  ];
  const links = mapConceptConceptEdges(rows, deriveCategory);
  assert.deepEqual(links, [
    { source: "concept:a", target: "concept:b", edgeType: "presupposes", category: "prerequisite", confidence: 0.8 },
    { source: "concept:c", target: "concept:d", edgeType: "influences", category: "conceptual_influence", confidence: 0.5 },
  ]);
}

// --- mapConceptConceptEdges: the forward-compat guard is empirically a
//     no-op today — zero rows in, zero links out. ---
{
  const links = mapConceptConceptEdges([], () => null);
  assert.deepEqual(links, [], "no concept-concept graph_edge rows exist in production today — this must stay a true no-op");
}

console.log("graphConnectivity.test.ts: all assertions passed");
