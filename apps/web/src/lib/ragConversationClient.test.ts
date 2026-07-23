import assert from "node:assert/strict";
import { RagApiError, isRagNotFound, loadOrCreateRagConversation } from "./ragConversationClient";

/**
 * Owner-blocking production defect regression (2026-07-23). Run via
 * `pnpm --filter web exec tsx <absolute-path>` — same convention as
 * `graphEdgeCategory.test.ts`/`competencyData.test.ts` (no DB import, no
 * DATABASE_URL needed; this module is framework-free by design).
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

async function testFirstRunCreatesFresh() {
  // 1. No stored id at all (true first run): creates fresh, never calls fetch.
  const { deps, storage, calls } = fakeDeps({ stored: null });
  const result = await loadOrCreateRagConversation(deps);
  assert.equal(result.conversationId, "fresh-id");
  assert.deepEqual(result.messages, []);
  assert.equal(result.healedStalePointer, false, "no stored id existed to heal");
  assert.equal(calls.fetchIds.length, 0);
  assert.equal(calls.createCount, 1);
  assert.equal(storage.value, "fresh-id");
}

async function testStoredIdResolvesFine() {
  // 2. Stored id resolves fine: returned as-is, create never called.
  const { deps, calls } = fakeDeps({
    stored: "good-id",
    fetchConversation: async (id) => ({ conversation: { id }, messages: [{ id: "m1" }] }),
  });
  const result = await loadOrCreateRagConversation(deps);
  assert.equal(result.conversationId, "good-id");
  assert.deepEqual(result.messages, [{ id: "m1" }]);
  assert.equal(result.healedStalePointer, false);
  assert.equal(calls.createCount, 0);
}

async function testStaleStoredIdSelfHeals() {
  // 3. THE BUG: stored id 404s (deleted/foreign/orphaned account) —
  // self-heals by clearing the stale pointer and transparently creating a
  // fresh one, rather than surfacing "Not found" and permanently disabling
  // the panel.
  const { deps, storage, calls } = fakeDeps({ stored: "stale-id" });
  const result = await loadOrCreateRagConversation(deps);
  assert.equal(result.conversationId, "fresh-id");
  assert.equal(result.healedStalePointer, true, "a stale pointer WAS discarded and replaced");
  assert.equal(calls.cleared, 1, "the stale id must be cleared from storage");
  assert.equal(calls.createCount, 1);
  assert.equal(storage.value, "fresh-id", "storage now holds the fresh id, not the stale one");
}

async function testNonNotFoundFailurePropagates() {
  // 4. A non-404 failure (network error, 401, 500, …) must NOT be treated
  // as "gone" — it propagates untouched, storage is left alone, and no
  // fresh conversation is silently created in place of one the server
  // still has.
  const { deps, storage, calls } = fakeDeps({
    stored: "server-down",
    fetchConversation: async () => { throw new RagApiError("Internal error", 500); },
  });
  await assert.rejects(() => loadOrCreateRagConversation(deps), (error: unknown) => {
    assert.ok(error instanceof RagApiError);
    assert.equal(error.status, 500);
    return true;
  });
  assert.equal(calls.cleared, 0, "a non-404 failure must not clear the stored id");
  assert.equal(calls.createCount, 0, "a non-404 failure must not fall back to creating a new conversation");
  assert.equal(storage.value, "server-down");
}

async function testFallbackCreateFailurePropagates() {
  // 5. Stored id 404s AND the fallback create ALSO fails: the create
  // failure propagates (never silently swallowed into a stuck, error-free
  // blank state) so the caller can render a Retry affordance instead of
  // pretending success.
  const { deps, calls } = fakeDeps({
    stored: "stale-id",
    createConversation: async () => { throw new RagApiError("Could not start a new conversation.", 500); },
  });
  await assert.rejects(() => loadOrCreateRagConversation(deps), (error: unknown) => {
    assert.ok(error instanceof RagApiError);
    assert.equal(error.status, 500);
    return true;
  });
  assert.equal(calls.cleared, 1, "the stale pointer is still discarded even though the retry failed");
}

function testIsRagNotFound() {
  // Type guard sanity (used by the send-path self-heal too).
  assert.equal(isRagNotFound(new RagApiError("gone", 404)), true);
  assert.equal(isRagNotFound(new RagApiError("nope", 500)), false);
  assert.equal(isRagNotFound(new Error("plain")), false);
  assert.equal(isRagNotFound("not an error"), false);
}

async function main() {
  await testFirstRunCreatesFresh();
  await testStoredIdResolvesFine();
  await testStaleStoredIdSelfHeals();
  await testNonNotFoundFailurePropagates();
  await testFallbackCreateFailurePropagates();
  testIsRagNotFound();
  console.log("ragConversationClient.test.ts: all assertions passed");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
