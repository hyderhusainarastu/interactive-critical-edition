import { describe, expect, it } from "vitest";
import { assignSplit, splitItems } from "./split";

describe("assignSplit", () => {
  it("is deterministic — the same id always gets the same assignment", () => {
    const first = assignSplit("claim-1234");
    for (let i = 0; i < 5; i++) {
      expect(assignSplit("claim-1234")).toBe(first);
    }
  });

  it("throws for an out-of-range testFrac", () => {
    expect(() => assignSplit("x", -0.1)).toThrow(/testFrac must be in \[0,1\]/);
    expect(() => assignSplit("x", 1.1)).toThrow(/testFrac must be in \[0,1\]/);
  });

  it("testFrac=0 always assigns train", () => {
    for (const id of ["a", "b", "c", "d", "e"]) expect(assignSplit(id, 0)).toBe("train");
  });

  it("testFrac=1 always assigns test", () => {
    for (const id of ["a", "b", "c", "d", "e"]) expect(assignSplit(id, 1)).toBe("test");
  });

  it("the observed test fraction over many ids is statistically close to testFrac", () => {
    const testFrac = 0.3;
    let testCount = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (assignSplit(`item-${i}`, testFrac) === "test") testCount += 1;
    }
    const observed = testCount / n;
    // Generous tolerance — this is a statistical property, not exact.
    expect(observed).toBeGreaterThan(0.25);
    expect(observed).toBeLessThan(0.35);
  });
});

describe("splitItems", () => {
  it("partitions every item into exactly one of train/test", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `item-${i}` }));
    const { train, test } = splitItems(items);
    expect(train.length + test.length).toBe(50);
  });

  it("re-splitting the same items produces the same partition (idempotent)", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `item-${i}` }));
    const first = splitItems(items);
    const second = splitItems(items);
    expect(first.train.map((i) => i.id)).toEqual(second.train.map((i) => i.id));
    expect(first.test.map((i) => i.id)).toEqual(second.test.map((i) => i.id));
  });

  it("adding a new item does not reshuffle any existing item's assignment", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `item-${i}` }));
    const before = splitItems(items);
    const beforeTrainIds = new Set(before.train.map((i) => i.id));
    const beforeTestIds = new Set(before.test.map((i) => i.id));

    const after = splitItems([...items, { id: "item-new" }]);
    for (const id of beforeTrainIds) expect(after.train.some((i) => i.id === id)).toBe(true);
    for (const id of beforeTestIds) expect(after.test.some((i) => i.id === id)).toBe(true);
  });
});
