import { db, documents, processingRuns, users, works } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { allocateEditionRun, publishEditionRun } from "./runLifecycle";

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
});
