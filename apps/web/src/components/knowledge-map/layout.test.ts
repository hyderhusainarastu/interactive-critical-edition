import assert from "node:assert/strict";
import { LAYER_BAND_INDEX, LAYER_ORDER, maxJitter } from "@ice/graph-display";
import {
  computeBandGap,
  computeFixedZ,
  initialSpacingForNodeCount,
  medianXYLinkDistance,
  seededInitialPosition,
  SMALL_FIXTURE_NODE_CEILING,
  SMALL_FIXTURE_SPACING_MULTIPLIER,
} from "./layout";

/**
 * No `layout.test.ts` exists in the bakeoff for this module (spec §1.1's
 * table: "ported from protoA/layout.test.ts if one exists there, else
 * new"), so this is new coverage. Run via
 * `pnpm --filter web exec tsx apps/web/src/components/knowledge-map/layout.test.ts`.
 */

// --- seededInitialPosition: deterministic, and spreads with index ---
{
  const a1 = seededInitialPosition(5, 42, 26);
  const a2 = seededInitialPosition(5, 42, 26);
  assert.deepEqual(a1, a2, "same (index, seed) always produces the same position");

  const b = seededInitialPosition(6, 42, 26);
  assert.notDeepEqual(a1, b, "different indices produce different positions");

  const differentSeed = seededInitialPosition(5, 7, 26);
  assert.notDeepEqual(a1, differentSeed, "different seeds produce different positions for the same index");

  const origin = seededInitialPosition(0, 42, 26);
  assert.ok(Number.isFinite(origin.x) && Number.isFinite(origin.y), "index 0 must be a safe, finite position");
}
console.log("seededInitialPosition: OK");

// --- initialSpacingForNodeCount: minimum node-separation floor for very
// small layouts (stage3-kmap-verification.md §3 option b) ---
{
  const base = 26;

  // At and below the ceiling: boosted by exactly the documented multiplier.
  for (const count of [1, 2, 3, 4, SMALL_FIXTURE_NODE_CEILING]) {
    assert.equal(
      initialSpacingForNodeCount(count, base),
      base * SMALL_FIXTURE_SPACING_MULTIPLIER,
      `a ${count}-node fixture must get the boosted small-fixture spacing`,
    );
  }

  // Just above the ceiling, and comfortably above it (e.g. the 120-node perf
  // fixture): unchanged from `baseSpacing` — larger graphs are already
  // spread by their own node count and this floor must not dilute the
  // layout the bakeoff's own performance numbers were measured against.
  for (const count of [SMALL_FIXTURE_NODE_CEILING + 1, 20, 120]) {
    assert.equal(initialSpacingForNodeCount(count, base), base, `a ${count}-node graph must be unaffected`);
  }

  // Boosted spacing must actually increase the real distance-from-origin a
  // small fixture's satellites get seeded at, not just the raw parameter —
  // this is the property that actually shrinks each node's apparent
  // (angular) size relative to a fixed-radius sphere, per this file's own
  // top comment.
  const smallSpacing = initialSpacingForNodeCount(4, base);
  const boostedSatellite = seededInitialPosition(1, 42, smallSpacing);
  const baseSatellite = seededInitialPosition(1, 42, base);
  const originDistance = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);
  assert.ok(
    originDistance(boostedSatellite) > originDistance(baseSatellite),
    "a small fixture's boosted spacing must seed satellites strictly farther from the root than the base spacing would",
  );

  // Total function: zero nodes is a safe no-op, never NaN/throw.
  assert.equal(initialSpacingForNodeCount(0, base), base);
}
console.log("initialSpacingForNodeCount: OK");

// --- medianXYLinkDistance ---
{
  const positions = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 3, y: 4 }], // distance 5 from a
    ["c", { x: 0, y: 10 }], // distance 10 from a
  ]);
  const links = [
    { source: "a", target: "b", isSelfLink: false },
    { source: "a", target: "c", isSelfLink: false },
    { source: "a", target: "a", isSelfLink: true }, // must be excluded
  ];
  const median = medianXYLinkDistance(links, positions);
  assert.equal(median, 7.5, "median of [5, 10] is 7.5, self-link excluded");
  assert.equal(medianXYLinkDistance([], positions), 0, "no links -> 0, not NaN/throw");
}
console.log("medianXYLinkDistance: OK");

// --- computeFixedZ: composes zForLayer/deterministicJitter correctly for every layer ---
{
  const bandGap = computeBandGap(80); // 1.25*80 = 100, inside [48,120]
  assert.equal(bandGap, 100);
  const cap = maxJitter(bandGap);

  for (const layer of LAYER_ORDER) {
    const z = computeFixedZ({ id: `node:${layer}`, layer }, bandGap);
    const base = LAYER_BAND_INDEX[layer] * bandGap;
    assert.ok(Math.abs(z - base) <= cap + 1e-9, `${layer}: z must stay within the jitter cap of its band base`);
  }

  // Same id -> same jitter -> same z, every time (deterministic layout seed).
  const z1 = computeFixedZ({ id: "work:abc", layer: "intellectual" }, bandGap);
  const z2 = computeFixedZ({ id: "work:abc", layer: "intellectual" }, bandGap);
  assert.equal(z1, z2);

  // Different ids in the SAME band can land at different z (jitter is
  // per-id), but never cross into a neighboring band's range.
  const zA = computeFixedZ({ id: "claim:a", layer: "claim" }, bandGap);
  const zB = computeFixedZ({ id: "claim:zzzzzzzz", layer: "claim" }, bandGap);
  assert.ok(Math.abs(zA - 0) <= cap + 1e-9);
  assert.ok(Math.abs(zB - 0) <= cap + 1e-9);
}
console.log("computeFixedZ: OK");

console.log("layout.test.ts: all assertions passed");
