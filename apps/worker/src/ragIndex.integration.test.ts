import {
  db,
  documents,
  pages,
  processingRuns,
  ragChunks,
  ragConversations,
  ragMessageCitations,
  ragMessages,
  researchResourceContents,
  researchResources,
  textBlocks,
  users,
  works,
} from "@ice/db";
import { indexEligibleRagSources, retrieveOwnerRagChunks } from "@ice/rag";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

const hasDb = Boolean(process.env.DATABASE_URL);
const cleanup: string[] = [];

async function seedOwner(label: string) {
  const [user] = await db.insert(users).values({ email: `rag-${label}-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
  cleanup.push(user.id);
  const [work] = await db.insert(works).values({ userId: user.id, title: `${label} ethics`, authorName: "Aristotle" }).returning({ id: works.id });
  const [document] = await db.insert(documents).values({
    userId: user.id,
    workId: work.id,
    storagePath: `rag/${work.id}.txt`,
    originalFilename: `${label}.txt`,
    mimeType: "text/plain",
    fileSize: 120,
    extractedText: `${label} virtue is examined in the body passage.`,
    processingStatus: "ready",
  }).returning({ id: documents.id });
  const [run] = await db.insert(processingRuns).values({ documentId: document.id, version: 1, pipelineVersion: "v4", status: "complete", isPublished: true }).returning({ id: processingRuns.id });
  const [page] = await db.insert(pages).values({ runId: run.id, pageIndex: 4, text: `${label} virtue is examined in the body passage.` }).returning({ id: pages.id });
  const [body] = await db.insert(textBlocks).values({ pageId: page.id, blockOrder: 0, kind: "body", text: `${label} virtue is examined in the body passage, not in a provider instruction.` }).returning({ id: textBlocks.id });
  await db.insert(textBlocks).values({ pageId: page.id, blockOrder: 1, kind: "footnote", text: "This apparatus must never be indexed as reader body." });
  const [resource] = await db.insert(researchResources).values({
    runId: run.id,
    title: `${label} open source`,
    provider: "openalex",
    normalizedKey: `rag:${label}:${crypto.randomUUID()}`,
  }).returning({ id: researchResources.id });
  const [content] = await db.insert(researchResourceContents).values({
    resourceId: resource.id,
    status: "open_access_indexed",
    sourceUrl: `https://example.test/${label}`,
    license: "CC BY 4.0",
    licenseEvidence: { fixture: true },
    text: `${label} open access evidence about virtue and deliberation.`,
    contentHash: crypto.randomUUID(),
  }).returning({ id: researchResourceContents.id });
  return { userId: user.id, workId: work.id, documentId: document.id, runId: run.id, bodyId: body.id, contentId: content.id };
}

describe.skipIf(!hasDb)("Phase 18 RAG index (integration)", () => {
  afterEach(async () => {
    while (cleanup.length) await db.delete(users).where(eq(users.id, cleanup.pop()!));
  });

  it("indexes eligible body and explicitly licensed open-access chunks with real anchors only", async () => {
    const owner = await seedOwner("eligible");
    const result = await indexEligibleRagSources({ userId: owner.userId, workId: owner.workId, documentId: owner.documentId, processingRunId: owner.runId });
    expect(result.uploadedChunks).toBeGreaterThan(0);
    expect(result.openAccessChunks).toBeGreaterThan(0);
    const rows = await db.select().from(ragChunks).where(eq(ragChunks.userId, owner.userId));
    expect(rows.some((row) => row.textBlockId === owner.bodyId && row.sourceType === "uploaded")).toBe(true);
    expect(rows.some((row) => row.researchResourceContentId === owner.contentId && row.sourceType === "open_access" && row.license === "CC BY 4.0")).toBe(true);
    expect(rows.some((row) => row.content.includes("apparatus"))).toBe(false);
  });

  it("keeps lexical retrieval strictly owner-scoped", async () => {
    const owner = await seedOwner("owner");
    const other = await seedOwner("other");
    await indexEligibleRagSources({ userId: owner.userId, workId: owner.workId, documentId: owner.documentId, processingRunId: owner.runId });
    await indexEligibleRagSources({ userId: other.userId, workId: other.workId, documentId: other.documentId, processingRunId: other.runId });
    const rows = await retrieveOwnerRagChunks(owner.userId, "virtue deliberation");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.documentId === owner.documentId)).toBe(true);
    expect(rows.some((row) => row.content.includes("other"))).toBe(false);
  });

  it("propagates document deletion through chunks and answer-citation links", async () => {
    const owner = await seedOwner("delete");
    await indexEligibleRagSources({ userId: owner.userId, workId: owner.workId, documentId: owner.documentId, processingRunId: owner.runId });
    const [chunk] = await db.select().from(ragChunks).where(eq(ragChunks.documentId, owner.documentId)).limit(1);
    const [conversation] = await db.insert(ragConversations).values({ userId: owner.userId, contextWorkId: owner.workId }).returning({ id: ragConversations.id });
    const [message] = await db.insert(ragMessages).values({ conversationId: conversation.id, role: "assistant", content: "A cited answer." }).returning({ id: ragMessages.id });
    await db.insert(ragMessageCitations).values({ messageId: message.id, chunkId: chunk!.id, ordinal: 0 });
    await db.delete(documents).where(eq(documents.id, owner.documentId));
    expect(await db.select().from(ragChunks).where(eq(ragChunks.documentId, owner.documentId))).toEqual([]);
    expect(await db.select().from(ragMessageCitations).where(eq(ragMessageCitations.messageId, message.id))).toEqual([]);
    expect(await db.select().from(ragConversations).where(and(eq(ragConversations.id, conversation.id), eq(ragConversations.userId, owner.userId)))).toHaveLength(1);
  });
});
