import assert from "node:assert/strict";
import { STAGE_ORDER } from "@ice/curriculum";
import { assignStagePositions, nextUp, progressByStage } from "./roadmapLayout";
import type { GraphNode, RoadmapAnnotation } from "./types";

/**
 * Phase 22.7 (feature plan §2.3/§5 Feature A) regression for the pure roadmap
 * layout helpers — the deterministic geometry/progress decisions the Roadmap
 * scene and progress strip make. No DB, no DOM. Run via
 * `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `graphSceneScaling.test.ts` — no DATABASE_URL needed).
 */

function ann(overrides: Partial<RoadmapAnnotation>): RoadmapAnnotation {
  return {
    stage: "prerequisites",
    tier: "essential",
    sequence: 1,
    known: false,
    reason: "",
    checkpoint: "",
    category: "prerequisite",
    confidence: 0.9,
    estimatedMinutes: 600,
    addedManually: false,
    overridden: false,
    rootWorkIds: ["work:1"],
    ...overrides,
  };
}

function node(overrides: Partial<GraphNode> & Pick<GraphNode, "id" | "type" | "uploaded">): GraphNode {
  return {
    label: overrides.id,
    state: "unread",
    associatedWorkIds: [],
    destination: null,
    authors: null,
    year: null,
    url: null,
    ...overrides,
  };
}

const nodes: GraphNode[] = [
  node({ id: "work:1", type: "work", uploaded: true, state: "primary" }), // anchor, no roadmap
  node({ id: "external:bib:1", type: "reference", uploaded: false, roadmap: ann({ stage: "prerequisites", tier: "essential", sequence: 1, known: false }) }),
  node({ id: "external:bib:2", type: "reference", uploaded: false, roadmap: ann({ stage: "prerequisites", tier: "high", sequence: 2, known: true }) }),
  node({ id: "external:bib:3", type: "reference", uploaded: false, roadmap: ann({ stage: "core_engagement", tier: "strongly_recommended", sequence: 3, known: false }) }),
  node({ id: "external:bib:4", type: "reference", uploaded: false, roadmap: ann({ stage: "extension", tier: "optional", sequence: 5, known: false }) }),
];

// --- assignStagePositions: determinism ---
{
  const a = assignStagePositions(nodes);
  const b = assignStagePositions(nodes);
  assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort(), "assignStagePositions must be deterministic across calls");
}

// --- assignStagePositions: x strictly follows STAGE_ORDER, anchors trail ---
{
  const p = assignStagePositions(nodes);
  const fx = (id: string) => p.get(id)!.fx;
  assert.ok(fx("external:bib:1") < fx("external:bib:3"), "prerequisites column is left of core_engagement");
  assert.ok(fx("external:bib:3") < fx("external:bib:4"), "core_engagement is left of extension");
  assert.ok(fx("external:bib:4") < fx("work:1"), "the anchor column trails every stage column");
  // Exact column math: prerequisites=col0, core_engagement=col2, extension=col4, anchor=col5.
  assert.equal(fx("external:bib:1"), 0, "prerequisites is column 0 (fx 0)");
  assert.equal(fx("external:bib:3"), STAGE_ORDER.indexOf("core_engagement") * 260);
  assert.equal(fx("work:1"), STAGE_ORDER.length * 260, "anchor sits one column past the last stage");
  // All flat on z.
  for (const pos of p.values()) assert.equal(pos.fz, 0, "roadmap layout is flat on the z-plane");
}

// --- assignStagePositions: within a column, tier then sequence orders rows ---
{
  const p = assignStagePositions(nodes);
  // bib:1 (tier essential) above bib:2 (tier high) in the prerequisites column.
  assert.ok(p.get("external:bib:1")!.fy < p.get("external:bib:2")!.fy, "essential sits above high within the same stage column");
  // Same column ⇒ same fx.
  assert.equal(p.get("external:bib:1")!.fx, p.get("external:bib:2")!.fx, "same-stage nodes share a column x");
}

// --- progressByStage: all five stages present, counts correct ---
{
  const progress = progressByStage(nodes);
  assert.deepEqual(progress.map((s) => s.stage), STAGE_ORDER, "progressByStage returns every stage in STAGE_ORDER");
  const byStage = new Map(progress.map((s) => [s.stage, s]));
  assert.deepEqual({ total: byStage.get("prerequisites")!.total, known: byStage.get("prerequisites")!.known }, { total: 2, known: 1 });
  assert.deepEqual({ total: byStage.get("core_engagement")!.total, known: byStage.get("core_engagement")!.known }, { total: 1, known: 0 });
  assert.deepEqual({ total: byStage.get("extension")!.total, known: byStage.get("extension")!.known }, { total: 1, known: 0 });
  assert.equal(byStage.get("formative_context")!.total, 0, "a stage with no reached items still appears at 0");
}

// --- nextUp: first non-known item in reading sequence ---
{
  const first = nextUp(nodes);
  assert.equal(first?.id, "external:bib:1", "next up is the earliest-sequence item that is not yet known");
}
{
  const allKnown = nodes.map((n) => (n.roadmap ? { ...n, roadmap: { ...n.roadmap, known: true } } : n));
  assert.equal(nextUp(allKnown), null, "next up is null when every reached item is known");
}
{
  assert.equal(nextUp([node({ id: "work:1", type: "work", uploaded: true })]), null, "next up is null when nothing is annotated");
}

console.log("roadmapLayout.test.ts: all assertions passed");
