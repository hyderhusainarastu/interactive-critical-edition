import assert from "node:assert/strict";
import {
  clearRecentContexts,
  MAX_RECENT_CONTEXTS,
  readRecentContexts,
  recentContextsStorageKey,
  recordRecentContext,
  type StorageLike,
} from "./recentContexts";

/** `npx tsx apps/web/src/components/knowledge-map/recentContexts.test.ts` */

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

// --- storage key is namespaced per user ---
assert.notEqual(recentContextsStorageKey("u1"), recentContextsStorageKey("u2"));
console.log("recentContextsStorageKey: OK");

// --- empty/missing/corrupted storage all read as [] ---
{
  const storage = fakeStorage();
  assert.deepEqual(readRecentContexts("u1", storage), [], "missing key reads as empty");
  storage.setItem(recentContextsStorageKey("u1"), "not json{{{");
  assert.deepEqual(readRecentContexts("u1", storage), [], "corrupted JSON reads as empty, never throws");
  storage.setItem(recentContextsStorageKey("u1"), JSON.stringify({ not: "an array" }));
  assert.deepEqual(readRecentContexts("u1", storage), [], "non-array JSON reads as empty");
  storage.setItem(recentContextsStorageKey("u1"), JSON.stringify([{ kind: "work" /* missing fields */ }]));
  assert.deepEqual(readRecentContexts("u1", storage), [], "malformed entries are filtered out, not half-trusted");
}
console.log("readRecentContexts tolerance: OK");

// --- recordRecentContext: insert, move-to-front, dedupe, cap, per-user isolation ---
{
  const storage = fakeStorage();
  let ticks = 0;
  const now = () => `2026-01-01T00:00:0${ticks++}.000Z`;

  const afterFirst = recordRecentContext("u1", { kind: "work", id: "w1", label: "On the Soul", subtitle: "Aristotle" }, storage, now);
  assert.equal(afterFirst.length, 1);
  assert.equal(afterFirst[0].id, "w1");
  assert.equal(afterFirst[0].visitedAt, "2026-01-01T00:00:00.000Z");

  recordRecentContext("u1", { kind: "work", id: "w2", label: "Physics", subtitle: "Aristotle" }, storage, now);
  const afterThird = recordRecentContext("u1", { kind: "claim", id: "c1", label: "A claim", subtitle: "On the Soul" }, storage, now);
  assert.deepEqual(afterThird.map((e) => e.id), ["c1", "w2", "w1"], "most-recent-first");

  // Revisiting w1 moves it to the front instead of duplicating it.
  const afterRevisit = recordRecentContext("u1", { kind: "work", id: "w1", label: "On the Soul (retitled)", subtitle: "Aristotle" }, storage, now);
  assert.deepEqual(afterRevisit.map((e) => e.id), ["w1", "c1", "w2"], "revisit moves the SAME entry to the front, not a duplicate");
  assert.equal(afterRevisit.length, 3, "still exactly 3 entries, no duplicate");
  assert.equal(afterRevisit[0].label, "On the Soul (retitled)", "label refreshed on revisit");

  // Cap at MAX_RECENT_CONTEXTS.
  for (let i = 0; i < MAX_RECENT_CONTEXTS + 5; i++) {
    recordRecentContext("u1", { kind: "work", id: `bulk-${i}`, label: `Bulk ${i}`, subtitle: "" }, storage, now);
  }
  const capped = readRecentContexts("u1", storage);
  assert.equal(capped.length, MAX_RECENT_CONTEXTS, "list never exceeds the cap");

  // A different user has their own independent list.
  recordRecentContext("u2", { kind: "debate", id: "d1", label: "A debate", subtitle: "" }, storage, now);
  assert.deepEqual(readRecentContexts("u2", storage).map((e) => e.id), ["d1"]);
  assert.equal(readRecentContexts("u1", storage).length, MAX_RECENT_CONTEXTS, "u1's list is unaffected by u2's write");
}
console.log("recordRecentContext: OK");

// --- clearRecentContexts ---
{
  const storage = fakeStorage();
  recordRecentContext("u1", { kind: "work", id: "w1", label: "x", subtitle: "" }, storage);
  assert.equal(readRecentContexts("u1", storage).length, 1);
  clearRecentContexts("u1", storage);
  assert.deepEqual(readRecentContexts("u1", storage), []);
}
console.log("clearRecentContexts: OK");

console.log("recentContexts.test.ts: all assertions passed");
