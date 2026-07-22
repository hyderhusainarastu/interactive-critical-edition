import {
  cancelQueuedJobsForDocuments,
  db,
  deletionCleanups,
  documents,
  graphEdges,
  works,
} from "@ice/db";
import {
  executeWorkDeletion,
  type DeletionCleanupState,
  type DeletionStageLogEntry,
  type WorkDeletionEffects,
  type WorkDeletionOutcome,
} from "@ice/deletion";
import { deleteDocumentFile } from "@ice/ingestion";
import { and, eq, isNotNull, lt, ne, or, sql } from "drizzle-orm";

/** Plan §34.4 9.7: works are recoverable for 30 days after being trashed. */
export const TRASH_RETENTION_DAYS = 30;

/**
 * An `in_progress` cleanup row younger than this is assumed to belong to a
 * concurrent request and is left alone by the opportunistic retry; older
 * ones are treated as crashed mid-run and resumed.
 */
const IN_PROGRESS_RETRY_AFTER_MS = 10 * 60 * 1000;

export function daysUntilPurge(deletedAt: Date, now: Date = new Date()): number {
  const msElapsed = now.getTime() - deletedAt.getTime();
  const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - daysElapsed));
}

export interface TrashedWork {
  workId: string;
  title: string;
  authorName: string | null;
  deletedAt: Date;
  daysRemaining: number;
  /**
   * Typed-title confirmation is required for high-value works (plan §20.3):
   * multiple editions, or a ready document carrying real reader data.
   */
  requiresTypedConfirmation: boolean;
  /** Honest partial-failure state, when a prior permanent delete could not finish. */
  cleanupStatus: "in_progress" | "storage_failed" | null;
}

export async function listTrashedWorks(userId: string): Promise<TrashedWork[]> {
  const rows = await db
    .select({
      id: works.id,
      title: works.title,
      authorName: works.authorName,
      deletedAt: works.deletedAt,
      editionCount: sql<number>`(select count(*) from edition e where e.work_id = ${works.id})`,
      readyDocCount: sql<number>`(select count(*) from document d where d.work_id = ${works.id} and d.processing_status = 'ready')`,
      cleanupStatus: deletionCleanups.status,
    })
    .from(works)
    .leftJoin(deletionCleanups, eq(deletionCleanups.workId, works.id))
    .where(and(eq(works.userId, userId), isNotNull(works.deletedAt)));

  return rows
    .filter((r): r is typeof r & { deletedAt: Date } => r.deletedAt !== null)
    .map((r) => ({
      workId: r.id,
      title: r.title,
      authorName: r.authorName,
      deletedAt: r.deletedAt,
      daysRemaining: daysUntilPurge(r.deletedAt),
      requiresTypedConfirmation: Number(r.editionCount) > 1 || Number(r.readyDocCount) > 0,
      cleanupStatus: r.cleanupStatus === "completed" ? null : (r.cleanupStatus ?? null),
    }))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/**
 * The real side effects behind `@ice/deletion`'s pure state machine — see
 * that package's doc comment for the ordering/failure/idempotency contract.
 * The cleanup record lives in `deletion_cleanup` keyed by workId (no FK:
 * the work row is hard-deleted mid-flow and the record must outlive it).
 */
function deletionEffects(userId: string): WorkDeletionEffects {
  return {
    async listDocuments(workId) {
      return db
        .select({ id: documents.id, storagePath: documents.storagePath })
        .from(documents)
        .where(eq(documents.workId, workId));
    },
    async getCleanup(workId) {
      const [row] = await db.select().from(deletionCleanups).where(eq(deletionCleanups.workId, workId)).limit(1);
      if (!row) return null;
      return {
        userId: row.userId,
        workId: row.workId,
        workTitle: row.workTitle,
        status: row.status,
        pendingStoragePaths: (row.pendingStoragePaths as string[]) ?? [],
        attempts: row.attempts,
        lastError: row.lastError,
        stageLog: (row.stageLog as DeletionStageLogEntry[]) ?? [],
      };
    },
    async saveCleanup(state: DeletionCleanupState) {
      const now = new Date();
      const values = {
        userId: state.userId,
        workId: state.workId,
        workTitle: state.workTitle,
        status: state.status,
        pendingStoragePaths: state.pendingStoragePaths,
        attempts: state.attempts,
        lastError: state.lastError,
        stageLog: state.stageLog,
        updatedAt: now,
        completedAt: state.status === "completed" ? now : null,
      };
      await db
        .insert(deletionCleanups)
        .values(values)
        .onConflictDoUpdate({ target: deletionCleanups.workId, set: values });
    },
    async cancelQueuedJobs(documentIds) {
      await cancelQueuedJobsForDocuments(documentIds);
    },
    async deleteStorageObject(path) {
      // Supabase's remove() resolves (no error) for an already-missing
      // object, which is exactly the idempotency the machine requires.
      await deleteDocumentFile(path);
    },
    async deleteWorkDatabaseRows(workId) {
      // graph_edge is polymorphic (no FK Postgres could cascade), so the
      // work's edges must be removed explicitly or they orphan (D-20-31).
      await db
        .delete(graphEdges)
        .where(
          and(
            eq(graphEdges.userId, userId),
            or(
              and(eq(graphEdges.sourceType, "work"), eq(graphEdges.sourceId, workId)),
              and(eq(graphEdges.targetType, "work"), eq(graphEdges.targetId, workId)),
            ),
          ),
        );
      // Cascades document/edition/reader/analysis/RAG/profile rows. Shared
      // catalog rows (bibliographic_record, work_identity, learning_resource)
      // are deliberately untouched, and ai_usage_log survives by policy
      // (document_id is ON DELETE SET NULL).
      await db.delete(works).where(eq(works.id, workId));
    },
  };
}

/**
 * Permanently deletes ONE trashed work through the Phase 20.3 state machine.
 * Never reports success unless every private Storage object was confirmed
 * removed; a partial failure persists a retryable, admin-visible
 * `deletion_cleanup` row instead. Idempotent: a repeat call after completion
 * short-circuits, a retry resumes from the persisted record.
 */
export async function purgeWorkNow(userId: string, workId: string, workTitle: string): Promise<WorkDeletionOutcome> {
  return executeWorkDeletion(deletionEffects(userId), { userId, workId, workTitle });
}

/** Owner-scoped lookup of a cleanup record — the idempotency answer for a repeated delete request. */
export async function getDeletionCleanup(userId: string, workId: string) {
  const [row] = await db
    .select()
    .from(deletionCleanups)
    .where(and(eq(deletionCleanups.userId, userId), eq(deletionCleanups.workId, workId)))
    .limit(1);
  return row ?? null;
}

/**
 * Opportunistically resumes this user's unfinished deletions (retryable
 * `storage_failed` rows, plus `in_progress` rows old enough to be a crashed
 * run rather than a concurrent one). Same no-scheduler posture as
 * `purgeExpiredTrash` below: trash is pure web CRUD, and a retry loop on
 * every trash read converges without new infrastructure.
 */
export async function retryPendingCleanups(userId: string): Promise<void> {
  const stale = new Date(Date.now() - IN_PROGRESS_RETRY_AFTER_MS);
  const pending = await db
    .select({ workId: deletionCleanups.workId, workTitle: deletionCleanups.workTitle, status: deletionCleanups.status, updatedAt: deletionCleanups.updatedAt })
    .from(deletionCleanups)
    .where(and(eq(deletionCleanups.userId, userId), ne(deletionCleanups.status, "completed")));
  for (const row of pending) {
    if (row.status === "in_progress" && row.updatedAt > stale) continue;
    // Defense in depth against deleting a RESTORED work: the restore route
    // removes the cleanup row, but if that ever regresses (or a restore
    // races this loop), a work that exists and is no longer trashed must
    // never be resumed into deletion. A missing work row is the opposite
    // case — a crashed run whose DB delete already happened — and is safe
    // to resume.
    const [workRow] = await db
      .select({ deletedAt: works.deletedAt })
      .from(works)
      .where(and(eq(works.id, row.workId), eq(works.userId, userId)))
      .limit(1);
    if (workRow && workRow.deletedAt === null) {
      await db
        .delete(deletionCleanups)
        .where(and(eq(deletionCleanups.userId, userId), eq(deletionCleanups.workId, row.workId)));
      continue;
    }
    await executeWorkDeletion(deletionEffects(userId), { userId, workId: row.workId, workTitle: row.workTitle });
  }
}

/**
 * Opportunistic purge (plan §34.4 9.7: "idempotent purge") — no scheduled
 * job, no new pg-boss queue: trash is pure web CRUD with no AI/worker
 * involvement, so a new cron queue would be real production infrastructure
 * for a feature that doesn't need it. Called at the top of `/works/trash`;
 * naturally idempotent since a `WHERE deleted_at < ...` match is simply
 * empty on a second run — there is nothing to "redo" or get wrong by
 * running it twice, or never, until the next visit. Since Phase 20.3 each
 * expiry runs through the same state machine as the user-facing permanent
 * delete, so an expired work whose Storage deletion fails is retried on a
 * later visit rather than silently leaking its bytes.
 */
export async function purgeExpiredTrash(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const expired = await db
    .select({ id: works.id, title: works.title })
    .from(works)
    .where(and(eq(works.userId, userId), isNotNull(works.deletedAt), lt(works.deletedAt, cutoff)));
  for (const w of expired) {
    await executeWorkDeletion(deletionEffects(userId), { userId, workId: w.id, workTitle: w.title });
  }
}
