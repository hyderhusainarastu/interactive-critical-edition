import { db, documents, works } from "@ice/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Resolves the single document for a work the given user actually owns.
 * Returns null (never a distinguishable "forbidden" state) so callers
 * always respond 404 — consistent with the rest of the app's IDOR
 * posture (plan §15: don't reveal whether a resource id exists for
 * another user).
 *
 * Excludes trashed works (plan §34.4 9.7) — every reader/analysis/roadmap/
 * curriculum/graph feature this backs becomes inaccessible while a work is
 * trashed, same as it doesn't exist, until it's restored. The one exception
 * is the work's own detail page and the trash routes themselves, which use
 * `getOwnedWork()` below instead (trashed works must stay visible SOMEWHERE
 * or restore would have nothing to act on).
 */
export async function getOwnedDocument(workId: string, userId: string) {
  const [row] = await db
    .select({
      documentId: documents.id,
      workId: works.id,
      title: works.title,
      authorName: works.authorName,
      mimeType: documents.mimeType,
      storagePath: documents.storagePath,
      processingStatus: documents.processingStatus,
      analysisStatus: documents.analysisStatus,
      analysisError: documents.analysisError,
      extractedText: documents.extractedText,
      lastPosition: documents.lastPosition,
    })
    .from(works)
    .innerJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
    .limit(1);
  return row ?? null;
}

/**
 * Resolves a work the given user owns REGARDLESS of trash state — for the
 * work's own detail page and the trash routes (delete/restore), which need
 * to keep working on an already-trashed work. Everything else should use
 * `getOwnedDocument()` above.
 */
export async function getOwnedWork(workId: string, userId: string) {
  const [row] = await db
    .select({ id: works.id, title: works.title, deletedAt: works.deletedAt })
    .from(works)
    .where(and(eq(works.id, workId), eq(works.userId, userId)))
    .limit(1);
  return row ?? null;
}
