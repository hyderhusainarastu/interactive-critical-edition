import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
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
 * new"), so this is new coverage.
 */

describe("seededInitialPosition", () => {
  // --- seededInitialPosition: deterministic, and spreads with index ---
  it("is deterministic per (index, seed), spreads with index/seed, and is safe at index 0", () => {
    const a1 = seededInitialPosition(5, 42, 26);
    const a2 = seededInitialPosition(5, 42, 26);
    // same (index, seed) always produces the same position
    expect(a1).toEqual(a2);

    const b = seededInitialPosition(6, 42, 26);
    assert.notDeepEqual(a1, b, "different indices produce different positions");

    const differentSeed = seededInitialPosition(5, 7, 26);
    assert.notDeepEqual(a1, differentSeed, "different seeds produce different positions for the same index");

    const origin = seededInitialPosition(0, 42, 26);
    // index 0 must be a safe, finite position
    expect(Number.isFinite(origin.x) && Number.isFinite(origin.y)).toBeTruthy();
  });
});

describe("initialSpacingForNodeCount", () => {
  // --- initialSpacingForNodeCount: minimum node-separation floor for very
  // small layouts (stage3-kmap-verification.md §3 option b) ---
  it("boosts spacing at/below the small-fixture ceiling and leaves larger graphs untouched", () => {
    const base = 26;

    // At and below the ceiling: boosted by exactly the documented multiplier.
    for (const count of [1, 2, 3, 4, SMALL_FIXTURE_NODE_CEILING]) {
      // a `${count}`-node fixture must get the boosted small-fixture spacing
      expect(initialSpacingForNodeCount(count, base)).toBe(base * SMALL_FIXTURE_SPACING_MULTIPLIER);
    }

    // Just above the ceiling, and comfortably above it (e.g. the 120-node perf
    // fixture): unchanged from `baseSpacing` — larger graphs are already
    // spread by their own node count and this floor must not dilute the
    // layout the bakeoff's own performance numbers were measured against.
    for (const count of [SMALL_FIXTURE_NODE_CEILING + 1, 20, 120]) {
      // a `${count}`-node graph must be unaffected
      expect(initialSpacingForNodeCount(count, base)).toBe(base);
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
    // a small fixture's boosted spacing must seed satellites strictly farther
    // from the root than the base spacing would
    expect(originDistance(boostedSatellite) > originDistance(baseSatellite)).toBeTruthy();

    // Total function: zero nodes is a safe no-op, never NaN/throw.
    expect(initialSpacingForNodeCount(0, base)).toBe(base);
  });
});

describe("medianXYLinkDistance", () => {
  it("takes the median of link distances, excluding self-links, and returns 0 for no links", () => {
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
    // median of [5, 10] is 7.5, self-link excluded
    expect(median).toBe(7.5);
    // no links -> 0, not NaN/throw
    expect(medianXYLinkDistance([], positions)).toBe(0);
  });
});

describe("computeFixedZ", () => {
  // --- computeFixedZ: composes zForLayer/deterministicJitter correctly for every layer ---
  it("keeps every layer's z within the jitter cap of its band base, deterministically per id", () => {
    const bandGap = computeBandGap(80); // 1.25*80 = 100, inside [48,120]
    expect(bandGap).toBe(100);
    const cap = maxJitter(bandGap);

    for (const layer of LAYER_ORDER) {
      const z = computeFixedZ({ id: `node:${layer}`, layer }, bandGap);
      const base = LAYER_BAND_INDEX[layer] * bandGap;
      // `${layer}`: z must stay within the jitter cap of its band base
      expect(Math.abs(z - base) <= cap + 1e-9).toBeTruthy();
    }

    // Same id -> same jitter -> same z, every time (deterministic layout seed).
    const z1 = computeFixedZ({ id: "work:abc", layer: "intellectual" }, bandGap);
    const z2 = computeFixedZ({ id: "work:abc", layer: "intellectual" }, bandGap);
    expect(z1).toBe(z2);

    // Different ids in the SAME band can land at different z (jitter is
    // per-id), but never cross into a neighboring band's range.
    const zA = computeFixedZ({ id: "claim:a", layer: "claim" }, bandGap);
    const zB = computeFixedZ({ id: "claim:zzzzzzzz", layer: "claim" }, bandGap);
    expect(Math.abs(zA - 0) <= cap + 1e-9).toBeTruthy();
    expect(Math.abs(zB - 0) <= cap + 1e-9).toBeTruthy();
  });
});
