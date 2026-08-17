import { describe, expect, it } from "vitest";
import {
  clearRecentContexts,
  MAX_RECENT_CONTEXTS,
  readRecentContexts,
  recentContextsStorageKey,
  recordRecentContext,
  type StorageLike,
} from "./recentContexts";

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

describe("recentContextsStorageKey", () => {
  // --- storage key is namespaced per user ---
  it("namespaces the storage key per user", () => {
    expect(recentContextsStorageKey("u1")).not.toBe(recentContextsStorageKey("u2"));
  });
});

describe("readRecentContexts", () => {
  // --- empty/missing/corrupted storage all read as [] ---
  it("reads empty/missing/corrupted storage all as [], never throwing", () => {
    const storage = fakeStorage();
    // missing key reads as empty
    expect(readRecentContexts("u1", storage)).toEqual([]);
    storage.setItem(recentContextsStorageKey("u1"), "not json{{{");
    // corrupted JSON reads as empty, never throws
    expect(readRecentContexts("u1", storage)).toEqual([]);
    storage.setItem(recentContextsStorageKey("u1"), JSON.stringify({ not: "an array" }));
    // non-array JSON reads as empty
    expect(readRecentContexts("u1", storage)).toEqual([]);
    storage.setItem(recentContextsStorageKey("u1"), JSON.stringify([{ kind: "work" /* missing fields */ }]));
    // malformed entries are filtered out, not half-trusted
    expect(readRecentContexts("u1", storage)).toEqual([]);
  });
});

describe("recordRecentContext", () => {
  // --- recordRecentContext: insert, move-to-front, dedupe, cap, per-user isolation ---
  it("inserts, moves-to-front on revisit, dedupes, caps at MAX_RECENT_CONTEXTS, and isolates per user", () => {
    const storage = fakeStorage();
    let ticks = 0;
    const now = () => `2026-01-01T00:00:0${ticks++}.000Z`;

    const afterFirst = recordRecentContext("u1", { kind: "work", id: "w1", label: "On the Soul", subtitle: "Aristotle" }, storage, now);
    expect(afterFirst.length).toBe(1);
    expect(afterFirst[0].id).toBe("w1");
    expect(afterFirst[0].visitedAt).toBe("2026-01-01T00:00:00.000Z");

    recordRecentContext("u1", { kind: "work", id: "w2", label: "Physics", subtitle: "Aristotle" }, storage, now);
    const afterThird = recordRecentContext("u1", { kind: "claim", id: "c1", label: "A claim", subtitle: "On the Soul" }, storage, now);
    // most-recent-first
    expect(afterThird.map((e) => e.id)).toEqual(["c1", "w2", "w1"]);

    // Revisiting w1 moves it to the front instead of duplicating it.
    const afterRevisit = recordRecentContext("u1", { kind: "work", id: "w1", label: "On the Soul (retitled)", subtitle: "Aristotle" }, storage, now);
    // revisit moves the SAME entry to the front, not a duplicate
    expect(afterRevisit.map((e) => e.id)).toEqual(["w1", "c1", "w2"]);
    // still exactly 3 entries, no duplicate
    expect(afterRevisit.length).toBe(3);
    // label refreshed on revisit
    expect(afterRevisit[0].label).toBe("On the Soul (retitled)");

    // Cap at MAX_RECENT_CONTEXTS.
    for (let i = 0; i < MAX_RECENT_CONTEXTS + 5; i++) {
      recordRecentContext("u1", { kind: "work", id: `bulk-${i}`, label: `Bulk ${i}`, subtitle: "" }, storage, now);
    }
    const capped = readRecentContexts("u1", storage);
    // list never exceeds the cap
    expect(capped.length).toBe(MAX_RECENT_CONTEXTS);

    // A different user has their own independent list.
    recordRecentContext("u2", { kind: "debate", id: "d1", label: "A debate", subtitle: "" }, storage, now);
    expect(readRecentContexts("u2", storage).map((e) => e.id)).toEqual(["d1"]);
    // u1's list is unaffected by u2's write
    expect(readRecentContexts("u1", storage).length).toBe(MAX_RECENT_CONTEXTS);
  });
});

describe("clearRecentContexts", () => {
  it("clears a user's recorded contexts back to an empty list", () => {
    const storage = fakeStorage();
    recordRecentContext("u1", { kind: "work", id: "w1", label: "x", subtitle: "" }, storage);
    expect(readRecentContexts("u1", storage).length).toBe(1);
    clearRecentContexts("u1", storage);
    expect(readRecentContexts("u1", storage)).toEqual([]);
  });
});
