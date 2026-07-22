import {
  cancelExtractJob,
  cancelQueuedJobsForDocuments,
  cancelStaleActiveExtractJobs,
  db,
  findPendingExtractJobs,
  getQueue,
  planReprocess,
  QUEUE_EXTRACT_TEXT,
} from "@ice/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Phase 20.5 stale-job recovery, against REAL pg-boss queue rows in local
 * Postgres — this is the "worker restart during job" scenario as code: a
 * crashed worker leaves its job `active`, previously unrecoverable until the
 * 60-minute expiration window elapsed and then retried into a duplicate run
 * (docs/PROJECT-LOG.md Known Problems).
 *
 * Every job here is sent with `startAfter` an hour in the future so a live
 * local dev worker sharing this database can never fetch one mid-test; the
 * `active` state is then set directly, exactly what a dead worker leaves
 * behind (pg-boss only fetches `created`/`retry` rows, so a live worker
 * ignores these too).
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const docIds: string[] = [];
const newDocId = () => {
  const id = crypto.randomUUID();
  docIds.push(id);
  return id;
};

async function sendParkedExtractJob(documentId: string): Promise<string> {
  const boss = await getQueue();
  const jobId = await boss.send(QUEUE_EXTRACT_TEXT, { documentId }, { startAfter: 3600, expireInMinutes: 60 });
  if (!jobId) throw new Error("pg-boss did not return a job id");
  return jobId;
}

async function markActive(jobId: string, startedMinutesAgo: number): Promise<void> {
  await db.execute(sql`
    update pgboss.job
    set state = 'active', started_on = now() - make_interval(mins => ${startedMinutesAgo})
    where id = ${jobId} and name = ${QUEUE_EXTRACT_TEXT}
  `);
}

describe.skipIf(!hasDb)("stale extract-job recovery (integration)", () => {
  afterAll(async () => {
    await cancelQueuedJobsForDocuments(docIds);
    const boss = await getQueue();
    await boss.stop({ graceful: false, wait: true });
  });

  it("finds a queued job, and planReprocess reuses it (repeated click enqueues once)", async () => {
    const documentId = newDocId();
    const jobId = await sendParkedExtractJob(documentId);

    const pending = await findPendingExtractJobs(documentId);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: jobId, state: "created", startedOn: null });

    expect(planReprocess({ documentStatus: "ready", pendingJobs: pending, latestRun: null })).toEqual({ action: "reuse", jobId });
  });

  it("recovers a job left active by a dead worker: plan says recover, cancel removes exactly that row", async () => {
    const documentId = newDocId();
    const jobId = await sendParkedExtractJob(documentId);
    await markActive(jobId, 30);

    const pending = await findPendingExtractJobs(documentId);
    expect(pending).toHaveLength(1);
    expect(pending[0].state).toBe("active");
    expect(pending[0].startedOn).toBeInstanceOf(Date);

    const plan = planReprocess({ documentStatus: "processing", pendingJobs: pending, latestRun: null });
    expect(plan).toEqual({ action: "recover", staleJobId: jobId });

    expect(await cancelExtractJob(jobId)).toBe(true);
    expect(await findPendingExtractJobs(documentId)).toHaveLength(0);
    // Idempotent: cancelling an already-removed job is a no-op, not an error.
    expect(await cancelExtractJob(jobId)).toBe(false);
  });

  it("worker-boot sweep companion: deletes only stale ACTIVE rows, never fresh queued work", async () => {
    const staleDoc = newDocId();
    const freshActiveDoc = newDocId();
    const queuedDoc = newDocId();
    const staleJob = await sendParkedExtractJob(staleDoc);
    const freshActiveJob = await sendParkedExtractJob(freshActiveDoc);
    const queuedJob = await sendParkedExtractJob(queuedDoc);
    await markActive(staleJob, 120);
    await markActive(freshActiveJob, 1);

    const cutoff = new Date(Date.now() - 90 * 60_000);
    const removed = await cancelStaleActiveExtractJobs([staleDoc, freshActiveDoc, queuedDoc], cutoff);
    expect(removed).toBe(1);

    expect(await findPendingExtractJobs(staleDoc)).toHaveLength(0);
    expect((await findPendingExtractJobs(freshActiveDoc)).map((j) => j.id)).toEqual([freshActiveJob]);
    expect((await findPendingExtractJobs(queuedDoc)).map((j) => j.id)).toEqual([queuedJob]);
  });
});
