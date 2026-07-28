/**
 * Pure node-scale formula, charter §10 ("Sizing"):
 *
 *   degreeComponent = sqrt(min(visibleDegree, p95VisibleDegree) / max(1, p95VisibleDegree))
 *   scale = 0.9 + 0.35 × degreeComponent
 *   + 0.15 for a direct evidence-anchored claim/evidence neighbor of the root
 *   + 0.05 for an aggregate-summary node
 *   clamp to 0.8–1.6
 *   root overridden to exactly 1.5
 *
 * Ported verbatim from `prototypes/graph-bakeoff/src/protoA/sizing.ts` per
 * spec §1.1 — no product-specific logic, kept dependency-free and pure so
 * it's directly unit-testable without a renderer, same convention as
 * `@ice/graph-display/camera.ts`.
 */

export const MIN_SCALE = 0.8;
export const MAX_SCALE = 1.6;
export const ROOT_SCALE = 1.5;
const BASE_SCALE = 0.9;
const DEGREE_WEIGHT = 0.35;
const EVIDENCE_NEIGHBOR_BONUS = 0.15;
const AGGREGATE_BONUS = 0.05;

export interface NodeScaleParams {
  isRoot: boolean;
  visibleDegree: number;
  p95VisibleDegree: number;
  isDirectEvidenceNeighborOfRoot: boolean;
  isAggregate: boolean;
}

export function computeNodeScale(params: NodeScaleParams): number {
  if (params.isRoot) return ROOT_SCALE;

  const denom = Math.max(1, params.p95VisibleDegree);
  const capped = Math.min(Math.max(0, params.visibleDegree), params.p95VisibleDegree);
  const degreeComponent = Math.sqrt(Math.max(0, capped) / denom);

  let scale = BASE_SCALE + DEGREE_WEIGHT * degreeComponent;
  if (params.isDirectEvidenceNeighborOfRoot) scale += EVIDENCE_NEIGHBOR_BONUS;
  if (params.isAggregate) scale += AGGREGATE_BONUS;

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Nearest-rank percentile (0-100) of `values`. Returns 0 for an empty
 * input. Duplicated (not imported) from the bakeoff's bench runner
 * deliberately — that module belongs to the bench harness, not to the
 * production scene, and this file must stay a self-contained,
 * zero-dependency unit. */
export function percentileOf(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

/** Computes each visible node's degree counted only over currently visible
 * links (charter's "visibleDegree", distinct from a node's static
 * full-graph degree) plus the resulting p95 across all visible nodes. */
export function computeVisibleDegrees(
  nodeIds: readonly string[],
  links: ReadonlyArray<{ source: string; target: string; isSelfLink: boolean }>,
  isLinkVisible: (link: { source: string; target: string; isSelfLink: boolean }) => boolean,
): { visibleDegreeById: Map<string, number>; p95VisibleDegree: number } {
  const visibleDegreeById = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  for (const link of links) {
    if (!isLinkVisible(link)) continue;
    if (link.isSelfLink) {
      visibleDegreeById.set(link.source, (visibleDegreeById.get(link.source) ?? 0) + 1);
      continue;
    }
    visibleDegreeById.set(link.source, (visibleDegreeById.get(link.source) ?? 0) + 1);
    visibleDegreeById.set(link.target, (visibleDegreeById.get(link.target) ?? 0) + 1);
  }
  const p95VisibleDegree = percentileOf([...visibleDegreeById.values()], 95);
  return { visibleDegreeById, p95VisibleDegree };
}
