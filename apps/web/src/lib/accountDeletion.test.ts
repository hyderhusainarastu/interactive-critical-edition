import assert from "node:assert/strict";
import {
  ACCOUNT_DELETION_STORAGE_ABORT_MESSAGE,
  runAccountDeletion,
  type AccountDeletionEffects,
  type AccountDeletionUser,
} from "./accountDeletion";

/**
 * Pure orchestration tests with in-memory fakes — same convention as
 * `packages/deletion/src/index.test.ts`'s `executeWorkDeletion` tests. This
 * module transitively imports `@ice/db` (for the real DB-backed effects
 * builder further down the file), so — matching the existing
 * `roadmapGraph.test.ts`/`competencyData.test.ts` precedent — it needs
 * DATABASE_URL set at invocation even though these tests never issue a real
 * query:
 *
 *   cd apps/web && DATABASE_URL=postgres://ice:ice_dev_only@localhost:5432/interactive_critical_edition \
 *     ../worker/node_modules/.bin/tsx src/lib/accountDeletion.test.ts
 */

const USER: AccountDeletionUser = {
  id: "user-1",
  email: "reader@example.test",
  name: "Reader Name",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  readerLevel: "undergraduate",
  dataSharingEnabled: true,
};

type FakeOptions = {
  user?: AccountDeletionUser | null;
  works?: Array<{ id: string; title: string }>;
  workOutcomes?: Record<string, "completed" | "storage_failed" | "failed">;
};

function makeFakes(options: FakeOptions = {}) {
  const calls: string[] = [];
  let archived: unknown = null;
  let userDeleted = false;
  let sweptCandidates: unknown = null;

  const effects: AccountDeletionEffects = {
    async getUser() {
      calls.push("getUser");
      return options.user === undefined ? USER : options.user;
    },
    async computeAggregates() {
      calls.push("computeAggregates");
      return { docsProcessed: 3, totalAiCostUsd: 0.12, chatMessages: 5, lastActiveAt: new Date("2026-01-05T00:00:00.000Z") };
    },
    async upsertArchive(input) {
      calls.push("upsertArchive");
      archived = input;
    },
    async retryPendingCleanups() {
      calls.push("retryPendingCleanups");
    },
    async listWorks() {
      calls.push("listWorks");
      return options.works ?? [];
    },
    async deleteWork(_userId, workId) {
      calls.push(`deleteWork:${workId}`);
      const outcome = options.workOutcomes?.[workId] ?? "completed";
      if (outcome === "completed") return { outcome: "completed", alreadyCompleted: false };
      if (outcome === "storage_failed") return { outcome: "storage_failed", pendingStoragePaths: [`${workId}/stuck.pdf`], error: "storage 503" };
      return { outcome: "failed", stage: "db-delete", error: "db connection reset" };
    },
    async collectOrphanCandidates() {
      calls.push("collectOrphanCandidates");
      return { workIdentityIds: ["identity-1"], learningResourceIds: ["resource-1"] };
    },
    async sweepOrphans(candidates) {
      calls.push("sweepOrphans");
      sweptCandidates = candidates;
      return { workIdentitiesDeleted: 1, learningResourcesDeleted: 1 };
    },
    async deleteUserRow() {
      calls.push("deleteUserRow");
      userDeleted = true;
    },
  };

  return { effects, calls, archived: () => archived, userDeleted: () => userDeleted, sweptCandidates: () => sweptCandidates };
}

function test(name: string, fn: () => Promise<void> | void) {
  return (async () => {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (error) {
      console.error(`not ok - ${name}`);
      throw error;
    }
  })();
}

async function main() {
  await test("returns not_found and does nothing else when the user is already gone", async () => {
    const { effects, calls } = makeFakes({ user: null });
    const result = await runAccountDeletion(effects, { userId: "gone" });
    assert.deepEqual(result, { outcome: "not_found" });
    assert.deepEqual(calls, ["getUser"]);
  });

  await test("archives BEFORE any destructive step (upsertArchive precedes every deleteWork call)", async () => {
    const { effects, calls, archived } = makeFakes({
      works: [
        { id: "work-1", title: "Vice and Reason" },
        { id: "work-2", title: "On the Soul" },
      ],
    });
    const result = await runAccountDeletion(effects, { userId: USER.id });
    assert.deepEqual(result, { outcome: "completed" });
    const archiveIndex = calls.indexOf("upsertArchive");
    const firstDeleteIndex = calls.findIndex((c) => c.startsWith("deleteWork:"));
    assert.ok(archiveIndex >= 0 && firstDeleteIndex >= 0);
    assert.ok(archiveIndex < firstDeleteIndex, "archive must be written before any work is deleted");
    assert.ok(calls.indexOf("deleteUserRow") > firstDeleteIndex, "user row deletion must follow the work deletions");

    const record = archived() as { docsProcessed: number; totalAiCostUsd: number; email: string };
    assert.equal(record.docsProcessed, 3);
    assert.equal(record.totalAiCostUsd, 0.12);
    assert.equal(record.email, USER.email);
  });

  await test("collects orphan candidates BEFORE the deletion loop, and sweeps them AFTER it completes, before deleteUserRow", async () => {
    const { effects, calls } = makeFakes({ works: [{ id: "work-1", title: "Vice and Reason" }] });
    await runAccountDeletion(effects, { userId: USER.id });
    const collectIndex = calls.indexOf("collectOrphanCandidates");
    const deleteWorkIndex = calls.indexOf("deleteWork:work-1");
    const sweepIndex = calls.indexOf("sweepOrphans");
    const deleteUserIndex = calls.indexOf("deleteUserRow");
    assert.ok(collectIndex < deleteWorkIndex, "candidates must be collected before any work is deleted");
    assert.ok(deleteWorkIndex < sweepIndex, "sweep must happen after the deletion loop");
    assert.ok(sweepIndex < deleteUserIndex, "sweep must happen before the user row is deleted");
  });

  await test("gate: aborts with the exact storage-abort message when ANY work deletion does not complete, and never deletes the user row", async () => {
    const { effects, calls, userDeleted } = makeFakes({
      works: [
        { id: "work-1", title: "Fine" },
        { id: "work-2", title: "Stuck" },
      ],
      workOutcomes: { "work-1": "completed", "work-2": "storage_failed" },
    });
    const result = await runAccountDeletion(effects, { userId: USER.id });
    assert.deepEqual(result, { outcome: "storage_abort", message: ACCOUNT_DELETION_STORAGE_ABORT_MESSAGE });
    assert.equal(userDeleted(), false, "the user row must never be deleted while any work deletion is incomplete");
    assert.ok(!calls.includes("sweepOrphans"), "the orphan sweep must not run when the flow aborts");
    // Both works are still attempted (not short-circuited on the first
    // failure) — deletion is idempotent and safely retryable, so trying
    // every work leaves fewer to retry next time.
    assert.ok(calls.includes("deleteWork:work-1"));
    assert.ok(calls.includes("deleteWork:work-2"));
  });

  await test("gate: a plain 'failed' outcome (not just storage_failed) also aborts before the user row is deleted", async () => {
    const { effects, userDeleted } = makeFakes({
      works: [{ id: "work-1", title: "Broken" }],
      workOutcomes: { "work-1": "failed" },
    });
    const result = await runAccountDeletion(effects, { userId: USER.id });
    assert.equal(result.outcome, "storage_abort");
    assert.equal(userDeleted(), false);
  });

  await test("retries pending cleanups from an earlier aborted attempt before the deletion loop runs", async () => {
    const { effects, calls } = makeFakes({ works: [] });
    await runAccountDeletion(effects, { userId: USER.id });
    assert.ok(calls.indexOf("retryPendingCleanups") < calls.indexOf("collectOrphanCandidates"));
  });

  await test("a user with no works still archives, sweeps (a no-op), and deletes the user row", async () => {
    const { effects, calls, userDeleted } = makeFakes({ works: [] });
    const result = await runAccountDeletion(effects, { userId: USER.id });
    assert.deepEqual(result, { outcome: "completed" });
    assert.equal(userDeleted(), true);
    assert.ok(calls.includes("sweepOrphans"));
  });

  console.log("accountDeletion.test.ts: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
