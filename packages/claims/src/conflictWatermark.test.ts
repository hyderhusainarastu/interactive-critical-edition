import { describe, expect, it } from "vitest";
import { computeConflictWatermark } from "./conflictWatermark";

describe("computeConflictWatermark", () => {
  it("is order-independent (sorts before hashing)", () => {
    expect(computeConflictWatermark(["b", "a", "c"])).toBe(computeConflictWatermark(["c", "b", "a"]));
  });

  it("is stable for the same set across repeated calls", () => {
    expect(computeConflictWatermark(["rel-1", "rel-2"])).toBe(computeConflictWatermark(["rel-1", "rel-2"]));
  });

  it("changes when a relationship is added to the set", () => {
    const before = computeConflictWatermark([]);
    const after = computeConflictWatermark(["rel-1"]);
    expect(before).not.toBe(after);
  });

  it("changes when a relationship is removed from the set (e.g. later disputed)", () => {
    const before = computeConflictWatermark(["rel-1", "rel-2"]);
    const after = computeConflictWatermark(["rel-1"]);
    expect(before).not.toBe(after);
  });

  it("the empty set has a stable, non-empty watermark (the owner's own 0-conflict starting case)", () => {
    const watermark = computeConflictWatermark([]);
    expect(watermark).toBe(computeConflictWatermark([]));
    expect(watermark.length).toBeGreaterThan(0);
  });
});
