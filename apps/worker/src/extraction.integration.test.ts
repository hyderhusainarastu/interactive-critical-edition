import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 20.5: reprocess reliability through the REAL extract-text handler
 * (`handleEditionExtraction`), integration-tested against local Postgres with
 * every external boundary mocked — Storage download, research discovery, and
 * the AI clients — so these are deterministic, free, and network-independent:
 *  - a successful reprocess atomically publishes the new run (exactly one
 *    published, no mixing of run versions);
 *  - a Storage read failure is contained: the last good published edition
 *    stays served and the failure reason is user-visible;
 *  - a research/provider crash mid-run is contained the same way;
 *  - the failed attempt's derived rows stay attached to the failed run only
 *    (cleanup = isolation: nothing from a failed run leaks into the reader,
 *    which reads only the published run).
 */

vi.hoisted(() => {
  process.env.ANALYSIS_PIPELINE = "v2";
  process.env.PHASE_18_RAG_ENABLED = "false";
  process.env.PHASE_12_PIPELINE_V4_ENABLED = "false";
  delete process.env.CLAMAV_SCAN_URL;
});

const ingestionMock = vi.hoisted(() => ({
  downloadDocumentFile: vi.fn(),
}));
vi.mock("@ice/ingestion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ice/ingestion")>()),
  downloadDocumentFile: ingestionMock.downloadDocumentFile,
}));

const researchMock = vi.hoisted(() => ({
  generateLaneQueries: vi.fn(),
  runDiscovery: vi.fn(),
  assessCandidate: vi.fn(),
}));
vi.mock("@ice/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@ice/research")>()),
  allAdapters: () => [],
  generateLaneQueries: researchMock.generateLaneQueries,
  runDiscovery: researchMock.runDiscovery,
  assessCandidate: researchMock.assessCandidate,
}));
vi.mock("@ice/ai-adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@ice/ai-adapters")>();
  return {
    ...actual,
    // Guarantees these tests cannot make an AI call even if a developer has
    // credentials in the local environment.
    OpenAIResponsesClient: class { available = false; },
    classifyRelationship: vi.fn(async () => ({
      category: "interpretive_aid",
      explanation: "Deterministic reprocess fixture.",
      confidence: 0.8,
      provider: "heuristic",
      model: "heuristic-fixture",
      promptTokens: 0,
      completionTokens: 0,
      heuristic: true,
    })),
  };
});

import { db, documents, pages, processingRuns, users, works } from "@ice/db";
import { and, eq, inArray } from "drizzle-orm";
import { handleEditionExtraction } from "./extraction";

const hasDb = Boolean(process.env.DATABASE_URL);

const FRESH_BODY =
  "Fresh reprocessed body text for the Phase 20.5 fixture. It is deliberately long enough to be treated as a real paragraph of prose and it names no other scholarly source anywhere.";

const cleanup = { userIds: [] as string[], identityIds: [] as string[] };

async function seedReadyDocWithPublishedRun() {
  const fixtureTag = crypto.randomUUID();
  const [user] = await db.insert(users).values({ email: `extraction-20-5-${fixtureTag}@example.com` }).returning({ id: users.id });
  cleanup.userIds.push(user.id);
  // Unique title per seed: a shared title would derive a shared
  // work_identity row across concurrently running test files, and this
  // file's cleanup would delete it out from under them.
  const [work] = await db.insert(works).values({ userId: user.id, title: `Reprocess Fixture Work ${fixtureTag}`, authorName: "Fixture Author" }).returning({ id: works.id });
  const [document] = await db.insert(documents).values({
    userId: user.id,
    workId: work.id,
    storagePath: `fixtures/${work.id}/reprocess.txt`,
    originalFilename: "reprocess.txt",
    mimeType: "text/plain",
    fileSize: 100,
    processingStatus: "ready",
    extractedText: "The old, previously published body text.",
  }).returning({ id: documents.id });
  const [publishedRun] = await db.insert(processingRuns).values({
    documentId: document.id,
    version: 1,
    pipelineVersion: "v2",
    status: "complete",
    stage: "published",
    structureState: "limited",
    isPublished: true,
  }).returning({ id: processingRuns.id });
  return { userId: user.id, workId: work.id, documentId: document.id, publishedRunId: publishedRun.id };
}

function mockHealthyResearch() {
  researchMock.generateLaneQueries.mockResolvedValue({ lanes: [], usedModel: false, promptTokens: 0, completionTokens: 0 });
  researchMock.runDiscovery.mockResolvedValue({ resources: [], attempts: [], laneByKey: new Map(), rounds: 1, saturationNote: null });
  researchMock.assessCandidate.mockImplementation(() => {
    throw new Error("assessCandidate should not be reached with zero discovered resources");
  });
}

describe.skipIf(!hasDb)("edition reprocess reliability (integration)", () => {
  afterEach(async () => {
    ingestionMock.downloadDocumentFile.mockReset();
    researchMock.generateLaneQueries.mockReset();
    researchMock.runDiscovery.mockReset();
    researchMock.assessCandidate.mockReset();
    while (cleanup.userIds.length) await db.delete(users).where(eq(users.id, cleanup.userIds.pop()!));
    if (cleanup.identityIds.length) {
      const { workIdentities } = await import("@ice/db");
      await db.delete(workIdentities).where(inArray(workIdentities.id, cleanup.identityIds));
      cleanup.identityIds = [];
    }
  });

  async function collectIdentity(workId: string) {
    const [workRow] = await db.select({ workIdentityId: works.workIdentityId }).from(works).where(eq(works.id, workId));
    if (workRow?.workIdentityId) cleanup.identityIds.push(workRow.workIdentityId);
  }

  it("a successful reprocess atomically publishes the new run: exactly one published, previous run demoted intact, document stays ready", async () => {
    const seeded = await seedReadyDocWithPublishedRun();
    ingestionMock.downloadDocumentFile.mockResolvedValue(Buffer.from(FRESH_BODY, "utf8"));
    mockHealthyResearch();

    await handleEditionExtraction(seeded.documentId);
    await collectIdentity(seeded.workId);

    const runs = await db
      .select({ id: processingRuns.id, version: processingRuns.version, status: processingRuns.status, isPublished: processingRuns.isPublished })
      .from(processingRuns)
      .where(eq(processingRuns.documentId, seeded.documentId));
    expect(runs).toHaveLength(2);
    const published = runs.filter((run) => run.isPublished);
    expect(published).toHaveLength(1);
    expect(published[0].version).toBe(2);
    expect(published[0].status).toBe("complete");
    const previous = runs.find((run) => run.id === seeded.publishedRunId)!;
    expect(previous.isPublished).toBe(false);
    expect(previous.status).toBe("complete"); // demoted, not damaged

    // No mixing of run versions: every extraction page belongs to the new run.
    const pageRows = await db.select({ runId: pages.runId }).from(pages)
      .where(inArray(pages.runId, runs.map((run) => run.id)));
    expect(pageRows.length).toBeGreaterThan(0);
    expect(pageRows.every((page) => page.runId === published[0].id)).toBe(true);

    const [doc] = await db
      .select({ status: documents.processingStatus, error: documents.processingError, text: documents.extractedText })
      .from(documents)
      .where(eq(documents.id, seeded.documentId));
    // A reprocess of an already-confirmed work must not send it back through
    // metadata review (autoReady via prior "ready" status).
    expect(doc.status).toBe("ready");
    expect(doc.error).toBeNull();
    expect(doc.text).toContain("Fresh reprocessed body text");
  });

  it("a Storage read failure fails ONLY the new run: last good edition stays published and the reason is user-visible", async () => {
    const seeded = await seedReadyDocWithPublishedRun();
    ingestionMock.downloadDocumentFile.mockRejectedValue(new Error("Storage download failed: object not found"));
    mockHealthyResearch();

    await expect(handleEditionExtraction(seeded.documentId)).rejects.toThrow("Storage download failed");

    const runs = await db
      .select({ id: processingRuns.id, version: processingRuns.version, status: processingRuns.status, isPublished: processingRuns.isPublished, error: processingRuns.error })
      .from(processingRuns)
      .where(eq(processingRuns.documentId, seeded.documentId));
    const published = runs.filter((run) => run.isPublished);
    expect(published).toHaveLength(1);
    expect(published[0].id).toBe(seeded.publishedRunId); // last known-good still served
    const failed = runs.find((run) => run.version === 2)!;
    expect(failed.status).toBe("failed");
    expect(failed.isPublished).toBe(false);
    expect(failed.error).toContain("Storage download failed");

    const [doc] = await db
      .select({ status: documents.processingStatus, error: documents.processingError, text: documents.extractedText })
      .from(documents)
      .where(eq(documents.id, seeded.documentId));
    expect(doc.status).toBe("failed");
    expect(doc.error).toContain("Storage download failed"); // visible failure reason
    expect(doc.text).toBe("The old, previously published body text."); // reader content untouched
  });

  it("a research/provider crash mid-run is contained: new run failed with the reason, last good edition retained, no derived rows leak to the published run", async () => {
    const seeded = await seedReadyDocWithPublishedRun();
    ingestionMock.downloadDocumentFile.mockResolvedValue(Buffer.from(FRESH_BODY, "utf8"));
    researchMock.generateLaneQueries.mockResolvedValue({ lanes: [], usedModel: false, promptTokens: 0, completionTokens: 0 });
    researchMock.runDiscovery.mockRejectedValue(new Error("Provider outage: discovery crashed with HTTP 503"));

    await expect(handleEditionExtraction(seeded.documentId)).rejects.toThrow("Provider outage");
    await collectIdentity(seeded.workId);

    const runs = await db
      .select({ id: processingRuns.id, version: processingRuns.version, status: processingRuns.status, isPublished: processingRuns.isPublished, error: processingRuns.error })
      .from(processingRuns)
      .where(eq(processingRuns.documentId, seeded.documentId));
    const published = runs.filter((run) => run.isPublished);
    expect(published).toHaveLength(1);
    expect(published[0].id).toBe(seeded.publishedRunId);
    const failed = runs.find((run) => run.version === 2)!;
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("Provider outage");

    // The failed attempt's extraction rows exist but are attached to the
    // FAILED run only — the reader serves the published run, so failed
    // derived state is isolated rather than mixed into what users see.
    const failedPages = await db.select({ id: pages.id }).from(pages).where(eq(pages.runId, failed.id));
    expect(failedPages.length).toBeGreaterThan(0);
    const publishedPages = await db.select({ id: pages.id }).from(pages).where(eq(pages.runId, seeded.publishedRunId));
    expect(publishedPages).toHaveLength(0);

    const [doc] = await db.select({ status: documents.processingStatus, error: documents.processingError }).from(documents).where(eq(documents.id, seeded.documentId));
    expect(doc.status).toBe("failed");
    expect(doc.error).toContain("Provider outage");
  });

  it("retrying after a failure succeeds from the retained original source (restart-from-source semantics)", async () => {
    const seeded = await seedReadyDocWithPublishedRun();
    // First attempt: Storage read fails. Second attempt: the same immutable
    // object downloads fine — nothing about the failure damaged the source.
    ingestionMock.downloadDocumentFile
      .mockRejectedValueOnce(new Error("Storage download failed: transient"))
      .mockResolvedValue(Buffer.from(FRESH_BODY, "utf8"));
    mockHealthyResearch();

    await expect(handleEditionExtraction(seeded.documentId)).rejects.toThrow("transient");
    await handleEditionExtraction(seeded.documentId);
    await collectIdentity(seeded.workId);

    const runs = await db
      .select({ version: processingRuns.version, status: processingRuns.status, isPublished: processingRuns.isPublished })
      .from(processingRuns)
      .where(and(eq(processingRuns.documentId, seeded.documentId), eq(processingRuns.isPublished, true)));
    expect(runs).toHaveLength(1);
    expect(runs[0].version).toBe(3); // v1 published seed, v2 failed, v3 published
    expect(runs[0].status).toBe("complete");
    const [doc] = await db.select({ status: documents.processingStatus, error: documents.processingError }).from(documents).where(eq(documents.id, seeded.documentId));
    expect(doc.status).toBe("ready");
    expect(doc.error).toBeNull();
  });
});
