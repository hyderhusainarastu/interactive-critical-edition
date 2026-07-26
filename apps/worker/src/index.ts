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
  QUEUE_EXTRACT_RESEARCH_CLAIMS,
  QUEUE_IMPORT_RESEARCH_CORPUS,
  QUEUE_ANALYZE_CLAIM_DEBATES,
  RESEARCH_QUEUES,
  type ResearchJobPayload,
  type ResearchQueueName,
  researchCache,
  researchJobRequests,
} from "@ice/db";
import { reportError } from "@ice/observability";
import { eq, lt } from "drizzle-orm";
import { analyzeWork, resolveCitationMetadata } from "./analyze";
import { activePipelineVersion, handleEditionExtraction, handleExtractText } from "./extraction";
import { sweepAbandonedRuns } from "./runLifecycle";
import { expandCrossLibraryGraph } from "./crossLibraryGraph";
import { clusterDebates } from "./research/clusterDebates";
import { detectRelationships } from "./research/detectRelationships";
import { extractClaims } from "./research/extractClaims";
import { importCorpus } from "./research/importCorpus";
import { runResearchJob } from "./research/jobRunner";
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

  // Phase 26.1: extract-research-claims gets its real handler.
  // `runResearchJob` (jobRunner.ts) owns the request's lifecycle (running →
  // complete/failed, budget seeding, usage-log batching) and already reports
  // any thrown error itself before rethrowing — no second `reportError` call
  // here, matching `QUEUE_ANALYZE_WORK`'s simpler style above rather than
  // `QUEUE_EXPAND_CROSS_LIBRARY_GRAPH`'s (whose own function does NOT
  // self-report).
  await boss.work<ResearchJobPayload>(QUEUE_EXTRACT_RESEARCH_CLAIMS, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) await runResearchJob(job.data.requestId, extractClaims);
  });

  // Phase 28.2: import-research-corpus gets its real handler for
  // `import_corpus` jobs. `run_monitor` (Phase 29.1) shares this SAME queue
  // (plan §Pipeline: "also carries scheduled monitors") but is not
  // implemented yet — a request of that job type on this queue still falls
  // through to the honest no-op below, exactly as it did before this lane.
  await boss.work<ResearchJobPayload>(QUEUE_IMPORT_RESEARCH_CORPUS, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      const [request] = await db
        .select({ jobType: researchJobRequests.jobType })
        .from(researchJobRequests)
        .where(eq(researchJobRequests.id, job.data.requestId))
        .limit(1);
      if (request?.jobType === "import_corpus") {
        await runResearchJob(job.data.requestId, importCorpus);
        continue;
      }
      try {
        await handleUnimplementedResearchJob(QUEUE_IMPORT_RESEARCH_CORPUS, job.data.requestId);
      } catch (error) {
        reportError(error, { scope: `worker.${QUEUE_IMPORT_RESEARCH_CORPUS}`, requestId: job.data.requestId });
        throw error;
      }
    }
  });

  // Phase 26.2a/26.2b/26.3: analyze-claim-debates gets its real handler for
  // BOTH job types this queue carries — `detect_relationships` (Stage-1
  // candidate retrieval + citation engagement + the paid judge stage) and
  // `cluster_debates` (BFS clustering + naming over judged relationships).
  // `packages/db/src/queue.ts`'s doc comment explains why these run as two
  // job types on ONE queue rather than two separate queues: relationship
  // detection and clustering are staged as one resumable request family, so
  // a paid judgement is never stranded with nothing enqueued to group it.
  // The request's OWN `jobType` decides which path a given message takes; a
  // stale request enqueued before this shipped is handled the same as any
  // other, since `runResearchJob` re-reads current DB state rather than
  // trusting the queue message.
  await boss.work<ResearchJobPayload>(QUEUE_ANALYZE_CLAIM_DEBATES, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      const [request] = await db
        .select({ jobType: researchJobRequests.jobType })
        .from(researchJobRequests)
        .where(eq(researchJobRequests.id, job.data.requestId))
        .limit(1);
      if (!request) {
        // Same class as the stale extract-text/analyze-work jobs D-19-2
        // addressed: a request row deleted after enqueue. Nothing to do.
        console.warn(`[worker] ${QUEUE_ANALYZE_CLAIM_DEBATES}: research_job_request ${job.data.requestId} not found; skipping`);
        continue;
      }
      if (request.jobType === "detect_relationships") {
        await runResearchJob(job.data.requestId, detectRelationships);
      } else if (request.jobType === "cluster_debates") {
        await runResearchJob(job.data.requestId, clusterDebates);
      } else {
        try {
          await handleUnimplementedResearchJob(QUEUE_ANALYZE_CLAIM_DEBATES, job.data.requestId);
        } catch (error) {
          reportError(error, { scope: `worker.${QUEUE_ANALYZE_CLAIM_DEBATES}`, requestId: job.data.requestId });
          throw error;
        }
      }
    }
  });

  // Phase 25.6: the remaining research queues stay honest no-ops until
  // their own lanes (26.3 clustering, 27 synthesis, 29 monitors) replace
  // this registration — see `handleUnimplementedResearchJob`'s doc comment.
  // Registering now means the queue rows and this worker's consumer set
  // exist before any web route can enqueue, so an early enqueue is dequeued
  // and answered honestly instead of sitting `created` forever with nothing
  // consuming it.
  for (const queueName of RESEARCH_QUEUES.filter(
    (name) => name !== QUEUE_EXTRACT_RESEARCH_CLAIMS && name !== QUEUE_IMPORT_RESEARCH_CORPUS && name !== QUEUE_ANALYZE_CLAIM_DEBATES,
  )) {
    await boss.work<ResearchJobPayload>(queueName, async (jobs) => {
      const batch = Array.isArray(jobs) ? jobs : [jobs];
      for (const job of batch) {
        try {
          await handleUnimplementedResearchJob(queueName, job.data.requestId);
        } catch (error) {
          reportError(error, { scope: `worker.${queueName}`, requestId: job.data.requestId });
          throw error;
        }
      }
    });
  }

  // Log the RESOLVED version, not the raw env var: Phase 8 lost three canary
  // runs to production quietly running something other than what was assumed.
  const queueNames = [
    QUEUE_EXTRACT_TEXT,
    QUEUE_ANALYZE_WORK,
    QUEUE_RESOLVE_CITATION_METADATA,
    QUEUE_EXPAND_CROSS_LIBRARY_GRAPH,
    ...RESEARCH_QUEUES,
  ]
    .map((name) => `"${name}"`)
    .join(", ");
  console.log(`[worker] listening for ${queueNames} jobs (pipeline ${activePipelineVersion()})`);
}

/** The failure text a research request carries until its engine ships. Asserted on, so it is a constant. */
export const RESEARCH_NOT_IMPLEMENTED = "research pipeline not yet implemented";

/**
 * Phase 25.6's honest no-op research handler. The queues exist; the engine that
 * fulfils them does not yet. Rather than silently completing a job that did
 * nothing — which would leave the request row stuck `queued` forever and read
 * to the user as "still working" — this records an explicit terminal failure
 * with a truthful reason on the ledger row.
 *
 * It deliberately does NOT rethrow on this path: the no-op is a definitive
 * answer, not a transient fault, so pg-boss must not retry it. Genuine errors
 * (a DB failure while recording the above) do propagate — see the caller's
 * try/catch, which reports and rethrows them.
 *
 * Each research lane REPLACES this registration with its real handler; this
 * function is expected to be deleted, not extended.
 */
async function handleUnimplementedResearchJob(queueName: ResearchQueueName, requestId: string): Promise<void> {
  const [request] = await db
    .select({ id: researchJobRequests.id, status: researchJobRequests.status })
    .from(researchJobRequests)
    .where(eq(researchJobRequests.id, requestId))
    .limit(1);

  if (!request) {
    // Same class as the stale extract-text jobs D-19-2 addressed: a request
    // deleted after enqueue. Nothing to record, and nothing is wrong.
    console.warn(`[worker] ${queueName}: research_job_request ${requestId} not found; skipping`);
    return;
  }

  console.warn(`[worker] ${queueName}: ${RESEARCH_NOT_IMPLEMENTED} (request ${requestId})`);
  await db
    .update(researchJobRequests)
    .set({ status: "failed", error: RESEARCH_NOT_IMPLEMENTED, updatedAt: new Date() })
    .where(eq(researchJobRequests.id, requestId));
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
