import { cancelQueuedJobsForDocuments, db, documents, works } from "@ice/db";
import { deleteDocumentFile } from "@ice/ingestion";
import { and, eq, isNotNull, lt } from "drizzle-orm";

/** Plan §34.4 9.7: works are recoverable for 30 days after being trashed. */
export const TRASH_RETENTION_DAYS = 30;

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
}

export async function listTrashedWorks(userId: string): Promise<TrashedWork[]> {
  const rows = await db
    .select({ id: works.id, title: works.title, authorName: works.authorName, deletedAt: works.deletedAt })
    .from(works)
    .where(and(eq(works.userId, userId), isNotNull(works.deletedAt)));

  return rows
    .filter((r): r is typeof r & { deletedAt: Date } => r.deletedAt !== null)
    .map((r) => ({
      workId: r.id,
      title: r.title,
      authorName: r.authorName,
      deletedAt: r.deletedAt,
      daysRemaining: daysUntilPurge(r.deletedAt),
    }))
    .sort((a, b) => a.daysRemaining - b.daysRemaining);
}

/**
 * Permanently removes ONE trashed work: captures its documents' Storage
 * paths first (Postgres cascades the DB rows on work delete, but has no
 * idea Supabase Storage exists — same gap `deleteDocumentFile`'s other
 * caller, `apps/web/e2e/helpers.ts`'s `deleteTestUser`, works around),
 * best-effort removes each Storage object, cancels any not-yet-run
 * `extract-text`/`analyze-work` pg-boss jobs still queued for those
 * documents (pg-boss's job table is a separate schema with no FK to
 * `document` either, so a queued job for a deleted document would
 * otherwise survive and later fail as "Document not found" — see
 * `cancelQueuedJobsForDocuments`), then hard-deletes the `work` row —
 * cascading through document/processing_run/page/text_block/
 * research_resource/.../reading_record/understanding_rating/
 * roadmap_override, the full blast radius trash exists to guard against
 * doing by accident.
 */
async function purgeWork(workId: string): Promise<void> {
  const docs = await db.select({ id: documents.id, storagePath: documents.storagePath }).from(documents).where(eq(documents.workId, workId));
  for (const doc of docs) {
    await deleteDocumentFile(doc.storagePath).catch(() => {});
  }
  await cancelQueuedJobsForDocuments(docs.map((d) => d.id));
  await db.delete(works).where(eq(works.id, workId));
}

/**
 * Deletes ONE work right now, bypassing the 30-day wait — an explicit user
 * choice ("Delete permanently now" on the trash page), never something the
 * system does on its own. Still requires the work to already be trashed
 * (checked by the caller via `getOwnedWork`) so this can't be used to skip
 * the trash step entirely.
 */
export async function purgeWorkNow(workId: string): Promise<void> {
  await purgeWork(workId);
}

/**
 * Opportunistic purge (plan §34.4 9.7: "idempotent purge") — no scheduled
 * job, no new pg-boss queue: trash is pure web CRUD with no AI/worker
 * involvement, so a new cron queue would be real production infrastructure
 * for a feature that doesn't need it. Called at the top of `/works/trash`;
 * naturally idempotent since a `WHERE deleted_at < ...` match is simply
 * empty on a second run — there is nothing to "redo" or get wrong by
 * running it twice, or never, until the next visit.
 */
export async function purgeExpiredTrash(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const expired = await db
    .select({ id: works.id })
    .from(works)
    .where(and(eq(works.userId, userId), isNotNull(works.deletedAt), lt(works.deletedAt, cutoff)));
  for (const w of expired) {
    await purgeWork(w.id);
  }
}
