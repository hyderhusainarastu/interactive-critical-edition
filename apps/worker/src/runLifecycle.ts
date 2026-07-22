import { cancelStaleActiveExtractJobs, db, documents, processingJobs, processingRuns, works } from "@ice/db";
import { and, eq, inArray, lt, sql } from "drizzle-orm";

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
  pipeline: "v2" | "v3" | "v4" = "v2",
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
        stage: pipeline === "v2" ? "extracting" : "canonical-identity",
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

/**
 * Sweep runs abandoned mid-flight (worker boot; extracted from index.ts's
 * main() in Phase 20.5 so it is integration-testable). A run is left
 * `running` when its process dies — an instance drained by a deploy, or a
 * job retried while still executing. Published runs are never touched, and
 * the threshold sits above the job-expiration window (and far above the
 * 60-second run heartbeat, so a live long-running job can never be swept).
 *
 * Phase 20.5 closes what the original sweep left open: the failed run's
 * DOCUMENT previously stayed `processing` forever — no visible failure
 * reason, no retry button, endless polling — and its orphaned `active`
 * pg-boss row would eventually be expire-retried into a duplicate run. The
 * sweep now (a) fails the stuck documents with a visible reason, (b) closes
 * their stale `pending`/`running` processing_job bookkeeping, and (c)
 * deletes their stale `active` extract-text queue rows. Fresh rows (a retry
 * the user just clicked) are deliberately untouched: every cleanup below is
 * bounded by the same staleness cutoff.
 */
export const ABANDONED_RUN_MESSAGE = (staleMinutes: number) =>
  `Abandoned mid-run: no progress for over ${staleMinutes} minutes (process ended before the run finished). ` +
  "Your original file is retained unchanged — retry processing to start a fresh run from it.";

export async function sweepAbandonedRuns(
  staleMinutes = Math.max(1, Number(process.env.STALE_RUN_MINUTES ?? 90)),
): Promise<{ runIds: string[]; documentIds: string[] }> {
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);
  const message = ABANDONED_RUN_MESSAGE(staleMinutes);
  const stale = await db
    .update(processingRuns)
    .set({
      status: "failed",
      stage: "failed",
      error: message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(processingRuns.status, "running"),
        eq(processingRuns.isPublished, false),
        lt(processingRuns.updatedAt, cutoff),
      ),
    )
    .returning({ id: processingRuns.id, documentId: processingRuns.documentId });
  if (stale.length === 0) return { runIds: [], documentIds: [] };

  const documentIds = [...new Set(stale.map((run) => run.documentId))];
  // Visible failure + retry affordance: only documents still stuck in
  // `processing` (a newer successful run may have moved one on already).
  await db
    .update(documents)
    .set({ processingStatus: "failed", processingError: message, updatedAt: new Date() })
    .where(and(inArray(documents.id, documentIds), eq(documents.processingStatus, "processing")));
  // Close superseded bookkeeping rows — but never a fresh one (created since
  // the cutoff), which belongs to a retry already underway.
  await db
    .update(processingJobs)
    .set({ status: "failed", error: message, updatedAt: new Date() })
    .where(
      and(
        inArray(processingJobs.documentId, documentIds),
        inArray(processingJobs.status, ["pending", "running"]),
        lt(processingJobs.createdAt, cutoff),
      ),
    );
  await cancelStaleActiveExtractJobs(documentIds, cutoff);
  return { runIds: stale.map((run) => run.id), documentIds };
}
