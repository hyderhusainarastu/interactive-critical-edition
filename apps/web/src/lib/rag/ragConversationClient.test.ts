import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { RagApiError, isRagNotFound, loadOrCreateRagConversation } from "@/lib/rag/ragConversationClient";

/**
 * Owner-blocking production defect regression (2026-07-23). Run via
 * `pnpm --filter web exec tsx <absolute-path>` — same convention as
 * `graphEdgeCategory.test.ts`/`competencyData.test.ts` (no DB import, no
 * DATABASE_URL needed; this module is framework-free by design).
 *
 * The two rejection cases below deliberately keep their original
 * `assert.rejects(fn, validator)` calls: `assert.rejects` has no
 * like-for-like vitest equivalent that also runs a validator callback, so
 * rewriting them would risk changing what is actually asserted.
 */

type FakeMessage = { id: string };

function fakeDeps(overrides: Partial<{
  stored: string | null;
  fetchConversation: (id: string) => Promise<{ conversation: { id: string }; messages: FakeMessage[] }>;
  createConversation: () => Promise<{ conversation: { id: string } }>;
}> = {}) {
  const storage = { value: overrides.stored ?? null };
  const calls = { fetchIds: [] as string[], createCount: 0, cleared: 0, set: [] as string[] };
  const deps = {
    getStoredConversationId: () => storage.value,
    setStoredConversationId: (id: string) => { storage.value = id; calls.set.push(id); },
    clearStoredConversationId: () => { storage.value = null; calls.cleared += 1; },
    fetchConversation: async (id: string) => {
      calls.fetchIds.push(id);
      if (overrides.fetchConversation) return overrides.fetchConversation(id);
      throw new RagApiError("Not found", 404);
    },
    createConversation: async () => {
      calls.createCount += 1;
      if (overrides.createConversation) return overrides.createConversation();
      return { conversation: { id: "fresh-id" } };
    },
  };
  return { deps, storage, calls };
}

describe("loadOrCreateRagConversation", () => {
  it("1. No stored id at all (true first run): creates fresh, never calls fetch", async () => {
    const { deps, storage, calls } = fakeDeps({ stored: null });
    const result = await loadOrCreateRagConversation(deps);
    expect(result.conversationId).toBe("fresh-id");
    expect(result.messages).toEqual([]);
    // "no stored id existed to heal"
    expect(result.healedStalePointer).toBe(false);
    expect(calls.fetchIds.length).toBe(0);
    expect(calls.createCount).toBe(1);
    expect(storage.value).toBe("fresh-id");
  });

  it("2. Stored id resolves fine: returned as-is, create never called", async () => {
    const { deps, calls } = fakeDeps({
      stored: "good-id",
      fetchConversation: async (id) => ({ conversation: { id }, messages: [{ id: "m1" }] }),
    });
    const result = await loadOrCreateRagConversation(deps);
    expect(result.conversationId).toBe("good-id");
    expect(result.messages).toEqual([{ id: "m1" }]);
    expect(result.healedStalePointer).toBe(false);
    expect(calls.createCount).toBe(0);
  });

  // 3. THE BUG: stored id 404s (deleted/foreign/orphaned account) —
  // self-heals by clearing the stale pointer and transparently creating a
  // fresh one, rather than surfacing "Not found" and permanently disabling
  // the panel.
  it("3. THE BUG: a stored id that 404s self-heals into a fresh conversation", async () => {
    const { deps, storage, calls } = fakeDeps({ stored: "stale-id" });
    const result = await loadOrCreateRagConversation(deps);
    expect(result.conversationId).toBe("fresh-id");
    // "a stale pointer WAS discarded and replaced"
    expect(result.healedStalePointer).toBe(true);
    // "the stale id must be cleared from storage"
    expect(calls.cleared).toBe(1);
    expect(calls.createCount).toBe(1);
    // "storage now holds the fresh id, not the stale one"
    expect(storage.value).toBe("fresh-id");
  });

  // 4. A non-404 failure (network error, 401, 500, …) must NOT be treated
  // as "gone" — it propagates untouched, storage is left alone, and no
  // fresh conversation is silently created in place of one the server
  // still has.
  it("4. A non-404 failure propagates untouched — storage is left alone and nothing is created", async () => {
    const { deps, storage, calls } = fakeDeps({
      stored: "server-down",
      fetchConversation: async () => { throw new RagApiError("Internal error", 500); },
    });
    await assert.rejects(() => loadOrCreateRagConversation(deps), (error: unknown) => {
      assert.ok(error instanceof RagApiError);
      assert.equal(error.status, 500);
      return true;
    });
    // "a non-404 failure must not clear the stored id"
    expect(calls.cleared).toBe(0);
    // "a non-404 failure must not fall back to creating a new conversation"
    expect(calls.createCount).toBe(0);
    expect(storage.value).toBe("server-down");
  });

  // 5. Stored id 404s AND the fallback create ALSO fails: the create
  // failure propagates (never silently swallowed into a stuck, error-free
  // blank state) so the caller can render a Retry affordance instead of
  // pretending success.
  it("5. When the stored id 404s and the fallback create also fails, the create failure propagates", async () => {
    const { deps, calls } = fakeDeps({
      stored: "stale-id",
      createConversation: async () => { throw new RagApiError("Could not start a new conversation.", 500); },
    });
    await assert.rejects(() => loadOrCreateRagConversation(deps), (error: unknown) => {
      assert.ok(error instanceof RagApiError);
      assert.equal(error.status, 500);
      return true;
    });
    // "the stale pointer is still discarded even though the retry failed"
    expect(calls.cleared).toBe(1);
  });
});

describe("isRagNotFound", () => {
  // Type guard sanity (used by the send-path self-heal too).
  it("is true only for a RagApiError with status 404", () => {
    expect(isRagNotFound(new RagApiError("gone", 404))).toBe(true);
    expect(isRagNotFound(new RagApiError("nope", 500))).toBe(false);
    expect(isRagNotFound(new Error("plain"))).toBe(false);
    expect(isRagNotFound("not an error")).toBe(false);
  });
});
