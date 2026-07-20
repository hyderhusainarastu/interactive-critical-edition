import { db, documents, processingRuns, works } from "@ice/db";
import { eq, sql } from "drizzle-orm";

/**
 * Processing-run lifecycle (plan §33 §1.3), extracted from the worker so the
 * concurrency + atomicity guarantees are integration-testable:
 *  - allocateEditionRun: next version under a per-document advisory lock, so
 *    two concurrent reprocesses never claim the same version.
 *  - publishEditionRun: atomically switch the published run; the prior edition
 *    stays readable until this commits, and if extraction fails (this is never
 *    called) the prior published run is left untouched.
 */

export async function allocateEditionRun(
  documentId: string,
  pipeline: "v2" | "v3" = "v2",
): Promise<{ id: string; version: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${documentId}))`);
    const [{ nextVersion }] = await tx
      .select({ nextVersion: sql<number>`coalesce(max(${processingRuns.version}), 0) + 1` })
      .from(processingRuns)
      .where(eq(processingRuns.documentId, documentId));
    const [created] = await tx
      .insert(processingRuns)
      .values({
        documentId,
        version: nextVersion,
        pipelineVersion: pipeline,
        status: "running",
        stage: pipeline === "v3" ? "canonical-identity" : "extracting",
        structureState: "limited",
        startedAt: new Date(),
      })
      .returning({ id: processingRuns.id, version: processingRuns.version });
    return created;
  });
}

export interface PublishParams {
  runId: string;
  documentId: string;
  workId: string;
  structureState: "full" | "limited";
  note: string | null;
  extractedText: string;
  detectedTitle: string | null;
  detectedAuthor: string | null;
  autoReady: boolean;
}

export async function publishEditionRun(p: PublishParams): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(processingRuns).set({ isPublished: false }).where(eq(processingRuns.documentId, p.documentId));
    await tx
      .update(processingRuns)
      .set({
        isPublished: true,
        status: "complete",
        stage: "published",
        structureState: p.structureState,
        note: p.note,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(processingRuns.id, p.runId));
    // User-approved work metadata is stronger than a lower-confidence re-extract,
    // so only auto-overwrite the work when the extractor is confident.
    if (p.autoReady && p.detectedTitle) {
      await tx.update(works).set({ title: p.detectedTitle, authorName: p.detectedAuthor, updatedAt: new Date() }).where(eq(works.id, p.workId));
    }
    await tx
      .update(documents)
      .set({
        extractedText: p.extractedText,
        extractedTitle: p.detectedTitle,
        extractedAuthor: p.detectedAuthor,
        processingStatus: p.autoReady ? "ready" : "needs_review",
        analysisStatus: "complete",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, p.documentId));
  });
}
