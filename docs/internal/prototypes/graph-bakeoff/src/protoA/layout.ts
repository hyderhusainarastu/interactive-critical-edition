/**
 * Deterministic initial-position seeding and semantic-band Z assignment for
 * Prototype A (charter §8/§10/§14 "deterministic layout seed" /
 * "band-constrained Z ... applied as fixed fz").
 *
 * `react-force-graph-3d`'s underlying d3-force layout otherwise seeds
 * initial node positions from `Math.random()`, which is not reproducible
 * across mounts. Placing nodes on a deterministic golden-angle spiral (a
 * pure function of index) before the simulation starts, plus a small
 * seeded jitter, makes the settled layout reproducible given the same
 * frozen fixture — exactly the "deterministic layout seed" the charter
 * requires — without needing to monkey-patch the simulation's RNG.
 *
 * Band Z is assigned in a second pass, after the first free (x/y/z) settle
 * converges: only then is there a real emergent median XY link distance to
 * feed `computeBandGap` (charter §8's own formula), rather than guessing
 * one before layout exists.
 */
import { mulberry32 } from "../fixtures/rng";
import type { FixtureLink, FixtureNode } from "../fixtures/types";
import { bandZ, computeBandGap, maxBandJitter } from "../camera/cameraMath";

const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));

/** Deterministic (index, seed)-only initial XY position, using a
 * golden-angle spiral (inherently deterministic on `index`) plus a bounded
 * seeded jitter so different fixtures don't all look identically spiral. */
export function seededInitialPosition(index: number, seed: number, spacing: number): { x: number; y: number } {
  const angle = index * GOLDEN_ANGLE_RAD;
  const radius = spacing * Math.sqrt(index + 1);
  const rng = mulberry32((seed ^ (index * 2654435761)) >>> 0);
  const jitter = spacing * 0.15;
  const jx = (rng() - 0.5) * 2 * jitter;
  const jy = (rng() - 0.5) * 2 * jitter;
  return { x: Math.cos(angle) * radius + jx, y: Math.sin(angle) * radius + jy };
}

/** FNV-1a string hash — a small, dependency-free, deterministic hash used
 * only for per-node within-band Z jitter (charter §8: "may not exceed 0.08
 * × BAND_GAP and carries no meaning"). Not a security hash; just needs to
 * be a stable pure function of the node id. */
export function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff; // normalized to [0, 1)
}

/** Median of the XY (ignoring Z) Euclidean distance of every non-self link,
 * from each node's *current* simulated position. Used once, right after the
 * first free-settle `onEngineStop`, to derive a real `BAND_GAP` instead of
 * guessing one before any layout exists. */
export function medianXYLinkDistance(
  links: readonly FixtureLink[],
  positionById: ReadonlyMap<string, { x: number; y: number }>,
): number {
  const distances: number[] = [];
  for (const link of links) {
    if (link.isSelfLink) continue;
    const a = positionById.get(link.source);
    const b = positionById.get(link.target);
    if (!a || !b) continue;
    distances.push(Math.hypot(a.x - b.x, a.y - b.y));
  }
  if (distances.length === 0) return 0;
  const sorted = [...distances].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The fixed Z each node should be pinned to (`node.fz`), per charter §8:
 * `bandIndex × BAND_GAP` plus a small deterministic, meaningless jitter
 * bounded by `0.08 × BAND_GAP`, derived from the node id (not a real RNG
 * draw) so it's stable across mounts of the same fixture. */
export function computeFixedZ(node: Pick<FixtureNode, "id" | "bandIndex">, bandGap: number): number {
  const base = bandZ(node.bandIndex, bandGap);
  const maxJitter = maxBandJitter(bandGap);
  const jitter = (stableHash(node.id) * 2 - 1) * maxJitter;
  return base + jitter;
}

export { computeBandGap };
