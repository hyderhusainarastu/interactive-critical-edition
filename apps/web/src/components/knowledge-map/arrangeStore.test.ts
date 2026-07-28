import assert from "node:assert/strict";
import { arrangeStoreKey, getPinnedPositions, pinPosition, resetLayout, unpinPosition, type StorageLike } from "./arrangeStore";

/** `npx tsx apps/web/src/components/knowledge-map/arrangeStore.test.ts` */

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

// --- key scoping: user + context kind + context id all matter ---
assert.notEqual(arrangeStoreKey("u1", "work", "w1"), arrangeStoreKey("u2", "work", "w1"));
assert.notEqual(arrangeStoreKey("u1", "work", "w1"), arrangeStoreKey("u1", "passage", "w1"));
assert.notEqual(arrangeStoreKey("u1", "work", "w1"), arrangeStoreKey("u1", "work", "w2"));
console.log("arrangeStoreKey scoping: OK");

// --- empty/corrupted/malformed storage all read as {} ---
{
  const storage = fakeStorage();
  assert.deepEqual(getPinnedPositions("u1", "work", "w1", storage), {}, "missing key reads as {}");
  storage.setItem(arrangeStoreKey("u1", "work", "w1"), "not json{{{");
  assert.deepEqual(getPinnedPositions("u1", "work", "w1", storage), {}, "corrupted JSON reads as {}");
  storage.setItem(arrangeStoreKey("u1", "work", "w1"), JSON.stringify([1, 2, 3]));
  assert.deepEqual(getPinnedPositions("u1", "work", "w1", storage), {}, "array JSON reads as {}");
  storage.setItem(
    arrangeStoreKey("u1", "work", "w1"),
    JSON.stringify({ good: { x: 1, y: 2 }, bad: { x: "nope", y: 2 }, alsoBad: { x: NaN, y: 0 } }),
  );
  const read = getPinnedPositions("u1", "work", "w1", storage);
  assert.deepEqual(Object.keys(read), ["good"], "malformed individual entries are dropped, not the whole map");
}
console.log("getPinnedPositions tolerance: OK");

// --- pin / unpin / reset ---
{
  const storage = fakeStorage();
  const afterPin1 = pinPosition("u1", "work", "w1", "node-a", { x: 10, y: 20 }, storage);
  assert.deepEqual(afterPin1, { "node-a": { x: 10, y: 20 } });

  const afterPin2 = pinPosition("u1", "work", "w1", "node-b", { x: -5, y: 0 }, storage);
  assert.deepEqual(afterPin2, { "node-a": { x: 10, y: 20 }, "node-b": { x: -5, y: 0 } }, "pinning one node leaves others intact");

  // Re-pinning updates the same node's position rather than creating a duplicate concept.
  const afterRepin = pinPosition("u1", "work", "w1", "node-a", { x: 99, y: 99 }, storage);
  assert.deepEqual(afterRepin["node-a"], { x: 99, y: 99 });
  assert.equal(Object.keys(afterRepin).length, 2);

  const afterUnpin = unpinPosition("u1", "work", "w1", "node-a", storage);
  assert.deepEqual(afterUnpin, { "node-b": { x: -5, y: 0 } }, "unpin removes only that node");

  // Unpinning a node that was never pinned is a no-op, not an error.
  const noop = unpinPosition("u1", "work", "w1", "never-pinned", storage);
  assert.deepEqual(noop, { "node-b": { x: -5, y: 0 } });

  resetLayout("u1", "work", "w1", storage);
  assert.deepEqual(getPinnedPositions("u1", "work", "w1", storage), {}, "reset clears every entry for this context");
}
console.log("pin/unpin/reset: OK");

// --- reset only clears the named context, never others ---
{
  const storage = fakeStorage();
  pinPosition("u1", "work", "w1", "a", { x: 1, y: 1 }, storage);
  pinPosition("u1", "work", "w2", "b", { x: 2, y: 2 }, storage);
  pinPosition("u2", "work", "w1", "c", { x: 3, y: 3 }, storage);
  resetLayout("u1", "work", "w1", storage);
  assert.deepEqual(getPinnedPositions("u1", "work", "w1", storage), {});
  assert.deepEqual(getPinnedPositions("u1", "work", "w2", storage), { b: { x: 2, y: 2 } }, "sibling context untouched");
  assert.deepEqual(getPinnedPositions("u2", "work", "w1", storage), { c: { x: 3, y: 3 } }, "other user's data untouched");
}
console.log("reset isolation: OK");

console.log("arrangeStore.test.ts: all assertions passed");
