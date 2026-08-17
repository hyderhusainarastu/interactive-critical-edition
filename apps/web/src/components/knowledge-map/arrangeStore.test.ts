import { describe, expect, it } from "vitest";
import { arrangeStoreKey, getPinnedPositions, pinPosition, resetLayout, unpinPosition, type StorageLike } from "./arrangeStore";

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("arrangeStore", () => {
  // --- key scoping: user + context kind + context id all matter ---
  it("key scoping: user + context kind + context id all matter", () => {
    expect(arrangeStoreKey("u1", "work", "w1")).not.toBe(arrangeStoreKey("u2", "work", "w1"));
    expect(arrangeStoreKey("u1", "work", "w1")).not.toBe(arrangeStoreKey("u1", "passage", "w1"));
    expect(arrangeStoreKey("u1", "work", "w1")).not.toBe(arrangeStoreKey("u1", "work", "w2"));
  });

  // --- empty/corrupted/malformed storage all read as {} ---
  it("empty/corrupted/malformed storage all read as {}", () => {
    const storage = fakeStorage();
    // missing key reads as {}
    expect(getPinnedPositions("u1", "work", "w1", storage)).toEqual({});
    storage.setItem(arrangeStoreKey("u1", "work", "w1"), "not json{{{");
    // corrupted JSON reads as {}
    expect(getPinnedPositions("u1", "work", "w1", storage)).toEqual({});
    storage.setItem(arrangeStoreKey("u1", "work", "w1"), JSON.stringify([1, 2, 3]));
    // array JSON reads as {}
    expect(getPinnedPositions("u1", "work", "w1", storage)).toEqual({});
    storage.setItem(
      arrangeStoreKey("u1", "work", "w1"),
      JSON.stringify({ good: { x: 1, y: 2 }, bad: { x: "nope", y: 2 }, alsoBad: { x: NaN, y: 0 } }),
    );
    const read = getPinnedPositions("u1", "work", "w1", storage);
    // malformed individual entries are dropped, not the whole map
    expect(Object.keys(read)).toEqual(["good"]);
  });

  // --- pin / unpin / reset ---
  it("pin / unpin / reset", () => {
    const storage = fakeStorage();
    const afterPin1 = pinPosition("u1", "work", "w1", "node-a", { x: 10, y: 20 }, storage);
    expect(afterPin1).toEqual({ "node-a": { x: 10, y: 20 } });

    const afterPin2 = pinPosition("u1", "work", "w1", "node-b", { x: -5, y: 0 }, storage);
    // pinning one node leaves others intact
    expect(afterPin2).toEqual({ "node-a": { x: 10, y: 20 }, "node-b": { x: -5, y: 0 } });

    // Re-pinning updates the same node's position rather than creating a duplicate concept.
    const afterRepin = pinPosition("u1", "work", "w1", "node-a", { x: 99, y: 99 }, storage);
    expect(afterRepin["node-a"]).toEqual({ x: 99, y: 99 });
    expect(Object.keys(afterRepin).length).toBe(2);

    const afterUnpin = unpinPosition("u1", "work", "w1", "node-a", storage);
    // unpin removes only that node
    expect(afterUnpin).toEqual({ "node-b": { x: -5, y: 0 } });

    // Unpinning a node that was never pinned is a no-op, not an error.
    const noop = unpinPosition("u1", "work", "w1", "never-pinned", storage);
    expect(noop).toEqual({ "node-b": { x: -5, y: 0 } });

    resetLayout("u1", "work", "w1", storage);
    // reset clears every entry for this context
    expect(getPinnedPositions("u1", "work", "w1", storage)).toEqual({});
  });

  // --- reset only clears the named context, never others ---
  it("reset only clears the named context, never others", () => {
    const storage = fakeStorage();
    pinPosition("u1", "work", "w1", "a", { x: 1, y: 1 }, storage);
    pinPosition("u1", "work", "w2", "b", { x: 2, y: 2 }, storage);
    pinPosition("u2", "work", "w1", "c", { x: 3, y: 3 }, storage);
    resetLayout("u1", "work", "w1", storage);
    expect(getPinnedPositions("u1", "work", "w1", storage)).toEqual({});
    // sibling context untouched
    expect(getPinnedPositions("u1", "work", "w2", storage)).toEqual({ b: { x: 2, y: 2 } });
    // other user's data untouched
    expect(getPinnedPositions("u2", "work", "w1", storage)).toEqual({ c: { x: 3, y: 3 } });
  });
});
