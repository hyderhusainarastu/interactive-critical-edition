import { isEditionPipeline, phase12FeatureEnabled, phase18RagEnabled, pipelineAtLeast, pipelineVersion, type PipelineVersion } from "@ice/config";
import { createHash } from "node:crypto";
import { OpenAIEmbeddingsClient, estimateEmbeddingCostUsd } from "@ice/ai-adapters";
import { indexEligibleRagSources } from "@ice/rag";
import {
  type AnalyzeWorkJob,
  aiUsageLogs,
  type ResolveCitationMetadataJob,
  db,
  documents,
  docFootnotes,
  docMetadata,
  type ExtractTextJob,
  footnotes,
  getQueue,
  enqueueGraphExpansion,
  graphExpansionRequests,
  processingJobs,
  processingRuns,
  pages,
  QUEUE_ANALYZE_WORK,
  QUEUE_RESOLVE_CITATION_METADATA,
  QUEUE_EXPAND_CROSS_LIBRARY_GRAPH,
  type ExpandCrossLibraryGraphJob,
  QUEUE_EXTRACT_TEXT,
  researchCache,
  textBlocks,
} from "@ice/db";
import { detectFootnotes, downloadDocumentFile, extractAuthorApparatus, parseDocument, scanWithOptionalClamAv, validateUploadContent } from "@ice/ingestion";
import { reportError } from "@ice/observability";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { analyzeEditionRun, analyzeWork, resolveCitationMetadata } from "./analyze";
import { allocateEditionRun, publishEditionRun } from "./runLifecycle";
import { expandCrossLibraryGraph } from "./crossLibraryGraph";
import "./sentry";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function phase18EmbeddingsEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.PHASE_18_RAG_EMBEDDINGS_ENABLED ?? "").trim().toLowerCase());
}

/** v4 cannot reach a deployment until its independently controlled flag is on. */
function activePipelineVersion(): PipelineVersion {
  const configured = pipelineVersion();
  if (configured === "v4" && !phase12FeatureEnabled("pipelineV4")) {
    console.warn("[worker] ANALYSIS_PIPELINE=v4 requested while PHASE_12_PIPELINE_V4_ENABLED is off; using v3.");
    return "v3";
  }
  return configured;
}

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
        ...(phase12FeatureEnabled("libraryIdentity") ? { contentHash: sha256(buffer) } : {}),
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
    userId: documents.userId,
    processingStatus: documents.processingStatus,
  }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new Error(`Document ${documentId} not found`);

  // Allocate the next run version under a per-document advisory lock (see
  // runLifecycle) so two concurrent reprocesses never claim the same version.
  const pipeline = activePipelineVersion();
  const run = await allocateEditionRun(documentId, pipeline === "v4" ? "v4" : pipeline === "v3" ? "v3" : "v2");

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

    if (pipelineAtLeast(pipeline, "v3")) {
      await db.update(processingRuns).set({ stage: "structural-outline", updatedAt: new Date() }).where(eq(processingRuns.id, run.id));
    }

    // Keep the legacy source reader functional. Use exact source-page text
    // here, not `parsed.text`: the latter is deliberately body-only after
    // Phase 16 structural separation, so re-running detection on it could
    // never see a trailing source notes section.
    if (doc.mimeType === "text/plain" || doc.mimeType === "text/markdown") {
      const detected = detectFootnotes(parsed.pages.map((page) => page.text).join("\n\n"));
      await db.delete(footnotes).where(eq(footnotes.documentId, documentId));
      if (detected.length) await db.insert(footnotes).values(detected.map((note) => ({
        documentId,
        marker: note.marker,
        content: note.content,
      })));
    }

    // v3/v4: the real (id, text) of every body block, in document order —
    // what passage-annotation synthesis anchors to. Collected here rather than
    // re-queried later so an annotation can only ever reference a block that
    // genuinely exists (the same real IDs that were just inserted).
    const bodyBlocks: { id: string; text: string; pageIndex: number; blockOrder: number; sectionTitle: string | null }[] = [];
    const apparatusBlocks: { blockId: string; kind: "title" | "header" | "body" | "footer" | "footnote" | "endnote" | "caption" | "bibliography" | "reference"; text: string; marker?: string; pageIndex: number; blockOrder: number }[] = [];
    let currentSectionTitle: string | null = null;

    for (const parsedPage of parsed.pages) {
      const [page] = await db.insert(pages).values({
        runId: run.id,
        pageIndex: parsedPage.pageIndex,
        text: parsedPage.text,
        isOcr: parsedPage.isOcr,
        extractionConfidence: parsedPage.extractionConfidence,
      }).returning({ id: pages.id });
      if (parsedPage.blocks.length) {
        const insertedBlocks = await db.insert(textBlocks).values(parsedPage.blocks.map((block, blockOrder) => ({
          pageId: page.id,
          blockOrder,
          kind: block.kind,
          text: block.text,
          bbox: block.bbox ?? null,
          marker: block.marker ?? null,
        }))).returning({ id: textBlocks.id, kind: textBlocks.kind, text: textBlocks.text, marker: textBlocks.marker, blockOrder: textBlocks.blockOrder });
        if (pipelineAtLeast(pipeline, "v3")) {
          for (const b of insertedBlocks) {
            apparatusBlocks.push({
              blockId: b.id,
              kind: b.kind,
              text: b.text,
              marker: b.marker ?? undefined,
              pageIndex: parsedPage.pageIndex,
              blockOrder: b.blockOrder,
            });
            if ((b.kind === "title" || b.kind === "header") && b.text.trim()) currentSectionTitle = b.text.trim();
            if (b.kind === "body" && b.text.trim().length >= 40) {
              bodyBlocks.push({
                id: b.id,
                text: b.text,
                pageIndex: parsedPage.pageIndex,
                blockOrder: b.blockOrder,
                sectionTitle: currentSectionTitle,
              });
            }
          }
        }
      }
      // Structural (GROBID) footnotes become page-anchored authorial notes,
      // kept distinct from AI-generated notes (plan §33 §3.4).
      const footnoteBlocks = parsedPage.blocks.filter((block) => block.kind === "footnote" || block.kind === "endnote");
      if (footnoteBlocks.length) await db.insert(docFootnotes).values(footnoteBlocks.map((block) => ({
        runId: run.id,
        marker: block.marker ?? "*",
        pageAnchor: { pageIndex: parsedPage.pageIndex, bbox: block.bbox ?? null, apparatusKind: block.kind },
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

    if (pipelineAtLeast(pipeline, "v3")) {
      await db.update(processingRuns).set({
        stage: pipeline === "v4" ? "section-aware-annotations" : "section-passage-anchors",
        updatedAt: new Date(),
      }).where(eq(processingRuns.id, run.id));
    }
    const apparatus = pipelineAtLeast(pipeline, "v3") ? extractAuthorApparatus({ blocks: apparatusBlocks, text: parsed.text }) : [];
    await analyzeEditionRun({ runId: run.id, documentId, text: parsed.text, pipeline, bodyBlocks, apparatus });

    // Reprocessing a work the reader already confirmed must not send it back
    // through metadata review just because the new extractor has lower title
    // confidence. The user-approved work metadata is stronger evidence.
    const autoReady = (parsed.metadataConfidence >= 0.9 && Boolean(parsed.detectedTitle)) || doc.processingStatus === "ready";
    if (phase12FeatureEnabled("libraryIdentity")) {
      await db.update(documents).set({ contentHash: sha256(buffer), updatedAt: new Date() }).where(eq(documents.id, documentId));
    }

    await publishEditionRun({
      runId: run.id,
      documentId,
      workId: doc.workId,
      structureState: parsed.structureState,
      note: parsed.structureState === "limited"
        ? "Structure-limited: source layout did not yield reliably separate body and apparatus blocks. The immutable original source remains available."
        : null,
      extractedText: parsed.text,
      detectedTitle: parsed.detectedTitle,
      detectedAuthor: parsed.detectedAuthor,
      autoReady,
    });
    // Phase 18's index is deliberately post-publication and independently
    // flag-gated. A failed or unavailable embedding provider cannot alter the
    // reader pipeline: durable lexical chunks remain valid, and the flag is
    // off outside explicitly configured local acceptance environments.
    if (phase18RagEnabled()) {
      const embeddingClient = new OpenAIEmbeddingsClient();
      const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
      const embeddingCapUsd = 0.01;
      let reservedEmbeddingUsd = 0;
      const indexed = await indexEligibleRagSources({
        userId: doc.userId,
        workId: doc.workId,
        documentId,
        processingRunId: run.id,
        embed: phase18EmbeddingsEnabled() && embeddingClient.available
          ? async (text) => {
              const estimate = estimateEmbeddingCostUsd(embeddingModel, Math.ceil(text.length / 4));
              if (reservedEmbeddingUsd + estimate > embeddingCapUsd) throw new Error("Phase 18 automatic embedding cap reached");
              const embedded = await embeddingClient.embed(text, embeddingModel);
              reservedEmbeddingUsd += estimateEmbeddingCostUsd(embedded.model, embedded.inputTokens);
              return embedded;
            }
          : undefined,
      });
      if (indexed.embeddingUsage.length) {
        await db.insert(aiUsageLogs).values(indexed.embeddingUsage.map((usage) => ({
          documentId,
          runId: run.id,
          task: "rag_chunk_embedding",
          stage: "socratic-rag-index",
          provider: "openai",
          model: usage.model,
          promptTokens: usage.inputTokens,
          completionTokens: 0,
          estimatedCostUsd: usage.estimatedCostUsd,
        })));
      }
      console.log(`[worker] Phase 18 indexed ${indexed.chunks} eligible RAG chunk(s) for document ${documentId}${indexed.truncated ? " (automatic cap reached)" : ""}`);
    }
    // Cross-library work is an independent, release-gated post-publication
    // step. A v4 run creates at most one automatic request; its own worker
    // enforces 20 candidates and $0.25, so uploading never silently fans out
    // into an unbounded paid graph operation.
    if (pipeline === "v4" && phase12FeatureEnabled("crossLibraryGraph")) {
      const [expansion] = await db
        .insert(graphExpansionRequests)
        .values({
          userId: doc.userId,
          sourceWorkId: doc.workId,
          mode: "automatic",
          requestedCandidates: 20,
          estimatedCostUsd: 0.25,
          hardCapUsd: 0.25,
          idempotencyKey: `automatic:${run.id}`,
          status: "queued",
        })
        .onConflictDoNothing({ target: [graphExpansionRequests.userId, graphExpansionRequests.idempotencyKey] })
        .returning({ id: graphExpansionRequests.id });
      if (expansion) await enqueueGraphExpansion(expansion.id);
    }
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

  // Sweep expired result-cache rows so research_cache stays bounded (plan §33).
  try {
    const swept = await db.delete(researchCache).where(lt(researchCache.expiresAt, new Date())).returning({ id: researchCache.id });
    if (swept.length) console.log(`[worker] swept ${swept.length} expired research_cache row(s)`);
  } catch (err) {
    reportError(err, { scope: "worker.cacheSweep" });
  }

  // Sweep runs abandoned mid-flight. A run is left `running` when its process
  // dies — an instance drained by a deploy, or (observed in a 10-document load
  // test) a job retried while still executing. Nothing ever cleared them, so
  // they accumulated: admin counts stayed wrong and the documents looked
  // permanently mid-processing. Published runs are never touched, and the
  // threshold sits above the job expiration so a genuinely running job is
  // never mistaken for an abandoned one.
  try {
    const staleMinutes = Math.max(1, Number(process.env.STALE_RUN_MINUTES ?? 90));
    const cutoff = new Date(Date.now() - staleMinutes * 60_000);
    const stale = await db
      .update(processingRuns)
      .set({
        status: "failed",
        error: `Abandoned mid-run: no progress for over ${staleMinutes} minutes (process ended before the run finished).`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(processingRuns.status, "running"),
          eq(processingRuns.isPublished, false),
          lt(processingRuns.updatedAt, cutoff),
        ),
      )
      .returning({ id: processingRuns.id });
    if (stale.length) console.log(`[worker] marked ${stale.length} abandoned processing_run row(s) as failed`);
  } catch (err) {
    reportError(err, { scope: "worker.staleRunSweep" });
  }

  await boss.work<ExtractTextJob>(QUEUE_EXTRACT_TEXT, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      if (isEditionPipeline(activePipelineVersion())) await handleEditionExtraction(job.data.documentId);
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

  await boss.work<ResolveCitationMetadataJob>(QUEUE_RESOLVE_CITATION_METADATA, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    // Deliberately sequential: one external bibliographic lookup at a time is
    // the rate limit; a miss records an unresolved Library item rather than
    // holding up extraction or discovery.
    for (const job of batch) await resolveCitationMetadata(job.data.citationId);
  });

  await boss.work<ExpandCrossLibraryGraphJob>(QUEUE_EXPAND_CROSS_LIBRARY_GRAPH, async (jobs) => {
    const batch = Array.isArray(jobs) ? jobs : [jobs];
    for (const job of batch) {
      try {
        await expandCrossLibraryGraph(job.data.expansionRequestId);
      } catch (error) {
        reportError(error, { scope: "worker.expandCrossLibraryGraph", expansionRequestId: job.data.expansionRequestId });
        throw error;
      }
    }
  });

  // Log the RESOLVED version, not the raw env var: Phase 8 lost three canary
  // runs to production quietly running something other than what was assumed.
  console.log(
    `[worker] listening for "${QUEUE_EXTRACT_TEXT}", "${QUEUE_ANALYZE_WORK}", "${QUEUE_RESOLVE_CITATION_METADATA}", and "${QUEUE_EXPAND_CROSS_LIBRARY_GRAPH}" jobs (pipeline ${activePipelineVersion()})`,
  );
}

/** A crash outside any job handler's own try/catch (e.g. a driver-level
 * exception thrown mid-query, as in the 2026-07-20 "unsupported Unicode
 * escape sequence" incident) previously reached Node's default handler with
 * no structured/Sentry-visible record — the only trace was a raw stack in
 * Render's log stream. Render still restarts the instance either way; this
 * only makes the restart's cause diagnosable instead of silent. */
function installCrashObservability() {
  const onFatal = (scope: string) => (err: unknown) => {
    reportError(err, { scope: `worker.${scope}`, pipeline: activePipelineVersion(), commit: process.env.RENDER_GIT_COMMIT ?? null });
    console.error(`[worker] fatal ${scope}, exiting for Render to restart:`, err);
    process.exit(1);
  };
  process.on("uncaughtException", onFatal("uncaughtException"));
  process.on("unhandledRejection", onFatal("unhandledRejection"));
}

installCrashObservability();

main().catch((err) => {
  console.error("[worker] fatal error during startup:", err);
  process.exit(1);
});
