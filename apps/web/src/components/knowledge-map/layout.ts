/**
 * Deterministic initial-position seeding and semantic-band Z assignment
 * (charter §8/§10/§14 "deterministic layout seed" / "band-constrained Z ...
 * applied as fixed fz"). Ported from
 * `prototypes/graph-bakeoff/src/protoA/layout.ts` per spec §1.1.
 *
 * `react-force-graph-3d`'s underlying d3-force layout otherwise seeds
 * initial node positions from `Math.random()`, which is not reproducible
 * across mounts. Placing nodes on a deterministic golden-angle spiral (a
 * pure function of index) before the simulation starts, plus a small
 * seeded jitter, makes the settled layout reproducible given the same
 * frozen display selection — exactly the "deterministic layout seed" the
 * charter requires — without needing to monkey-patch the simulation's RNG.
 *
 * Band Z is assigned in a second pass, after the first free (x/y/z) settle
 * converges: only then is there a real emergent median XY link distance to
 * feed `computeBandGap` (charter §8's own formula), rather than guessing
 * one before layout exists.
 *
 * §1.3 reconciliation: this file imports `computeBandGap`/`zForLayer`/
 * `deterministicJitter` from `@ice/graph-display` (`./bands.ts`) rather
 * than from a `cameraMath`/`camera.ts` copy — those three functions were
 * deliberately deleted from `camera.ts` at port time (see that module's
 * own top comment) precisely so `layout.ts` has exactly one place to get
 * band-Z math from.
 */
import { computeBandGap, deterministicJitter, zForLayer, type Layer } from "@ice/graph-display";

const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5));

/** Deterministic (index, seed)-only initial XY position, using a
 * golden-angle spiral (inherently deterministic on `index`) plus a bounded
 * seeded jitter so different graphs don't all look identically spiral. */
export function seededInitialPosition(index: number, seed: number, spacing: number): { x: number; y: number } {
  const angle = index * GOLDEN_ANGLE_RAD;
  const radius = spacing * Math.sqrt(index + 1);
  const rng = mulberry32((seed ^ (index * 2654435761)) >>> 0);
  const jitter = spacing * 0.15;
  const jx = (rng() - 0.5) * 2 * jitter;
  const jy = (rng() - 0.5) * 2 * jitter;
  return { x: Math.cos(angle) * radius + jx, y: Math.sin(angle) * radius + jy };
}

/** mulberry32 — a small, dependency-free, deterministic PRNG (same
 * generator `@ice/graph-display`'s own test fixtures use), seeded per-node
 * so the initial jitter is reproducible across mounts of the same data. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Median of the XY (ignoring Z) Euclidean distance of every non-self link,
 * from each node's *current* simulated position. Used once, right after the
 * first free-settle `onEngineStop`, to derive a real `BAND_GAP` instead of
 * guessing one before any layout exists. */
export function medianXYLinkDistance(
  links: readonly { source: string; target: string; isSelfLink: boolean }[],
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
 * bounded by `0.08 × BAND_GAP`, derived from the node's own stable display
 * id (not a real RNG draw) so it's stable across mounts of the same data.
 * Delegates the actual index-lookup/jitter-clamp arithmetic to
 * `@ice/graph-display`'s `zForLayer`/`deterministicJitter` (§1.3
 * reconciliation — see this file's top comment) rather than reimplementing
 * either. */
export function computeFixedZ(node: { id: string; layer: Layer }, bandGap: number): number {
  const jitter = deterministicJitter(node.id, bandGap);
  return zForLayer(node.layer, bandGap, jitter);
}

export { computeBandGap };
