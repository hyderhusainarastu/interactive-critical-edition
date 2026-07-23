import { isEditionPipeline } from "@ice/config";
import {
  cancelExtractJob,
  db,
  enqueueExtractText,
  findPendingExtractJobs,
  planReprocess,
  processingJobs,
  processingRuns,
} from "@ice/db";
import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { enforceUserRateLimit } from "@/lib/apiRateLimit";
import { rateLimitResponse } from "@/lib/apiResponse";
import { getOwnedDocument } from "@/lib/works";

/**
 * The single idempotent reprocess command (plan §20.5). Starts a fresh,
 * isolated edition run; the previous published run stays intact and served
 * until the worker atomically publishes the replacement (`publishEditionRun`),
 * and a failed run never touches it. Retrying always restarts from the
 * immutable original upload in Storage — runs have no mid-flight checkpoints,
 * so "restart from source" is the one honest recovery semantic, and run
 * isolation + atomic publication is what makes it always safe.
 *
 * Idempotency/duplicate protection: `planReprocess` (pure, unit-tested)
 * decides from the real queue + run state whether to reuse an already-queued
 * attempt, recover a stale `active` job orphaned by a dead worker (delete it
 * so pg-boss can't later retry it into a duplicate run, then enqueue fresh),
 * enqueue, or refuse because a live attempt is genuinely running.
 *
 * Cost: the run the worker starts from this enqueue passes through the same
 * budget machinery as a first upload (`makeBudget()` + canAfford/overSoftCap
 * gates in analyzeEditionRun) — no paid call starts beyond the hard cap.
 *
 * Returns 202 with the projected version; the worker authoritatively
 * allocates the run version under a per-document advisory lock, so this is a
 * best-effort preview (surface the real run/version via the status endpoint).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ workId: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Each fresh run passes through the paid budget machinery. `planReprocess`
  // dedups a CONCURRENT duplicate, but a sequential loop (re-trigger once the
  // prior run finishes) would still start unbounded paid runs — this per-user
  // cap is the cost backstop, matching the graph-expansion route's posture.
  const rate = await enforceUserRateLimit({ userId, scope: "reprocess-work", limit: 20, windowMs: 60 * 60_000 });
  if (!rate.allowed) return rateLimitResponse(rate);
  // Any edition-producing pipeline (v2+) can reprocess; v1 annotates in place
  // and has no edition to replace. NOTE: this reads the WEB tier's
  // ANALYSIS_PIPELINE — an ownership-independent 409 when the env var is
  // missing (bit for real as D-19-29's root cause; local + production both
  // set it now, and CI's E2E step sets it explicitly).
  if (!isEditionPipeline()) {
    return NextResponse.json({ error: "Edition reprocessing is not enabled on this deployment." }, { status: 409 });
  }
  const { workId } = await params;
  const document = await getOwnedDocument(workId, userId);
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pendingJobs = await findPendingExtractJobs(document.documentId);
  const [latestRun] = await db
    .select({ status: processingRuns.status, updatedAt: processingRuns.updatedAt })
    .from(processingRuns)
    .where(eq(processingRuns.documentId, document.documentId))
    .orderBy(desc(processingRuns.version))
    .limit(1);

  const plan = planReprocess({
    documentStatus: document.processingStatus,
    pendingJobs,
    latestRun: latestRun ?? null,
  });

  if (plan.action === "conflict") {
    return NextResponse.json({ error: plan.reason }, { status: 409 });
  }
  if (plan.action === "reuse") {
    // Repeated click: the attempt is already queued — hand back the same job
    // rather than enqueueing a duplicate (and a duplicate paid run).
    return NextResponse.json({ status: "already_queued", jobId: plan.jobId, deduplicated: true }, { status: 202 });
  }

  if (plan.action === "recover") {
    // Stale-active-job recovery, previously a manual runbook (docs/runbooks):
    // remove the orphaned row so pg-boss cannot later expire-and-retry it
    // into a duplicate run, and close out its superseded bookkeeping.
    await cancelExtractJob(plan.staleJobId);
    await db
      .update(processingJobs)
      .set({ status: "failed", error: "Superseded: the worker processing this attempt stopped responding, and a fresh attempt was started.", updatedAt: new Date() })
      .where(sql`${processingJobs.documentId} = ${document.documentId} and ${processingJobs.status} in ('pending', 'running')`);
    await db
      .update(processingRuns)
      .set({ status: "failed", stage: "failed", error: "Abandoned mid-run: the worker stopped responding. A fresh attempt was started from the original source file.", finishedAt: new Date(), updatedAt: new Date() })
      .where(sql`${processingRuns.documentId} = ${document.documentId} and ${processingRuns.status} in ('pending', 'running') and ${processingRuns.isPublished} = false`);
  }

  const [{ nextVersion }] = await db
    .select({ nextVersion: sql<number>`coalesce(max(${processingRuns.version}), 0) + 1` })
    .from(processingRuns)
    .where(eq(processingRuns.documentId, document.documentId));
  const jobId = await enqueueExtractText(document.documentId);
  await db.insert(processingJobs).values({ documentId: document.documentId, jobType: "edition-reprocess", status: "pending", pgBossJobId: jobId });
  return NextResponse.json(
    { status: "queued", projectedVersion: Number(nextVersion), jobId, ...(plan.action === "recover" ? { recovered: true } : {}) },
    { status: 202 },
  );
}
