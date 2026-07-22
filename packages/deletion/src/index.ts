/**
 * Pure permanent-deletion state machine (Phase 20.3). No DB, no I/O — every
 * side effect is injected, so the ordering/failure/idempotency invariants are
 * deterministic Vitest units (same split as `@ice/roadmap`'s pure ranking vs.
 * `apps/web/src/lib/roadmap.ts`'s DB traversal; the real effects live in
 * `apps/web/src/lib/trash.ts`).
 *
 * States (persisted as a `deletion_cleanup` row keyed by workId):
 *   in_progress    — deletion started; cleanup record is durable before any
 *                    destructive step runs.
 *   storage_failed — one or more private Storage objects could not be
 *                    removed; retryable, admin-visible, never reported as
 *                    success.
 *   completed      — every private byte and every DB row is gone.
 *
 * Ordering is deliberately conservative — Storage first, DB last:
 *   1. persist the cleanup record (paths survive any crash),
 *   2. cancel queued pg-boss jobs (so no worker re-touches the documents),
 *   3. delete every private Storage object,
 *   4. only then hard-delete the work row (Postgres cascades the rest).
 * This means "DB rows gone but bytes left behind with no record of it" —
 * the failure mode the plan's §20.3 honesty requirement targets — cannot
 * occur silently: bytes are only ever removed *before* the rows that track
 * them, and any storage failure halts the run in a persisted, retryable
 * `storage_failed` state instead of reporting success. A crash between the
 * DB delete and the final `completed` save converges on retry: the machine
 * re-runs with an empty pending set, the work-row delete is a no-op, and the
 * record is marked completed.
 */

export type DeletionCleanupStatus = "in_progress" | "storage_failed" | "completed";

export type DeletionStage = "collect" | "cancel-jobs" | "storage-delete" | "db-delete" | "complete";

export interface DeletionStageLogEntry {
  stage: DeletionStage;
  at: string;
  ok: boolean;
  detail?: string;
}

/** Keep the persisted per-row log bounded across many retries. */
export const STAGE_LOG_LIMIT = 40;

export interface DeletionCleanupState {
  userId: string;
  workId: string;
  /** Retained so the admin queue can still name the work after its row is gone. */
  workTitle: string;
  status: DeletionCleanupStatus;
  pendingStoragePaths: string[];
  attempts: number;
  lastError: string | null;
  stageLog: DeletionStageLogEntry[];
}

export interface WorkDeletionEffects {
  /** Documents still present in the DB for this work — empty once the work row is gone. */
  listDocuments(workId: string): Promise<Array<{ id: string; storagePath: string }>>;
  getCleanup(workId: string): Promise<DeletionCleanupState | null>;
  /** Upsert by workId. Must be durable before the machine takes any destructive step. */
  saveCleanup(state: DeletionCleanupState): Promise<void>;
  cancelQueuedJobs(documentIds: string[]): Promise<void>;
  /** Throws on failure. Removing an already-missing object must resolve (idempotent). */
  deleteStorageObject(path: string): Promise<void>;
  /**
   * Hard-deletes the work row (cascading document/edition/reader/analysis/RAG
   * rows) plus anything Postgres cannot cascade for it (polymorphic
   * `graph_edge` rows). Must be a no-op when the row is already gone.
   */
  deleteWorkDatabaseRows(workId: string): Promise<void>;
  now?(): Date;
}

export type WorkDeletionOutcome =
  | { outcome: "completed"; alreadyCompleted: boolean }
  | { outcome: "storage_failed"; pendingStoragePaths: string[]; error: string }
  | { outcome: "failed"; stage: "cancel-jobs" | "db-delete"; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushLog(state: DeletionCleanupState, now: () => Date, stage: DeletionStage, ok: boolean, detail?: string): void {
  state.stageLog.push({ stage, at: now().toISOString(), ok, ...(detail ? { detail } : {}) });
  if (state.stageLog.length > STAGE_LOG_LIMIT) {
    state.stageLog = state.stageLog.slice(state.stageLog.length - STAGE_LOG_LIMIT);
  }
}

/**
 * Runs (or resumes) the permanent deletion of one work. Idempotent: a repeat
 * call after completion short-circuits, and a retry after any partial failure
 * resumes from the persisted cleanup record rather than starting over.
 */
export async function executeWorkDeletion(
  effects: WorkDeletionEffects,
  input: { userId: string; workId: string; workTitle: string },
): Promise<WorkDeletionOutcome> {
  const now = effects.now ?? (() => new Date());

  const existing = await effects.getCleanup(input.workId);
  if (existing?.status === "completed") {
    return { outcome: "completed", alreadyCompleted: true };
  }

  const docs = await effects.listDocuments(input.workId);
  const pending = [...new Set([...(existing?.pendingStoragePaths ?? []), ...docs.map((d) => d.storagePath)])];
  const state: DeletionCleanupState = {
    userId: input.userId,
    workId: input.workId,
    workTitle: existing?.workTitle ?? input.workTitle,
    status: "in_progress",
    pendingStoragePaths: pending,
    attempts: existing?.attempts ?? 0,
    lastError: existing?.lastError ?? null,
    stageLog: [...(existing?.stageLog ?? [])],
  };
  pushLog(state, now, "collect", true, `${docs.length} document(s); ${pending.length} storage object(s) pending`);
  // Durable BEFORE any destructive step: if everything below crashes, the
  // pending Storage paths survive in the cleanup record.
  await effects.saveCleanup(state);

  if (docs.length > 0) {
    try {
      await effects.cancelQueuedJobs(docs.map((d) => d.id));
      pushLog(state, now, "cancel-jobs", true, `${docs.length} document(s)`);
      await effects.saveCleanup(state);
    } catch (error) {
      const message = errorMessage(error);
      state.attempts += 1;
      state.lastError = `cancel-jobs: ${message}`;
      pushLog(state, now, "cancel-jobs", false, message);
      await effects.saveCleanup(state);
      return { outcome: "failed", stage: "cancel-jobs", error: message };
    }
  }

  let firstStorageError: string | null = null;
  for (const path of [...state.pendingStoragePaths]) {
    try {
      await effects.deleteStorageObject(path);
      state.pendingStoragePaths = state.pendingStoragePaths.filter((p) => p !== path);
      pushLog(state, now, "storage-delete", true, path);
    } catch (error) {
      const message = errorMessage(error);
      firstStorageError ??= message;
      pushLog(state, now, "storage-delete", false, `${path}: ${message}`);
    }
  }

  if (state.pendingStoragePaths.length > 0) {
    state.status = "storage_failed";
    state.attempts += 1;
    state.lastError = `storage-delete: ${firstStorageError ?? "unknown storage error"}`;
    await effects.saveCleanup(state);
    return {
      outcome: "storage_failed",
      pendingStoragePaths: [...state.pendingStoragePaths],
      error: firstStorageError ?? "unknown storage error",
    };
  }

  try {
    await effects.deleteWorkDatabaseRows(input.workId);
    pushLog(state, now, "db-delete", true);
  } catch (error) {
    const message = errorMessage(error);
    state.attempts += 1;
    state.lastError = `db-delete: ${message}`;
    pushLog(state, now, "db-delete", false, message);
    await effects.saveCleanup(state);
    return { outcome: "failed", stage: "db-delete", error: message };
  }

  state.status = "completed";
  state.lastError = null;
  pushLog(state, now, "complete", true);
  await effects.saveCleanup(state);
  return { outcome: "completed", alreadyCompleted: false };
}
