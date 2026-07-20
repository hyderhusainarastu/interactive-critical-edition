import { db, documents, pages, passageAnnotations, processingRuns, textBlocks, users, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Integration tests proving the exact insert shape `analyze.ts` uses for
 * `passage_annotation` round-trips through Drizzle against real Postgres —
 * the DB check constraints were verified with raw SQL during 9.3's build,
 * but the ORM's enum/null handling on this specific table was not yet
 * exercised. Skipped when DATABASE_URL is unset, same as runLifecycle.test.ts.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

async function seedRunWithBlock() {
  const [user] = await db.insert(users).values({ email: `pa-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  const [work] = await db.insert(works).values({ userId: user.id, title: "Ethics", authorName: "Aristotle" }).returning({ id: works.id });
  const [document] = await db
    .insert(documents)
    .values({ workId: work.id, userId: user.id, fileSize: 1, storagePath: "pa/t.txt", originalFilename: "t.txt", mimeType: "text/plain", extractedText: "x" })
    .returning({ id: documents.id });
  const [run] = await db.insert(processingRuns).values({ documentId: document.id, version: 1, pipelineVersion: "v3" }).returning({ id: processingRuns.id });
  const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 0 }).returning({ id: pages.id });
  const [block] = await db
    .insert(textBlocks)
    .values({ pageId: page.id, blockOrder: 0, kind: "body", text: "Akrasia is weakness of will." })
    .returning({ id: textBlocks.id });
  return { userId: user.id, runId: run.id, blockId: block.id };
}

describe.skipIf(!hasDb)("passage_annotation (integration)", () => {
  const cleanup: string[] = [];
  afterEach(async () => {
    while (cleanup.length) await db.delete(users).where(eq(users.id, cleanup.pop()!));
  });

  it("persists an anchored annotation with the exact shape analyze.ts inserts", async () => {
    const { userId, runId, blockId } = await seedRunWithBlock();
    cleanup.push(userId);

    await db.insert(passageAnnotations).values({
      runId,
      textBlockId: blockId,
      isWholeWork: false,
      quote: "weakness of will",
      summary: "Defines akrasia.",
      explanation: "Akrasia names acting against one's own better judgment.",
      annotationType: "definition",
      relationship: "interpretive_aid",
      readerLevel: "beginner",
      confidence: 0.8,
    });

    const [row] = await db.select().from(passageAnnotations).where(eq(passageAnnotations.runId, runId));
    expect(row).toMatchObject({
      textBlockId: blockId,
      isWholeWork: false,
      annotationType: "definition",
      relationship: "interpretive_aid",
      readerLevel: "beginner",
    });
  });

  it("persists a whole-work annotation with a null block and null reader level", async () => {
    const { userId, runId } = await seedRunWithBlock();
    cleanup.push(userId);

    await db.insert(passageAnnotations).values({
      runId,
      textBlockId: null,
      isWholeWork: true,
      quote: null,
      summary: "Whole-work guidance.",
      explanation: "The work as a whole argues against akrasia being impossible.",
      annotationType: "context",
      relationship: "interpretive_aid",
      readerLevel: null,
      confidence: 0.6,
    });

    const [row] = await db.select().from(passageAnnotations).where(eq(passageAnnotations.runId, runId));
    expect(row).toMatchObject({ textBlockId: null, isWholeWork: true, quote: null, readerLevel: null });
  });

  it("rejects an anchored row with no quote at the DB level, even via the ORM", async () => {
    const { userId, runId, blockId } = await seedRunWithBlock();
    cleanup.push(userId);

    await expect(
      db.insert(passageAnnotations).values({
        runId,
        textBlockId: blockId,
        isWholeWork: false,
        quote: null,
        summary: "x",
        explanation: "x",
        annotationType: "context",
        relationship: "interpretive_aid",
        confidence: 0.5,
      }),
    ).rejects.toThrow();
  });

  it("cascades on run deletion, same as pages/text_blocks", async () => {
    const { userId, runId, blockId } = await seedRunWithBlock();
    cleanup.push(userId);
    await db.insert(passageAnnotations).values({
      runId,
      textBlockId: blockId,
      isWholeWork: false,
      quote: "weakness of will",
      summary: "x",
      explanation: "x",
      annotationType: "context",
      relationship: "interpretive_aid",
      confidence: 0.5,
    });
    await db.delete(processingRuns).where(eq(processingRuns.id, runId));
    const remaining = await db.select().from(passageAnnotations).where(eq(passageAnnotations.runId, runId));
    expect(remaining).toHaveLength(0);
  });
});
