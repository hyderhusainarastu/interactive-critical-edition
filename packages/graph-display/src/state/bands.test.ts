import { describe, expect, it } from "vitest";
import {
  AggregateLayerLookupError,
  DEFAULT_CANONICAL_NODE_TYPE_LAYER,
  DISPLAY_ONLY_KIND_LAYER,
  computeBandGap,
  deterministicJitter,
  layerForDisplayKind,
  maxJitter,
  zForLayer,
} from "./bands";
import { CANONICAL_NODE_TYPES, DISPLAY_ONLY_KINDS } from "./kinds";
import { LAYER_BAND_INDEX, LAYER_ORDER } from "./layers";

describe("computeBandGap", () => {
  it("clamps to a floor of 48", () => {
    expect(computeBandGap(0)).toBe(48);
    expect(computeBandGap(10)).toBe(48); // 1.25*10=12.5, floored to 48
  });

  it("clamps to a ceiling of 120", () => {
    expect(computeBandGap(1000)).toBe(120);
  });

  it("computes 1.25x the median inside the clamp range", () => {
    expect(computeBandGap(80)).toBe(100); // 1.25*80=100, inside [48,120]
  });

  it("boundary: exactly the floor/ceiling inputs", () => {
    expect(computeBandGap(48 / 1.25)).toBeCloseTo(48, 10);
    expect(computeBandGap(120 / 1.25)).toBeCloseTo(120, 10);
  });
});

describe("maxJitter", () => {
  it("is 0.08 x bandGap", () => {
    expect(maxJitter(100)).toBeCloseTo(8, 10);
    expect(maxJitter(48)).toBeCloseTo(3.84, 10);
  });
});

describe("zForLayer", () => {
  it("places each layer at bandIndex x bandGap with zero jitter", () => {
    const bandGap = 100;
    for (const layer of LAYER_ORDER) {
      expect(zForLayer(layer, bandGap, 0)).toBe(LAYER_BAND_INDEX[layer] * bandGap);
    }
  });

  it("adds jitter within the cap", () => {
    expect(zForLayer("claim", 100, 5)).toBe(0 * 100 + 5);
    expect(zForLayer("debate", 100, -5)).toBe(1 * 100 - 5);
  });

  it("clamps jitter that exceeds the cap instead of leaking across a band boundary", () => {
    const bandGap = 100; // cap = 8
    expect(zForLayer("claim", bandGap, 1000)).toBe(8);
    expect(zForLayer("claim", bandGap, -1000)).toBe(-8);
  });
});

describe("deterministicJitter", () => {
  it("is reproducible for the same seed", () => {
    const a = deterministicJitter("work:abc-123", 100);
    const b = deterministicJitter("work:abc-123", 100);
    expect(a).toBe(b);
  });

  it("stays within the jitter cap for the given bandGap", () => {
    const bandGap = 60;
    const cap = maxJitter(bandGap);
    for (const seed of ["a", "work:1", "external:bib:xyz", "claim:99999999-aaaa-bbbb"]) {
      const j = deterministicJitter(seed, bandGap);
      expect(j).toBeGreaterThanOrEqual(-cap);
      expect(j).toBeLessThan(cap);
    }
  });

  it("differs across different seeds (not a constant function)", () => {
    const values = new Set(["a", "b", "c", "d", "e"].map((s) => deterministicJitter(s, 100)));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("layerForDisplayKind — totality", () => {
  it("has a default layer for every current canonical NodeType value", () => {
    for (const kind of CANONICAL_NODE_TYPES) {
      expect(() => layerForDisplayKind(kind)).not.toThrow();
      expect(LAYER_ORDER).toContain(layerForDisplayKind(kind));
    }
  });

  it("has a static layer for every DisplayOnlyKind except 'aggregate'", () => {
    for (const kind of DISPLAY_ONLY_KINDS) {
      if (kind === "aggregate") continue;
      expect(() => layerForDisplayKind(kind)).not.toThrow();
      expect(LAYER_ORDER).toContain(layerForDisplayKind(kind));
    }
  });

  it("'aggregate' deliberately throws a typed error rather than a static default", () => {
    expect(() => layerForDisplayKind("aggregate")).toThrow(AggregateLayerLookupError);
  });

  it("DEFAULT_CANONICAL_NODE_TYPE_LAYER covers exactly the 9 canonical kinds, no more/fewer", () => {
    expect(Object.keys(DEFAULT_CANONICAL_NODE_TYPE_LAYER).sort()).toEqual([...CANONICAL_NODE_TYPES].sort());
  });

  it("DISPLAY_ONLY_KIND_LAYER covers every DisplayOnlyKind except 'aggregate', no more/fewer", () => {
    const expected = DISPLAY_ONLY_KINDS.filter((k) => k !== "aggregate").sort();
    expect(Object.keys(DISPLAY_ONLY_KIND_LAYER).sort()).toEqual(expected);
  });

  it("a caller-supplied canonicalLayer callback overrides the default for canonical kinds", () => {
    expect(layerForDisplayKind("work", () => "research")).toBe("research");
  });

  it("charter §8 example placements hold: passages/evidence -> evidence, claims -> claim, debates -> debate", () => {
    expect(layerForDisplayKind("passage")).toBe("evidence");
    expect(layerForDisplayKind("evidence")).toBe("evidence");
    expect(layerForDisplayKind("claim")).toBe("claim");
    expect(layerForDisplayKind("debate")).toBe("debate");
    expect(layerForDisplayKind("question")).toBe("debate");
    expect(layerForDisplayKind("position")).toBe("debate");
    expect(layerForDisplayKind("learning_step")).toBe("learning");
    expect(layerForDisplayKind("hypothesis")).toBe("research");
    expect(layerForDisplayKind("gap")).toBe("research");
    expect(layerForDisplayKind("writing_project")).toBe("research");
  });
});
