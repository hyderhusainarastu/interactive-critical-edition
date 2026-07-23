import { STAGE_ORDER, type CurriculumStage } from "@ice/curriculum";
import { TIER_ORDER } from "@ice/roadmap";
import type { GraphNode } from "./types";

/**
 * Pure client-side layout helpers for the Roadmap layout mode (Phase 22.7 /
 * feature plan §2.3). No DOM, no ThreeJS — every deterministic decision the
 * roadmap scene and progress strip make lives here as a pure function and is
 * unit-tested (run via `pnpm --filter worker exec tsx <path>` — no DB import,
 * so no DATABASE_URL needed, same convention as `graphSceneScaling.test.ts`).
 *
 * The layout is a stage-column DAG: the five `@ice/curriculum` stages become
 * ordered columns along +x ("toward expertise" reads left-to-right;
 * prerequisites leftmost), items sit within each column ordered by priority
 * tier then reading sequence, flat on the z-plane. Fixed positions (`fx/fy/fz`)
 * eliminate the force-simulation hairball AND its per-click rebuild cost in
 * this mode. Uploaded-work anchors that carry no roadmap annotation (the
 * reader's own works, the destination they are building toward) are placed in
 * one trailing column to the right of the stages.
 */

const COLUMN_GAP = 260;
const ROW_GAP = 120;
/** Anchors (uploaded works with no roadmap stage) sit one column past the last
 *  stage — the right-hand "your works" edge of the left-to-right progression. */
const ANCHOR_COLUMN = STAGE_ORDER.length;

const STAGE_COLUMN: Record<CurriculumStage, number> = Object.fromEntries(
  STAGE_ORDER.map((stage, index) => [stage, index]),
) as Record<CurriculumStage, number>;

const TIER_RANK: Record<string, number> = Object.fromEntries(TIER_ORDER.map((tier, index) => [tier, index]));

export interface FixedPosition {
  fx: number;
  fy: number;
  fz: number;
}

function columnFor(node: GraphNode): number {
  return node.roadmap ? STAGE_COLUMN[node.roadmap.stage] : ANCHOR_COLUMN;
}

/**
 * Deterministically assigns a fixed `fx/fy/fz` to every passed node. Roadmap
 * nodes are bucketed into their stage's column (x strictly increases with
 * `STAGE_ORDER`); within a column they are ordered by priority tier, then
 * 1-based reading sequence, then id, and stacked symmetrically around y=0. All
 * nodes are flat on z=0 (the 3D value is the camera/continuity with explore
 * mode, not a third spatial encoding — feature plan §2.1). Anchor nodes without
 * a roadmap annotation go to the trailing anchor column, ordered by label then
 * id. Returns a new `Map` keyed by node id; the input is never mutated.
 */
export function assignStagePositions(nodes: GraphNode[]): Map<string, FixedPosition> {
  const byColumn = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const column = columnFor(node);
    const list = byColumn.get(column) ?? [];
    list.push(node);
    byColumn.set(column, list);
  }

  const positions = new Map<string, FixedPosition>();
  for (const [column, columnNodes] of byColumn) {
    const ordered = [...columnNodes].sort((a, b) => {
      if (a.roadmap && b.roadmap) {
        const tierDelta = TIER_RANK[a.roadmap.tier] - TIER_RANK[b.roadmap.tier];
        if (tierDelta !== 0) return tierDelta;
        if (a.roadmap.sequence !== b.roadmap.sequence) return a.roadmap.sequence - b.roadmap.sequence;
        return a.id.localeCompare(b.id);
      }
      // Anchor column (no roadmap): stable by label then id.
      return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
    });
    const fx = column * COLUMN_GAP;
    const offset = (ordered.length - 1) / 2;
    ordered.forEach((node, row) => {
      positions.set(node.id, { fx, fy: (row - offset) * ROW_GAP, fz: 0 });
    });
  }
  return positions;
}

export interface StageProgress {
  stage: CurriculumStage;
  /** Roadmap nodes assigned to this stage. */
  total: number;
  /** Of those, how many are already known (read / ≥ threshold / completed). */
  known: number;
}

/**
 * Per-stage read counts over the roadmap-annotated nodes, in `STAGE_ORDER` (all
 * five stages always present, even at 0, so the progress strip has a stable
 * shape). Pure function over the same dataset both views filter, so the strip
 * can never disagree with what the scene/table show.
 */
export function progressByStage(nodes: GraphNode[]): StageProgress[] {
  const totals = new Map<CurriculumStage, { total: number; known: number }>();
  for (const stage of STAGE_ORDER) totals.set(stage, { total: 0, known: 0 });
  for (const node of nodes) {
    if (!node.roadmap) continue;
    const bucket = totals.get(node.roadmap.stage);
    if (!bucket) continue;
    bucket.total += 1;
    if (node.roadmap.known) bucket.known += 1;
  }
  return STAGE_ORDER.map((stage) => ({ stage, ...totals.get(stage)! }));
}

/**
 * The first not-yet-known roadmap node in reading-sequence order — the "Next
 * up" target the progress strip highlights and the sequence stepper starts
 * from. Returns `null` when every reached item is already known (or none are
 * annotated). Ties on sequence break by id for determinism.
 */
export function nextUp(nodes: GraphNode[]): GraphNode | null {
  let best: GraphNode | null = null;
  for (const node of nodes) {
    if (!node.roadmap || node.roadmap.known) continue;
    if (
      best === null ||
      node.roadmap!.sequence < best.roadmap!.sequence ||
      (node.roadmap!.sequence === best.roadmap!.sequence && node.id.localeCompare(best.id) < 0)
    ) {
      best = node;
    }
  }
  return best;
}
