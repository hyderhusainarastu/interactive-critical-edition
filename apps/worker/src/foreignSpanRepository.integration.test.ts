/**
 * Repository test for migration 0036's `foreign_span` table
 * (Workstream D completion). Runs against a real local Postgres — same
 * `describe.skipIf(!hasDb)` convention as `duplicateResourceKey.integration.test.ts`
 * — since it exercises Drizzle queries and the (documentId, textBlockId,
 * sourceText) / (runId, textBlockId, startOffset, endOffset) unique
 * constraints the migration adds.
 */
import { db, documents, foreignSpans, pages, processingRuns, textBlocks, users, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createForeignSpanRepository } from "./foreignSpanRepository";

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("createForeignSpanRepository", () => {
  const cleanupUserId = { value: "" };

  afterEach(async () => {
    if (cleanupUserId.value) await db.delete(users).where(eq(users.id, cleanupUserId.value));
    cleanupUserId.value = "";
  });

  async function seed() {
    const [user] = await db.insert(users).values({ email: `foreign-span-repo-${crypto.randomUUID()}@example.com` }).returning({ id: users.id });
    cleanupUserId.value = user!.id;
    const [work] = await db.insert(works).values({ userId: user!.id, title: "Brickhouse", authorName: "A Scholar" }).returning({ id: works.id });
    const [document] = await db.insert(documents).values({
      userId: user!.id,
      workId: work!.id,
      storagePath: `fixtures/${work!.id}/foreign-span.pdf`,
      originalFilename: "foreign-span.pdf",
      mimeType: "application/pdf",
      fileSize: 100,
      processingStatus: "ready",
    }).returning({ id: documents.id });
    const [run] = await db.insert(processingRuns).values({
      documentId: document!.id,
      version: 1,
      pipelineVersion: "v3",
      status: "running",
    }).returning({ id: processingRuns.id });
    const [page] = await db.insert(pages).values({ runId: run!.id, pageIndex: 0 }).returning({ id: pages.id });
    const [block] = await db.insert(textBlocks).values({
      pageId: page!.id,
      blockOrder: 0,
      kind: "body",
      text: "The concept ἀρετή appears throughout.",
    }).returning({ id: textBlocks.id });
    return { userId: user!.id, documentId: document!.id, runId: run!.id, blockId: block!.id };
  }

  it("findPending returns only this run's pending spans, ordered by (textBlockId, startOffset)", async () => {
    const { userId, documentId, runId, blockId } = await seed();
    await db.insert(foreignSpans).values([
      {
        userId,
        documentId,
        runId,
        textBlockId: blockId,
        sourceText: "second",
        originalText: "second",
        startOffset: 20,
        endOffset: 26,
        script: "greek",
        languageHint: "el",
        direction: "ltr",
        sourceProvenanceKind: "source_text",
        sourceProvenanceLabel: "extracted source text",
        sourceConfidence: 1,
        status: "pending",
      },
      {
        userId,
        documentId,
        runId,
        textBlockId: blockId,
        sourceText: "first",
        originalText: "first",
        startOffset: 5,
        endOffset: 10,
        script: "greek",
        languageHint: "el",
        direction: "ltr",
        sourceProvenanceKind: "source_text",
        sourceProvenanceLabel: "extracted source text",
        sourceConfidence: 1,
        status: "pending",
      },
      {
        userId,
        documentId,
        runId,
        textBlockId: blockId,
        sourceText: "already-resolved",
        originalText: "already-resolved",
        startOffset: 30,
        endOffset: 47,
        script: "greek",
        languageHint: "el",
        direction: "ltr",
        sourceProvenanceKind: "source_text",
        sourceProvenanceLabel: "extracted source text",
        sourceConfidence: 1,
        status: "resolved",
      },
    ]);

    const repo = createForeignSpanRepository({ runId, documentId });
    const pending = await repo.findPending(10);
    expect(pending.map((s) => s.originalText)).toEqual(["first", "second"]);
    expect(pending[0]!.documentId).toBe(documentId);
    expect(pending[0]!.runId).toBe(runId);
    expect(pending[0]!.transcriptionStatus).toBe("legitimate");
    expect(pending[0]!.sourceProvenance).toEqual({ kind: "source_text", label: "extracted source text", confidence: 1 });
  });

  it("findPending is scoped to the given run — a different run's pending spans never leak in", async () => {
    const { userId, documentId, runId, blockId } = await seed();
    const [otherRun] = await db.insert(processingRuns).values({
      documentId,
      version: 2,
      pipelineVersion: "v3",
      status: "running",
    }).returning({ id: processingRuns.id });
    await db.insert(foreignSpans).values({
      userId,
      documentId,
      runId: otherRun!.id,
      textBlockId: blockId,
      sourceText: "other-run",
      originalText: "other-run",
      startOffset: 0,
      endOffset: 9,
      script: "greek",
      languageHint: "el",
      direction: "ltr",
      sourceProvenanceKind: "source_text",
      sourceProvenanceLabel: "extracted source text",
      sourceConfidence: 1,
      status: "pending",
    });

    const repo = createForeignSpanRepository({ runId, documentId });
    expect(await repo.findPending(10)).toEqual([]);
  });

  it("saveResolved marks the row resolved with a cache key, and getCached finds it cross-run", async () => {
    const { userId, documentId, runId, blockId } = await seed();
    const [span] = await db.insert(foreignSpans).values({
      userId,
      documentId,
      runId,
      textBlockId: blockId,
      sourceText: "ἀρετή",
      originalText: "ἀρετή",
      startOffset: 12,
      endOffset: 17,
      script: "greek",
      languageHint: "el",
      direction: "ltr",
      sourceProvenanceKind: "source_text",
      sourceProvenanceLabel: "extracted source text",
      sourceConfidence: 1,
      status: "pending",
    }).returning({ id: foreignSpans.id, documentId: foreignSpans.documentId, runId: foreignSpans.runId, textBlockId: foreignSpans.textBlockId, originalText: foreignSpans.originalText, script: foreignSpans.script, languageHint: foreignSpans.languageHint, sourceProvenanceKind: foreignSpans.sourceProvenanceKind, sourceProvenanceLabel: foreignSpans.sourceProvenanceLabel, sourceConfidence: foreignSpans.sourceConfidence, transcriptionStatus: foreignSpans.transcriptionStatus });

    const repo = createForeignSpanRepository({ runId, documentId });
    const processingSpan = {
      id: span!.id,
      documentId: span!.documentId,
      runId: span!.runId,
      textBlockId: span!.textBlockId,
      originalText: span!.originalText,
      script: span!.script,
      languageHint: span!.languageHint,
      sourceProvenance: { kind: span!.sourceProvenanceKind, label: span!.sourceProvenanceLabel, confidence: span!.sourceConfidence },
      transcriptionStatus: span!.transcriptionStatus,
    };

    expect(await repo.getCached("cache-key-abc")).toBeNull();

    await repo.saveResolved({
      span: processingSpan,
      cacheKey: "cache-key-abc",
      result: {
        languageCode: "el",
        languageLabel: "Ancient Greek",
        transliteration: "arete",
        translation: "excellence",
        provider: "openai",
        model: "gpt-5.4-nano",
        promptVersion: "foreign-span-v1",
      },
      translationProvenance: "machine_translation",
    });

    const [row] = await db.select().from(foreignSpans).where(eq(foreignSpans.id, span!.id));
    expect(row).toMatchObject({
      status: "resolved",
      cacheKey: "cache-key-abc",
      languageCode: "el",
      languageLabel: "Ancient Greek",
      transliteration: "arete",
      translation: "excellence",
      translationProvenance: "machine_translation",
      provider: "openai",
      model: "gpt-5.4-nano",
      promptVersion: "foreign-span-v1",
    });

    // Cross-run reuse: a lookup from an unrelated repository instance (a
    // different run/document scope) still finds the cached translation.
    const otherRepo = createForeignSpanRepository({ runId: "00000000-0000-0000-0000-000000000000", documentId: "00000000-0000-0000-0000-000000000000" });
    const cached = await otherRepo.getCached("cache-key-abc");
    expect(cached).toEqual({
      languageCode: "el",
      languageLabel: "Ancient Greek",
      transliteration: "arete",
      translation: "excellence",
      provider: "openai",
      model: "gpt-5.4-nano",
      promptVersion: "foreign-span-v1",
    });
  });

  it("markDeferred sets status and reason without touching resolved fields", async () => {
    const { userId, documentId, runId, blockId } = await seed();
    const [span] = await db.insert(foreignSpans).values({
      userId,
      documentId,
      runId,
      textBlockId: blockId,
      sourceText: "ἀρετή",
      originalText: "ἀρετή",
      startOffset: 12,
      endOffset: 17,
      script: "greek",
      languageHint: "el",
      direction: "ltr",
      sourceProvenanceKind: "source_text",
      sourceProvenanceLabel: "extracted source text",
      sourceConfidence: 1,
      status: "pending",
    }).returning({ id: foreignSpans.id });

    const repo = createForeignSpanRepository({ runId, documentId });
    await repo.markDeferred(span!.id, "budget_exhausted");

    const [row] = await db.select().from(foreignSpans).where(eq(foreignSpans.id, span!.id));
    expect(row!.status).toBe("deferred");
    expect(row!.deferredReason).toBe("budget_exhausted");
    expect(row!.translation).toBeNull();
  });

  it("logUsage writes an ai_usage_log row and increments processing_run.ai_cost_usd", async () => {
    const { documentId, runId } = await seed();
    const repo = createForeignSpanRepository({ runId, documentId });

    await repo.logUsage({
      documentId,
      runId,
      task: "foreign_span_translation",
      stage: "foreign-text",
      provider: "openai",
      model: "gpt-5.4-nano",
      promptTokens: 120,
      completionTokens: 40,
      estimatedCostUsd: 0.0021,
    });
    await repo.logUsage({
      documentId,
      runId,
      task: "foreign_span_translation",
      stage: "foreign-text",
      provider: "openai",
      model: "gpt-5.4-nano",
      promptTokens: 30,
      completionTokens: 10,
      estimatedCostUsd: 0.0005,
    });

    const [run] = await db.select({ aiCostUsd: processingRuns.aiCostUsd }).from(processingRuns).where(eq(processingRuns.id, runId));
    expect(run!.aiCostUsd).toBeCloseTo(0.0026, 6);
  });
});
