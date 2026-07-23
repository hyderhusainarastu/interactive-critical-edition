import { isEditionPipeline } from "@ice/config";
import {
  type AnalyzeWorkJob,
  type ResolveCitationMetadataJob,
  db,
  type ExtractTextJob,
  getQueue,
  QUEUE_ANALYZE_WORK,
  QUEUE_RESOLVE_CITATION_METADATA,
  QUEUE_EXPAND_CROSS_LIBRARY_GRAPH,
  type ExpandCrossLibraryGraphJob,
  QUEUE_EXTRACT_TEXT,
  researchCache,
} from "@ice/db";
import { reportError } from "@ice/observability";
import { lt } from "drizzle-orm";
import { analyzeWork, resolveCitationMetadata } from "./analyze";
import { activePipelineVersion, handleEditionExtraction, handleExtractText } from "./extraction";
import { sweepAbandonedRuns } from "./runLifecycle";
import { expandCrossLibraryGraph } from "./crossLibraryGraph";
import "./sentry";

async function main() {
  const boss = await getQueue();

  // Sweep expired result-cache rows so research_cache stays bounded (plan §33).
  try {
    const swept = await db.delete(researchCache).where(lt(researchCache.expiresAt, new Date())).returning({ id: researchCache.id });
    if (swept.length) console.log(`[worker] swept ${swept.length} expired research_cache row(s)`);
  } catch (err) {
    reportError(err, { scope: "worker.cacheSweep" });
  }

  // Sweep runs abandoned mid-flight (see runLifecycle.sweepAbandonedRuns for
  // the full rationale — fails the stuck runs AND their documents/bookkeeping
  // so the UI shows a visible failure with a retry, and removes their
  // orphaned active queue rows so pg-boss can't retry them into duplicates).
  try {
    const { runIds } = await sweepAbandonedRuns();
    if (runIds.length) console.log(`[worker] marked ${runIds.length} abandoned processing_run row(s) as failed`);
  } catch (err) {
    reportError(err, { scope: "worker.staleRunSweep" });
  }

  await boss.work<ExtractTextJob>(QUEUE_EXTRACT_TEXT, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      if (isEditionPipeline(activePipelineVersion())) await handleEditionExtraction(job.data.documentId);
      else await handleExtractText(job.data.documentId);
    }
  });

  await boss.work<AnalyzeWorkJob>(QUEUE_ANALYZE_WORK, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      // analyzeWork records its own failure state on the document; it
      // rethrows so pg-boss also marks the job failed for retry/visibility.
      //
      // Deliberately NOT gated on isEditionPipeline() here: a stale job
      // enqueued before the D-23-3 fix, or one enqueued under a web env that
      // disagrees with this worker's pipeline version, must still be handled
      // safely. analyzeWork's own data-driven guard (it no-ops when a
      // processing_run exists for the document) is what makes dequeuing such
      // a job safe — it must not be moved out of analyzeWork into a version
      // check here, or that stale-job protection is lost.
      await analyzeWork(job.data.documentId);
    }
  });

  await boss.work<ResolveCitationMetadataJob>(QUEUE_RESOLVE_CITATION_METADATA, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    // Deliberately sequential: one external bibliographic lookup at a time is
    // the rate limit; a miss records an unresolved Library item rather than
    // holding up extraction or discovery.
    for (const job of batch) await resolveCitationMetadata(job.data.citationId);
  });

  await boss.work<ExpandCrossLibraryGraphJob>(QUEUE_EXPAND_CROSS_LIBRARY_GRAPH, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      try {
        await expandCrossLibraryGraph(job.data.expansionRequestId);
      } catch (error) {
        reportError(error, { scope: "worker.expandCrossLibraryGraph", expansionRequestId: job.data.expansionRequestId });
        throw error;
      }
    }
  });

  // Log the RESOLVED version, not the raw env var: Phase 8 lost three canary
  // runs to production quietly running something other than what was assumed.
  console.log(
    `[worker] listening for "${QUEUE_EXTRACT_TEXT}", "${QUEUE_ANALYZE_WORK}", "${QUEUE_RESOLVE_CITATION_METADATA}", and "${QUEUE_EXPAND_CROSS_LIBRARY_GRAPH}" jobs (pipeline ${activePipelineVersion()})`,
  );
}

/** A crash outside any job handler's own try/catch (e.g. a driver-level
 * exception thrown mid-query, as in the 2026-07-20 "unsupported Unicode
 * escape sequence" incident) previously reached Node's default handler with
 * no structured/Sentry-visible record — the only trace was a raw stack in
 * Render's log stream. Render still restarts the instance either way; this
 * only makes the restart's cause diagnosable instead of silent. */
function installCrashObservability() {
  const onFatal = (scope: string) => (err: unknown) => {
    reportError(err, { scope: `worker.${scope}`, pipeline: activePipelineVersion(), commit: process.env.RENDER_GIT_COMMIT ?? null });
    console.error(`[worker] fatal ${scope}, exiting for Render to restart:`, err);
    process.exit(1);
  };
  process.on("uncaughtException", onFatal("uncaughtException"));
  process.on("unhandledRejection", onFatal("unhandledRejection"));
}

installCrashObservability();

main().catch((err) => {
  console.error("[worker] fatal error during startup:", err);
  process.exit(1);
});
