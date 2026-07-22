import { describe, expect, it } from "vitest";
import {
  STAGE_LOG_LIMIT,
  executeWorkDeletion,
  type DeletionCleanupState,
  type WorkDeletionEffects,
} from "./index";

const INPUT = { userId: "user-1", workId: "work-1", workTitle: "Vice and Reason" };

type FakeOptions = {
  documents?: Array<{ id: string; storagePath: string }>;
  existing?: DeletionCleanupState | null;
  failStoragePaths?: Set<string>;
  failCancelJobs?: boolean;
  failDbDelete?: boolean;
};

/**
 * In-memory effects double that records call order and persists cleanup
 * state exactly the way the DB-backed implementation would (last save wins).
 */
function makeFakes(options: FakeOptions = {}) {
  const calls: string[] = [];
  let saved: DeletionCleanupState | null = options.existing ?? null;
  const effects: WorkDeletionEffects = {
    async listDocuments() {
      calls.push("listDocuments");
      return options.documents ?? [];
    },
    async getCleanup() {
      calls.push("getCleanup");
      return saved ? structuredClone(saved) : null;
    },
    async saveCleanup(state) {
      calls.push(`saveCleanup:${state.status}`);
      saved = structuredClone(state);
    },
    async cancelQueuedJobs(documentIds) {
      calls.push(`cancelQueuedJobs:${documentIds.join(",")}`);
      if (options.failCancelJobs) throw new Error("pgboss unavailable");
    },
    async deleteStorageObject(path) {
      calls.push(`deleteStorageObject:${path}`);
      if (options.failStoragePaths?.has(path)) throw new Error(`storage 503 for ${path}`);
    },
    async deleteWorkDatabaseRows(workId) {
      calls.push(`deleteWorkDatabaseRows:${workId}`);
      if (options.failDbDelete) throw new Error("db connection reset");
    },
  };
  return { effects, calls, latest: () => saved };
}

describe("executeWorkDeletion (Phase 20.3 state machine)", () => {
  it("deletes storage before DB rows, marks completed, and logs each stage", async () => {
    const { effects, calls, latest } = makeFakes({
      documents: [
        { id: "doc-1", storagePath: "u/w/one.pdf" },
        { id: "doc-2", storagePath: "u/w/two.txt" },
      ],
    });

    const result = await executeWorkDeletion(effects, INPUT);

    expect(result).toEqual({ outcome: "completed", alreadyCompleted: false });
    // The cleanup record is durable BEFORE any destructive step.
    expect(calls.indexOf("saveCleanup:in_progress")).toBeLessThan(calls.indexOf("cancelQueuedJobs:doc-1,doc-2"));
    // Jobs are cancelled before storage, storage before the DB delete.
    expect(calls.indexOf("cancelQueuedJobs:doc-1,doc-2")).toBeLessThan(calls.indexOf("deleteStorageObject:u/w/one.pdf"));
    expect(calls.indexOf("deleteStorageObject:u/w/two.txt")).toBeLessThan(calls.indexOf("deleteWorkDatabaseRows:work-1"));

    const state = latest();
    expect(state?.status).toBe("completed");
    expect(state?.pendingStoragePaths).toEqual([]);
    expect(state?.lastError).toBeNull();
    expect(state?.stageLog.map((entry) => entry.stage)).toEqual([
      "collect",
      "cancel-jobs",
      "storage-delete",
      "storage-delete",
      "db-delete",
      "complete",
    ]);
    expect(state?.stageLog.every((entry) => entry.ok)).toBe(true);
  });

  it("is idempotent: a repeat request after completion short-circuits without touching anything", async () => {
    const { effects, calls } = makeFakes({
      existing: {
        userId: "user-1",
        workId: "work-1",
        workTitle: "Vice and Reason",
        status: "completed",
        pendingStoragePaths: [],
        attempts: 1,
        lastError: null,
        stageLog: [],
      },
    });

    const result = await executeWorkDeletion(effects, INPUT);

    expect(result).toEqual({ outcome: "completed", alreadyCompleted: true });
    expect(calls).toEqual(["getCleanup"]);
  });

  it("does not report success or delete DB rows when a Storage deletion fails; persists a retryable state", async () => {
    const { effects, calls, latest } = makeFakes({
      documents: [
        { id: "doc-1", storagePath: "u/w/gone-fine.pdf" },
        { id: "doc-2", storagePath: "u/w/stuck.pdf" },
      ],
      failStoragePaths: new Set(["u/w/stuck.pdf"]),
    });

    const result = await executeWorkDeletion(effects, INPUT);

    expect(result.outcome).toBe("storage_failed");
    if (result.outcome === "storage_failed") {
      expect(result.pendingStoragePaths).toEqual(["u/w/stuck.pdf"]);
      expect(result.error).toContain("storage 503");
    }
    // The DB delete must never run while private bytes remain.
    expect(calls.some((c) => c.startsWith("deleteWorkDatabaseRows"))).toBe(false);

    const state = latest();
    expect(state?.status).toBe("storage_failed");
    expect(state?.pendingStoragePaths).toEqual(["u/w/stuck.pdf"]);
    expect(state?.attempts).toBe(1);
    expect(state?.lastError).toContain("storage-delete");
    expect(state?.stageLog.some((entry) => entry.stage === "storage-delete" && !entry.ok)).toBe(true);
  });

  it("recovers from a partial cleanup: a retry resumes from the persisted state and completes", async () => {
    // First run: storage fails.
    const first = makeFakes({
      documents: [{ id: "doc-1", storagePath: "u/w/stuck.pdf" }],
      failStoragePaths: new Set(["u/w/stuck.pdf"]),
    });
    await executeWorkDeletion(first.effects, INPUT);
    const persisted = first.latest();
    expect(persisted?.status).toBe("storage_failed");

    // Second run: storage is healthy again; state resumed from run 1.
    const second = makeFakes({
      documents: [{ id: "doc-1", storagePath: "u/w/stuck.pdf" }],
      existing: persisted,
    });
    const result = await executeWorkDeletion(second.effects, INPUT);

    expect(result).toEqual({ outcome: "completed", alreadyCompleted: false });
    const state = second.latest();
    expect(state?.status).toBe("completed");
    expect(state?.pendingStoragePaths).toEqual([]);
    expect(state?.lastError).toBeNull();
    expect(state?.attempts).toBe(1); // carried over, not re-incremented on success
  });

  it("converges after a crash between the DB delete and the completed save", async () => {
    // Simulates: run 1 deleted all storage + the work row, then crashed
    // before saving `completed`. The work row is gone, pending is empty.
    const { effects, latest } = makeFakes({
      documents: [], // work row already cascaded away
      existing: {
        userId: "user-1",
        workId: "work-1",
        workTitle: "Vice and Reason",
        status: "in_progress",
        pendingStoragePaths: [],
        attempts: 0,
        lastError: null,
        stageLog: [],
      },
    });

    const result = await executeWorkDeletion(effects, INPUT);

    expect(result).toEqual({ outcome: "completed", alreadyCompleted: false });
    expect(latest()?.status).toBe("completed");
  });

  it("halts before touching Storage when job cancellation fails, and persists the failure", async () => {
    const { effects, calls, latest } = makeFakes({
      documents: [{ id: "doc-1", storagePath: "u/w/one.pdf" }],
      failCancelJobs: true,
    });

    const result = await executeWorkDeletion(effects, INPUT);

    expect(result).toEqual({ outcome: "failed", stage: "cancel-jobs", error: "pgboss unavailable" });
    expect(calls.some((c) => c.startsWith("deleteStorageObject"))).toBe(false);
    expect(calls.some((c) => c.startsWith("deleteWorkDatabaseRows"))).toBe(false);
    const state = latest();
    expect(state?.status).toBe("in_progress");
    expect(state?.attempts).toBe(1);
    expect(state?.lastError).toContain("cancel-jobs");
  });

  it("keeps the record retryable when the DB delete itself fails after storage cleared", async () => {
    const { effects, latest } = makeFakes({
      documents: [{ id: "doc-1", storagePath: "u/w/one.pdf" }],
      failDbDelete: true,
    });

    const result = await executeWorkDeletion(effects, INPUT);

    expect(result).toEqual({ outcome: "failed", stage: "db-delete", error: "db connection reset" });
    const state = latest();
    expect(state?.status).toBe("in_progress");
    expect(state?.pendingStoragePaths).toEqual([]);
    expect(state?.attempts).toBe(1);
    expect(state?.lastError).toContain("db-delete");
  });

  it("accumulates attempts across repeated storage failures and bounds the stage log", async () => {
    let persisted: DeletionCleanupState | null = null;
    for (let run = 0; run < 30; run += 1) {
      const fakes = makeFakes({
        documents: [{ id: "doc-1", storagePath: "u/w/stuck.pdf" }],
        existing: persisted,
        failStoragePaths: new Set(["u/w/stuck.pdf"]),
      });
      const result = await executeWorkDeletion(fakes.effects, INPUT);
      expect(result.outcome).toBe("storage_failed");
      persisted = fakes.latest();
    }
    expect(persisted?.attempts).toBe(30);
    expect(persisted?.stageLog.length).toBeLessThanOrEqual(STAGE_LOG_LIMIT);
  });
});
