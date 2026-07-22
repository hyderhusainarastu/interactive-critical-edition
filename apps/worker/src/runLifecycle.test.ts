import { db, documents, processingJobs, processingRuns, users, works } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { allocateEditionRun, publishEditionRun, sweepAbandonedRuns } from "./runLifecycle";

/**
 * Integration tests for the run-lifecycle guarantees (plan §33 §1.3), run
 * against local Postgres. Skipped when DATABASE_URL is unset so they don't
 * break a CI job that hasn't provisioned the worker DB. They spend no API
 * credits — pure DB behavior.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

async function seedDoc() {
  const [user] = await db.insert(users).values({ email: `rl-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  const [work] = await db.insert(works).values({ userId: user.id, title: "Ethics", authorName: "Aristotle" }).returning({ id: works.id });
  const [document] = await db
    .insert(documents)
    .values({ workId: work.id, userId: user.id, fileSize: 1, storagePath: "rl/t.txt", originalFilename: "t.txt", mimeType: "text/plain", extractedText: "x" })
    .returning({ id: documents.id });
  return { userId: user.id, workId: work.id, documentId: document.id };
}

const publishParams = (runId: string, documentId: string, workId: string) => ({
  runId,
  documentId,
  workId,
  structureState: "limited" as const,
  note: null,
  extractedText: "body",
  detectedTitle: null,
  detectedAuthor: null,
  autoReady: false,
});

describe.skipIf(!hasDb)("run lifecycle (integration)", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    while (cleanup.length) await db.delete(users).where(eq(users.id, cleanup.pop()!));
  });

  it("allocates monotonic versions sequentially", async () => {
    const { userId, documentId } = await seedDoc();
    cleanup.push(userId);
    const a = await allocateEditionRun(documentId);
    const b = await allocateEditionRun(documentId);
    const c = await allocateEditionRun(documentId);
    expect([a.version, b.version, c.version]).toEqual([1, 2, 3]);
  });

  it("records v3 at allocation with its first ordered stage", async () => {
    const { userId, documentId } = await seedDoc();
    cleanup.push(userId);
    const run = await allocateEditionRun(documentId, "v3");
    const [stored] = await db
      .select({ pipelineVersion: processingRuns.pipelineVersion, stage: processingRuns.stage })
      .from(processingRuns)
      .where(eq(processingRuns.id, run.id));
    expect(stored).toEqual({ pipelineVersion: "v3", stage: "canonical-identity" });
  });

  it("allocates distinct versions under concurrency (advisory lock)", async () => {
    const { userId, documentId } = await seedDoc();
    cleanup.push(userId);
    // Five concurrent allocations must not collide on the version-unique index.
    const runs = await Promise.all(Array.from({ length: 5 }, () => allocateEditionRun(documentId)));
    const versions = runs.map((r) => r.version).sort((x, y) => x - y);
    expect(versions).toEqual([1, 2, 3, 4, 5]);
  });

  it("atomically switches the published run (exactly one published)", async () => {
    const { userId, documentId, workId } = await seedDoc();
    cleanup.push(userId);
    const v1 = await allocateEditionRun(documentId);
    await publishEditionRun(publishParams(v1.id, documentId, workId));
    const v2 = await allocateEditionRun(documentId);
    await publishEditionRun(publishParams(v2.id, documentId, workId));

    const published = await db.select({ id: processingRuns.id }).from(processingRuns).where(and(eq(processingRuns.documentId, documentId), eq(processingRuns.isPublished, true)));
    expect(published).toHaveLength(1);
    expect(published[0].id).toBe(v2.id);
  });

  it("leaves the prior published edition intact when a reprocess fails", async () => {
    const { userId, documentId, workId } = await seedDoc();
    cleanup.push(userId);
    const v1 = await allocateEditionRun(documentId);
    await publishEditionRun(publishParams(v1.id, documentId, workId));
    // A failed reprocess allocates v2 but never publishes it.
    const v2 = await allocateEditionRun(documentId);
    await db.update(processingRuns).set({ status: "failed", stage: "failed" }).where(eq(processingRuns.id, v2.id));

    const [published] = await db.select().from(processingRuns).where(and(eq(processingRuns.documentId, documentId), eq(processingRuns.isPublished, true)));
    expect(published.id).toBe(v1.id); // the last good edition is still served
    const [failed] = await db.select({ status: processingRuns.status, isPublished: processingRuns.isPublished }).from(processingRuns).where(eq(processingRuns.id, v2.id));
    expect(failed.isPublished).toBe(false);
    expect(failed.status).toBe("failed");
  });

  it("enforces at most one published run per document at the DB level", async () => {
    const { userId, documentId } = await seedDoc();
    cleanup.push(userId);
    await db.insert(processingRuns).values({ documentId, version: 1, pipelineVersion: "v2", status: "complete", isPublished: true });
    // A direct second published insert must be rejected by the partial unique index.
    await expect(
      db.insert(processingRuns).values({ documentId, version: 2, pipelineVersion: "v2", status: "complete", isPublished: true }),
    ).rejects.toThrow();
  });

  /**
   * Phase 20.5: the abandoned-run sweep must fail the stuck DOCUMENT (visible
   * failure reason + retry affordance), not just the run — before this, a doc
   * whose worker died mid-run stayed "processing" forever with an endlessly
   * polling UI (D-20-51). It must also leave live work strictly alone.
   */
  it("sweepAbandonedRuns fails stale runs AND their documents/bookkeeping, and leaves fresh runs untouched", async () => {
    const staleSeed = await seedDoc();
    const freshSeed = await seedDoc();
    cleanup.push(staleSeed.userId, freshSeed.userId);
    const old = new Date(Date.now() - 120 * 60_000);

    await db.update(documents).set({ processingStatus: "processing" }).where(eq(documents.id, staleSeed.documentId));
    const [staleRun] = await db.insert(processingRuns)
      .values({ documentId: staleSeed.documentId, version: 1, pipelineVersion: "v2", status: "running", stage: "research-discovery", startedAt: old, updatedAt: old })
      .returning({ id: processingRuns.id });
    const [staleJob] = await db.insert(processingJobs)
      .values({ documentId: staleSeed.documentId, jobType: "edition-reprocess", status: "running", createdAt: old, updatedAt: old })
      .returning({ id: processingJobs.id });

    await db.update(documents).set({ processingStatus: "processing" }).where(eq(documents.id, freshSeed.documentId));
    const [freshRun] = await db.insert(processingRuns)
      .values({ documentId: freshSeed.documentId, version: 1, pipelineVersion: "v2", status: "running", stage: "extracting" })
      .returning({ id: processingRuns.id });

    const swept = await sweepAbandonedRuns(90);
    expect(swept.runIds).toContain(staleRun.id);
    expect(swept.runIds).not.toContain(freshRun.id);

    const [sweptRun] = await db.select({ status: processingRuns.status, error: processingRuns.error }).from(processingRuns).where(eq(processingRuns.id, staleRun.id));
    expect(sweptRun.status).toBe("failed");
    expect(sweptRun.error).toContain("Abandoned mid-run");
    const [sweptDoc] = await db.select({ status: documents.processingStatus, error: documents.processingError }).from(documents).where(eq(documents.id, staleSeed.documentId));
    expect(sweptDoc.status).toBe("failed"); // visible failure + retry, not endless "processing"
    expect(sweptDoc.error).toContain("Abandoned mid-run");
    const [sweptJob] = await db.select({ status: processingJobs.status }).from(processingJobs).where(eq(processingJobs.id, staleJob.id));
    expect(sweptJob.status).toBe("failed");

    const [liveRun] = await db.select({ status: processingRuns.status }).from(processingRuns).where(eq(processingRuns.id, freshRun.id));
    expect(liveRun.status).toBe("running");
    const [liveDoc] = await db.select({ status: documents.processingStatus }).from(documents).where(eq(documents.id, freshSeed.documentId));
    expect(liveDoc.status).toBe("processing");
  });

  it("sweepAbandonedRuns never touches a published run, and spares fresh bookkeeping rows for a swept document", async () => {
    const seed = await seedDoc();
    cleanup.push(seed.userId);
    const old = new Date(Date.now() - 120 * 60_000);

    // A published run with an old timestamp must never be swept.
    const v1 = await allocateEditionRun(seed.documentId);
    await publishEditionRun(publishParams(v1.id, seed.documentId, seed.workId));
    await db.update(processingRuns).set({ updatedAt: old }).where(eq(processingRuns.id, v1.id));
    // An abandoned second attempt...
    const [v2] = await db.insert(processingRuns)
      .values({ documentId: seed.documentId, version: 2, pipelineVersion: "v2", status: "running", startedAt: old, updatedAt: old })
      .returning({ id: processingRuns.id });
    await db.update(documents).set({ processingStatus: "processing" }).where(eq(documents.id, seed.documentId));
    // ...and a FRESH pending bookkeeping row, as left by a retry click moments ago.
    const [freshJob] = await db.insert(processingJobs)
      .values({ documentId: seed.documentId, jobType: "edition-reprocess", status: "pending" })
      .returning({ id: processingJobs.id });

    await sweepAbandonedRuns(90);

    const [publishedRun] = await db.select({ status: processingRuns.status, isPublished: processingRuns.isPublished }).from(processingRuns).where(eq(processingRuns.id, v1.id));
    expect(publishedRun).toEqual({ status: "complete", isPublished: true }); // last good edition untouched
    const [abandoned] = await db.select({ status: processingRuns.status }).from(processingRuns).where(eq(processingRuns.id, v2.id));
    expect(abandoned.status).toBe("failed");
    const [retryJob] = await db.select({ status: processingJobs.status }).from(processingJobs).where(eq(processingJobs.id, freshJob.id));
    expect(retryJob.status).toBe("pending"); // the fresh retry survives the sweep
  });
});
