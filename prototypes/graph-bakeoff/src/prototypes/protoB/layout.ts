/**
 * Deterministic, offline layout pre-pass for Prototype B (charter §13:
 * "Deterministic layout: run d3-force-3d ... OFFLINE in a pre-pass with
 * fixed seed, then render static positions (band-constrained Z)").
 *
 * `d3-force-3d`'s own internal random source (`lcg()` in its
 * `simulation.js`) always starts at the same internal state (`s = 1`) —
 * it is NOT `Math.random()`-backed — so a simulation is already
 * bit-for-bit reproducible given the same node array, forces, and tick
 * count. This module additionally seeds each node's *initial* x/y from the
 * fixture's own `seed` field (via the shared `mulberry32` PRNG already used
 * by fixture generation) so the "fixed seed" requirement is explicit and
 * auditable rather than relying only on the library's undocumented default
 * initialization spiral.
 *
 * `d3-force-3d` is consumed here as a transitive dependency already present
 * in node_modules (pulled in via `three-forcegraph` -> `3d-force-graph` ->
 * `react-force-graph-3d`, all already installed for this isolated bakeoff
 * package — see charter §13, "the force from react-force-graph's dependency
 * tree already installed"). It is deliberately NOT added as an explicit
 * `dependencies` entry in this package's shared `package.json` to avoid an
 * edit conflict with the parallel Prototype A lane's own changes to that
 * same file; it resolves correctly today via npm's flat node_modules.
 *
 * The simulation itself only ever computes X/Y (2 dimensions) — Z is never
 * touched by the force simulation. Z is assigned afterward, once, from each
 * node's semantic `bandIndex` via the shared `cameraMath` band-Z helpers
 * (`computeBandGap`, `bandZ`, `maxBandJitter`), so depth is always a
 * meaningful, band-constrained value, never a force-simulated one.
 */
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force-3d";

import { mulberry32 } from "../../fixtures/rng";
import type { BakeoffFixture, FixtureNode } from "../../fixtures/types";
import { computeBandGap, maxBandJitter, medianOf, bandZ } from "../../camera/cameraMath";

/** Fixed tick count: d3's default alphaDecay assumes ~300 ticks to reach
 * alphaMin (see `d3-force-3d/src/simulation.js`); we call `tick()` this
 * many times synchronously rather than relying on its internal timer, so
 * layout is computed once, offline, before anything renders. */
const SIMULATION_TICKS = 300;

const LINK_DISTANCE = 42;
const CHARGE_STRENGTH = -220;
const COLLIDE_RADIUS = 7;

/** Deterministic FNV-1a style string hash -> unsigned 32-bit int. Used only
 * to derive a stable, reproducible per-node Z jitter offset from the node's
 * own id (never from a random source), so re-running layout for the same
 * fixture always jitters the same node by the same amount. */
function hashStringToUnitFloat(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Map the unsigned 32-bit hash into (-1, 1).
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

interface SimNode {
  index: number;
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

export interface NodeLayout {
  /** World-space X/Y from the offline force pre-pass, Z from band
   * assignment — see module doc. */
  position: readonly [number, number, number];
}

export interface LayoutResult {
  positionsByNodeId: Map<string, readonly [number, number, number]>;
  bandGap: number;
}

/**
 * Runs the deterministic offline layout pre-pass for `fixture` and returns
 * static, band-constrained positions keyed by node id. Pure function of its
 * input (same fixture in, same positions out, every time) — safe to call
 * once per mount, never inside a frame loop.
 */
export function computeLayout(fixture: BakeoffFixture): LayoutResult {
  const rng = mulberry32(fixture.seed + 1);
  const initialRadius = Math.max(20, Math.sqrt(fixture.nodeCount) * 18);

  const simNodes: SimNode[] = fixture.nodes.map((node, index) => {
    const angle = rng() * Math.PI * 2;
    const radius = initialRadius * Math.sqrt(rng());
    return {
      index,
      id: node.id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });

  const linkData: { source: string; target: string }[] = fixture.links.map((l) => ({ source: l.source, target: l.target }));

  const simulation = forceSimulation(simNodes, 2)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(linkData)
        .id((d) => d.id)
        .distance(LINK_DISTANCE),
    )
    .force("charge", forceManyBody().strength(CHARGE_STRENGTH))
    .force("center", forceCenter(0, 0))
    .force("collide", forceCollide(COLLIDE_RADIUS))
    .stop();

  simulation.tick(SIMULATION_TICKS);

  const xyByNodeId = new Map<string, readonly [number, number]>();
  for (const n of simNodes) {
    xyByNodeId.set(n.id, [n.x, n.y]);
  }

  const linkXYDistances: number[] = fixture.links.map((link) => {
    const s = xyByNodeId.get(link.source);
    const t = xyByNodeId.get(link.target);
    if (!s || !t) return 0;
    return Math.hypot(t[0] - s[0], t[1] - s[1]);
  });
  const bandGap = computeBandGap(medianOf(linkXYDistances));
  const jitterMax = maxBandJitter(bandGap);

  const positionsByNodeId = new Map<string, readonly [number, number, number]>();
  const nodeById = new Map<string, FixtureNode>(fixture.nodes.map((n) => [n.id, n]));
  for (const [id, [x, y]] of xyByNodeId) {
    const node = nodeById.get(id);
    const bandIndex = node?.bandIndex ?? 0;
    const jitter = hashStringToUnitFloat(id) * jitterMax;
    const z = bandZ(bandIndex, bandGap) + jitter;
    positionsByNodeId.set(id, [x, y, z]);
  }

  return { positionsByNodeId, bandGap };
}
