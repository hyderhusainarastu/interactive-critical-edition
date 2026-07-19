import {
  type AnalyzeWorkJob,
  db,
  documents,
  docFootnotes,
  docMetadata,
  type ExtractTextJob,
  footnotes,
  getQueue,
  processingJobs,
  processingRuns,
  pages,
  QUEUE_ANALYZE_WORK,
  QUEUE_EXTRACT_TEXT,
  textBlocks,
} from "@ice/db";
import { detectFootnotes, downloadDocumentFile, parseDocument, scanWithOptionalClamAv, validateUploadContent } from "@ice/ingestion";
import { reportError } from "@ice/observability";
import { desc, eq, sql } from "drizzle-orm";
import { analyzeEditionRun, analyzeWork } from "./analyze";
import { allocateEditionRun, publishEditionRun } from "./runLifecycle";

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
    const validation = validateUploadContent(buffer, doc.mimeType);
    if (!validation.valid) throw new Error(validation.error);
    const scan = await scanWithOptionalClamAv(buffer);
    if (!scan.valid) throw new Error(scan.error);
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
  const [job] = await db.select({ id: processingJobs.id }).from(processingJobs)
    .where(eq(processingJobs.documentId, documentId)).orderBy(desc(processingJobs.createdAt)).limit(1);
  const [doc] = await db.select({
    storagePath: documents.storagePath,
    mimeType: documents.mimeType,
    originalFilename: documents.originalFilename,
    workId: documents.workId,
    processingStatus: documents.processingStatus,
  }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new Error(`Document ${documentId} not found`);

  // Allocate the next run version under a per-document advisory lock (see
  // runLifecycle) so two concurrent reprocesses never claim the same version.
  const run = await allocateEditionRun(documentId);

  await db.update(documents).set({ processingStatus: "processing", processingError: null, updatedAt: new Date() }).where(eq(documents.id, documentId));
  if (job) await db.update(processingJobs).set({ status: "running", updatedAt: new Date() }).where(eq(processingJobs.id, job.id));
  try {
    const buffer = await downloadDocumentFile(doc.storagePath);
    const validation = validateUploadContent(buffer, doc.mimeType);
    if (!validation.valid) throw new Error(validation.error);
    const scan = await scanWithOptionalClamAv(buffer);
    if (!scan.valid) throw new Error(scan.error);
    const parsed = await parseDocument(buffer, doc.mimeType);
    if (!parsed.text.trim()) throw new Error("No extractable text found. OCR was unavailable or produced no text.");

    // Keep the established interactive reader functional while v2 is enabled:
    // its note panel reads the legacy table, whereas the edition separately
    // carries structurally extracted authorial notes.
    if (doc.mimeType === "text/plain" || doc.mimeType === "text/markdown") {
      const detected = detectFootnotes(parsed.text);
      await db.delete(footnotes).where(eq(footnotes.documentId, documentId));
      if (detected.length) await db.insert(footnotes).values(detected.map((note) => ({
        documentId,
        marker: note.marker,
        content: note.content,
      })));
    }

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
        bbox: block.bbox ?? null,
      })));
      // Structural (GROBID) footnotes become page-anchored authorial notes,
      // kept distinct from AI-generated notes (plan §33 §3.4).
      const footnoteBlocks = parsedPage.blocks.filter((block) => block.kind === "footnote");
      if (footnoteBlocks.length) await db.insert(docFootnotes).values(footnoteBlocks.map((block) => ({
        runId: run.id,
        marker: block.marker ?? "*",
        pageAnchor: { pageIndex: parsedPage.pageIndex, bbox: block.bbox ?? null },
        text: block.text,
        kind: "authorial",
        source: "grobid",
      })));
    }
    await db.insert(docMetadata).values({
      runId: run.id,
      title: parsed.detectedTitle,
      authors: parsed.detectedAuthor ? [parsed.detectedAuthor] : [],
      confidence: parsed.metadataConfidence,
      source: parsed.structureState === "full" ? "grobid" : "embedded/title-page",
    });

    await analyzeEditionRun({ runId: run.id, documentId, text: parsed.text });

    // Reprocessing a work the reader already confirmed must not send it back
    // through metadata review just because the new extractor has lower title
    // confidence. The user-approved work metadata is stronger evidence.
    const autoReady = (parsed.metadataConfidence >= 0.9 && Boolean(parsed.detectedTitle)) || doc.processingStatus === "ready";
    await publishEditionRun({
      runId: run.id,
      documentId,
      workId: doc.workId,
      structureState: parsed.structureState,
      note: parsed.structureState === "limited" ? "Structured GROBID extraction is unavailable; PDF.js page blocks are published." : null,
      extractedText: parsed.text,
      detectedTitle: parsed.detectedTitle,
      detectedAuthor: parsed.detectedAuthor,
      autoReady,
    });
    if (job) await db.update(processingJobs).set({ status: "succeeded", updatedAt: new Date() }).where(eq(processingJobs.id, job.id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(processingRuns).set({ status: "failed", stage: "failed", error: message, finishedAt: new Date(), updatedAt: new Date() }).where(eq(processingRuns.id, run.id));
    await db.update(documents).set({ processingStatus: "failed", processingError: message, updatedAt: new Date() }).where(eq(documents.id, documentId));
    if (job) await db.update(processingJobs).set({ status: "failed", error: message, attempts: sql`${processingJobs.attempts} + 1`, updatedAt: new Date() }).where(eq(processingJobs.id, job.id));
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
