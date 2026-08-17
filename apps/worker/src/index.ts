import { isEditionPipeline, phase25FeatureEnabled } from "@ice/config";
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
  QUEUE_SYNTHESIZE_RESEARCH,
  RESEARCH_QUEUES,
  RUN_MONITOR_CRON_NAME,
  RUN_MONITOR_CRON_PAYLOAD,
  RUN_MONITOR_CRON_SCHEDULE,
  isRunMonitorCronTrigger,
  type ResearchJobPayload,
  type RunMonitorCronTrigger,
  researchCache,
} from "@ice/db";
import { reportError } from "@ice/observability";
import { lt } from "drizzle-orm";
import { analyzeWork, resolveCitationMetadata } from "./analyze";
import { activePipelineVersion, handleEditionExtraction, handleExtractText } from "./extraction";
import { sweepAbandonedRuns } from "./runLifecycle";
import { expandCrossLibraryGraph } from "./crossLibraryGraph";
import { clusterDebates } from "./research/clusterDebates";
import { detectRelationships } from "./research/detectRelationships";
import { extractClaims } from "./research/extractClaims";
import { generateHypotheses } from "./research/generateHypotheses";
import { importCorpus } from "./research/importCorpus";
import { runResearchJob } from "./research/jobRunner";
import { runDueMonitorFanout, runMonitor } from "./research/runMonitor";
import { synthesizeChamber } from "./research/synthesizeChamber";
import { RESEARCH_NOT_IMPLEMENTED, registerSimpleQueue, registerTypedQueue, runUnimplementedWrapped } from "./queueRegistry";
import "./sentry";

// Re-exported so any importer that reached for `RESEARCH_NOT_IMPLEMENTED`
// from this module (its home before this refactor) keeps working — its real
// definition now lives in `queueRegistry.ts` alongside the dispatcher that
// uses it.
export { RESEARCH_NOT_IMPLEMENTED };

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

  await registerSimpleQueue<ExtractTextJob>(boss, {
    name: QUEUE_EXTRACT_TEXT,
    errorPolicy: { kind: "selfReported" },
    run: async (data) => {
      if (isEditionPipeline(activePipelineVersion())) await handleEditionExtraction(data.documentId);
      else await handleExtractText(data.documentId);
    },
  });

  await registerSimpleQueue<AnalyzeWorkJob>(boss, {
    name: QUEUE_ANALYZE_WORK,
    errorPolicy: { kind: "selfReported" },
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
    run: async (data) => {
      await analyzeWork(data.documentId);
    },
  });

  await registerSimpleQueue<ResolveCitationMetadataJob>(boss, {
    name: QUEUE_RESOLVE_CITATION_METADATA,
    errorPolicy: { kind: "selfReported" },
    // Dispatched one job at a time by registerSimpleQueue's own per-job
    // `for` loop (never Promise.all'd) — deliberately sequential: one
    // external bibliographic lookup at a time is the rate limit; a miss
    // records an unresolved Library item rather than holding up extraction
    // or discovery.
    run: async (data) => {
      await resolveCitationMetadata(data.citationId);
    },
  });

  await registerSimpleQueue<ExpandCrossLibraryGraphJob>(boss, {
    name: QUEUE_EXPAND_CROSS_LIBRARY_GRAPH,
    errorPolicy: {
      kind: "wrapped",
      context: (data) => ({ scope: "worker.expandCrossLibraryGraph", expansionRequestId: data.expansionRequestId }),
    },
    run: async (data) => {
      await expandCrossLibraryGraph(data.expansionRequestId);
    },
  });

  // Phase 26.1: extract-research-claims gets its real handler.
  // `runResearchJob` (jobRunner.ts) owns the request's lifecycle (running →
  // complete/failed, budget seeding, usage-log batching) and already reports
  // any thrown error itself before rethrowing — no second `reportError` call
  // here, matching `QUEUE_ANALYZE_WORK`'s simpler style above rather than
  // `QUEUE_EXPAND_CROSS_LIBRARY_GRAPH`'s (whose own function does NOT
  // self-report).
  await registerSimpleQueue<ResearchJobPayload>(boss, {
    name: QUEUE_EXTRACT_RESEARCH_CLAIMS,
    errorPolicy: { kind: "selfReported" },
    run: async (data) => {
      await runResearchJob(data.requestId, extractClaims);
    },
  });

  // Phase 28.2/29.1: import-research-corpus gets its real handler for both
  // job types this queue carries — `import_corpus` (28.2) and `run_monitor`
  // (29.1, plan §Pipeline: "also carries scheduled monitors"). This queue
  // ALSO carries the daily monitor cron's own static trigger payload
  // (`RUN_MONITOR_CRON_PAYLOAD`, no `requestId` — see `packages/db/src/
  // queue.ts`'s doc comment on why pg-boss's fixed-per-tick payload forces
  // that trigger onto this same queue rather than a real per-request
  // message); that shape is checked FIRST since it carries no `requestId` to
  // look a `research_job_request` up by. Any other job type still falls
  // through to the honest no-op below, exactly as it did before this lane.
  //
  // Note this queue has NO explicit "request not found" check (unlike the
  // two queues below): an undefined/missing request's jobType is
  // `undefined`, which simply matches no route and falls to the same
  // unmatched-type fallback as any unrecognized jobType would.
  await registerTypedQueue<ResearchJobPayload | RunMonitorCronTrigger>(boss, {
    name: QUEUE_IMPORT_RESEARCH_CORPUS,
    // The cron payload carries no `requestId`; this MUST run before any
    // jobType DB lookup is even attempted.
    getRequestId: (data) => (data as ResearchJobPayload).requestId,
    preCheck: {
      test: (data) => isRunMonitorCronTrigger(data),
      run: async () => {
        const { usersEnqueued } = await runDueMonitorFanout();
        if (usersEnqueued > 0) console.log(`[worker] run_monitor cron fan-out enqueued ${usersEnqueued} user(s) with due monitors`);
      },
      context: () => ({ scope: "worker.runDueMonitorFanout" }),
    },
    explicitNotFoundCheck: false,
    routes: [
      { test: (jobType) => jobType === "import_corpus", run: (requestId) => runResearchJob(requestId, importCorpus) },
      { test: (jobType) => jobType === "run_monitor", run: (requestId) => runResearchJob(requestId, runMonitor) },
    ],
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
  await registerTypedQueue<ResearchJobPayload>(boss, {
    name: QUEUE_ANALYZE_CLAIM_DEBATES,
    getRequestId: (data) => data.requestId,
    explicitNotFoundCheck: true,
    routes: [
      { test: (jobType) => jobType === "detect_relationships", run: (requestId) => runResearchJob(requestId, detectRelationships) },
      { test: (jobType) => jobType === "cluster_debates", run: (requestId) => runResearchJob(requestId, clusterDebates) },
    ],
  });

  // Phase 27.1/27.2: synthesize-research-output gets its real handlers for
  // both `synthesize_chamber` (Evidence Chamber, 27.1) and
  // `generate_hypotheses` (27.2) jobs — the two lanes shared this SAME queue
  // (plan §Pipeline: "Evidence Chamber + hypotheses, explicit action only")
  // and merged in, so both branches are dispatched here now. Any other job
  // type on this queue still falls through to the honest no-op below,
  // exactly as before either lane landed.
  await registerTypedQueue<ResearchJobPayload>(boss, {
    name: QUEUE_SYNTHESIZE_RESEARCH,
    getRequestId: (data) => data.requestId,
    explicitNotFoundCheck: true,
    routes: [
      { test: (jobType) => jobType === "synthesize_chamber", run: (requestId) => runResearchJob(requestId, synthesizeChamber) },
      { test: (jobType) => jobType === "generate_hypotheses", run: (requestId) => runResearchJob(requestId, generateHypotheses) },
    ],
  });

  // Phase 25.6: any FUTURE research queue stays an honest no-op until its own
  // lane replaces this registration — see `handleUnimplementedResearchJob`'s
  // doc comment (queueRegistry.ts). As of Phase 29.1 every current
  // `RESEARCH_QUEUES` entry has a real handler above, so this loop is
  // currently a no-op over an empty filtered list; left in place (rather
  // than deleted) as the landing spot for the next research queue this
  // codebase adds, matching the same "register now so an early enqueue is
  // answered honestly, not left `created` forever" reasoning it always has.
  for (const queueName of RESEARCH_QUEUES.filter(
    (name) =>
      name !== QUEUE_EXTRACT_RESEARCH_CLAIMS &&
      name !== QUEUE_IMPORT_RESEARCH_CORPUS &&
      name !== QUEUE_ANALYZE_CLAIM_DEBATES &&
      name !== QUEUE_SYNTHESIZE_RESEARCH,
  )) {
    await registerSimpleQueue<ResearchJobPayload>(boss, {
      name: queueName,
      // `selfReported`, not `wrapped`: `runUnimplementedWrapped` already
      // does its own try/catch + `reportError` + rethrow (the exact
      // `{ scope: "worker.<queue>", requestId }` shape this loop used
      // inline before this refactor). Using `wrapped` here too would report
      // the same error twice.
      errorPolicy: { kind: "selfReported" },
      run: async (data) => {
        await runUnimplementedWrapped(queueName, data.requestId);
      },
    });
  }

  // Phase 29.1: the daily monitor-scan cron, guarded by the `monitoring`
  // flag (default off — `packages/config/src/phase25.ts`'s own doc comment:
  // "a scheduled job is the one surface here that can act without a user
  // present"). `boss.schedule()`'s `schedule` table is keyed by queue name
  // (one row per queue, upserted on every call), so this call is itself
  // idempotent across restarts/redeploys. When the flag is OFF this
  // `unschedule`s instead of skipping outright — a flag that was
  // ON in a prior deploy and is later turned OFF must not leave a stale
  // cron row still firing forever; `unschedule` on a name with no existing
  // row is a harmless no-op.
  if (phase25FeatureEnabled("monitoring")) {
    await boss.schedule(RUN_MONITOR_CRON_NAME, RUN_MONITOR_CRON_SCHEDULE, RUN_MONITOR_CRON_PAYLOAD, { tz: "UTC" });
    console.log(`[worker] run_monitor cron scheduled: "${RUN_MONITOR_CRON_SCHEDULE}" UTC on queue "${RUN_MONITOR_CRON_NAME}"`);
  } else {
    await boss.unschedule(RUN_MONITOR_CRON_NAME).catch((err) => reportError(err, { scope: "worker.unscheduleRunMonitorCron" }));
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
