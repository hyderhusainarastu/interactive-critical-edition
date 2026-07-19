import {
  type AnalyzeWorkJob,
  db,
  documents,
  docMetadata,
  enqueueAnalyzeWork,
  type ExtractTextJob,
  footnotes,
  getQueue,
  processingJobs,
  processingRuns,
  pages,
  QUEUE_ANALYZE_WORK,
  QUEUE_EXTRACT_TEXT,
  textBlocks,
  works,
} from "@ice/db";
import { detectFootnotes, downloadDocumentFile, parseDocument } from "@ice/ingestion";
import { reportError } from "@ice/observability";
import { desc, eq, sql } from "drizzle-orm";
import { analyzeWork } from "./analyze";

async function handleExtractText(documentId: string) {
  const [job] = await db
    .select({ id: processingJobs.id })
    .from(processingJobs)
    .where(eq(processingJobs.documentId, documentId))
    .orderBy(desc(processingJobs.createdAt))
    .limit(1);

  await db
    .update(documents)
    .set({ processingStatus: "processing", updatedAt: new Date() })
    .where(eq(documents.id, documentId));
  if (job) {
    await db
      .update(processingJobs)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(processingJobs.id, job.id));
  }

  try {
    const [doc] = await db
      .select({
        storagePath: documents.storagePath,
        mimeType: documents.mimeType,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    if (!doc) throw new Error(`Document ${documentId} not found`);

    const buffer = await downloadDocumentFile(doc.storagePath);
    const parsed = await parseDocument(buffer, doc.mimeType);

    if (!parsed.text.trim()) {
      throw new Error(
        "No extractable text found — the file may be a scanned/image-only PDF, which needs OCR (not yet supported).",
      );
    }

    await db
      .update(documents)
      .set({
        extractedText: parsed.text,
        extractedTitle: parsed.detectedTitle,
        extractedAuthor: parsed.detectedAuthor,
        processingStatus: "needs_review",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    // Heuristic, text/markdown only — see packages/ingestion/parsers/footnotes.ts
    if (doc.mimeType === "text/plain" || doc.mimeType === "text/markdown") {
      const detected = detectFootnotes(parsed.text);
      if (detected.length > 0) {
        await db.insert(footnotes).values(
          detected.map((f) => ({
            documentId,
            marker: f.marker,
            content: f.content,
          })),
        );
        console.log(`[worker] detected ${detected.length} footnote(s) for document ${documentId}`);
      }
    }

    if (job) {
      await db
        .update(processingJobs)
        .set({ status: "succeeded", updatedAt: new Date() })
        .where(eq(processingJobs.id, job.id));
    }
    console.log(`[worker] extracted text for document ${documentId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportError(err, { scope: "worker.extractText", documentId });

    await db
      .update(documents)
      .set({
        processingStatus: "failed",
        processingError: message,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    if (job) {
      await db
        .update(processingJobs)
        .set({
          status: "failed",
          error: message,
          attempts: sql`${processingJobs.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(processingJobs.id, job.id));
    }
  }
}

/**
 * Phase 8 v2: build an isolated run and publish it only after all durable
 * extraction records have been written. It intentionally does not delete
 * legacy annotations or a previous published run.
 */
async function handleEditionExtraction(documentId: string) {
  const [doc] = await db.select({
    storagePath: documents.storagePath,
    mimeType: documents.mimeType,
    originalFilename: documents.originalFilename,
    workId: documents.workId,
  }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const [{ nextVersion }] = await db.select({
    nextVersion: sql<number>`coalesce(max(${processingRuns.version}), 0) + 1`,
  }).from(processingRuns).where(eq(processingRuns.documentId, documentId));
  const [run] = await db.insert(processingRuns).values({
    documentId,
    version: nextVersion,
    pipelineVersion: "v2",
    status: "running",
    stage: "extracting",
    structureState: "limited",
    startedAt: new Date(),
  }).returning({ id: processingRuns.id });

  await db.update(documents).set({ processingStatus: "processing", processingError: null, updatedAt: new Date() }).where(eq(documents.id, documentId));
  try {
    const parsed = await parseDocument(await downloadDocumentFile(doc.storagePath), doc.mimeType);
    if (!parsed.text.trim()) throw new Error("No extractable text found. OCR was unavailable or produced no text.");

    for (const parsedPage of parsed.pages) {
      const [page] = await db.insert(pages).values({
        runId: run.id,
        pageIndex: parsedPage.pageIndex,
        text: parsedPage.text,
        isOcr: parsedPage.isOcr,
        extractionConfidence: parsedPage.extractionConfidence,
      }).returning({ id: pages.id });
      if (parsedPage.blocks.length) await db.insert(textBlocks).values(parsedPage.blocks.map((block, blockOrder) => ({
        pageId: page.id,
        blockOrder,
        kind: block.kind,
        text: block.text,
      })));
    }
    await db.insert(docMetadata).values({
      runId: run.id,
      title: parsed.detectedTitle,
      authors: parsed.detectedAuthor ? [parsed.detectedAuthor] : [],
      confidence: parsed.metadataConfidence,
      source: parsed.structureState === "full" ? "grobid" : "embedded/title-page",
    });

    const autoReady = parsed.metadataConfidence >= 0.9 && Boolean(parsed.detectedTitle);
    await db.transaction(async (tx) => {
      await tx.update(processingRuns).set({ isPublished: false }).where(eq(processingRuns.documentId, documentId));
      await tx.update(processingRuns).set({
        isPublished: true,
        status: "complete",
        stage: "published",
        structureState: parsed.structureState,
        note: parsed.structureState === "limited" ? "Structured GROBID extraction is unavailable; PDF.js page blocks are published." : null,
        finishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(processingRuns.id, run.id));
      if (autoReady) {
        await tx.update(works).set({ title: parsed.detectedTitle!, authorName: parsed.detectedAuthor, updatedAt: new Date() }).where(eq(works.id, doc.workId));
      }
      await tx.update(documents).set({
        extractedText: parsed.text,
        extractedTitle: parsed.detectedTitle,
        extractedAuthor: parsed.detectedAuthor,
        processingStatus: autoReady ? "ready" : "needs_review",
        analysisStatus: autoReady ? "not_started" : undefined,
        updatedAt: new Date(),
      }).where(eq(documents.id, documentId));
    });
    if (autoReady) await enqueueAnalyzeWork(documentId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(processingRuns).set({ status: "failed", stage: "failed", error: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(processingRuns.id, run.id));
    await db.update(documents).set({ processingStatus: "failed", processingError: message, updatedAt: new Date() }).where(eq(documents.id, documentId));
    throw error;
  }
}

async function main() {
  const boss = await getQueue();

  await boss.work<ExtractTextJob>(QUEUE_EXTRACT_TEXT, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      if (process.env.ANALYSIS_PIPELINE === "v2") await handleEditionExtraction(job.data.documentId);
      else await handleExtractText(job.data.documentId);
    }
  });

  await boss.work<AnalyzeWorkJob>(QUEUE_ANALYZE_WORK, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      // analyzeWork records its own failure state on the document; it
      // rethrows so pg-boss also marks the job failed for retry/visibility.
      await analyzeWork(job.data.documentId);
    }
  });

  console.log(`[worker] listening for "${QUEUE_EXTRACT_TEXT}" and "${QUEUE_ANALYZE_WORK}" jobs`);
}

main().catch((err) => {
  console.error("[worker] fatal error during startup:", err);
  process.exit(1);
});
