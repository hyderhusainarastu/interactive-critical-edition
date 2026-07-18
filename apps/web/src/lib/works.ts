import { db, documents, works } from "@ice/db";
import { and, eq } from "drizzle-orm";

/**
 * Resolves the single document for a work the given user actually owns.
 * Returns null (never a distinguishable "forbidden" state) so callers
 * always respond 404 — consistent with the rest of the app's IDOR
 * posture (plan §15: don't reveal whether a resource id exists for
 * another user).
 */
export async function getOwnedDocument(workId: string, userId: string) {
  const [row] = await db
    .select({
      documentId: documents.id,
      workId: works.id,
      title: works.title,
      mimeType: documents.mimeType,
      storagePath: documents.storagePath,
      processingStatus: documents.processingStatus,
      extractedText: documents.extractedText,
      lastPosition: documents.lastPosition,
    })
    .from(works)
    .innerJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.id, workId), eq(works.userId, userId)))
    .limit(1);
  return row ?? null;
}
