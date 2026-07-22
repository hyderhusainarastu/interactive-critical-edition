import { phase12FeatureEnabled, phase18RagEnabled, pipelineAtLeast, pipelineVersion, type PipelineVersion } from "@ice/config";
import { createHash } from "node:crypto";
import { OpenAIEmbeddingsClient, estimateEmbeddingCostUsd } from "@ice/ai-adapters";
import { indexEligibleRagSources } from "@ice/rag";
import {
  aiUsageLogs,
  db,
  documents,
  docFootnotes,
  docMetadata,
  enqueueGraphExpansion,
  footnotes,
  graphExpansionRequests,
  processingJobs,
  processingRuns,
  pages,
  textBlocks,
} from "@ice/db";
import { detectFootnotes, downloadDocumentFile, extractAuthorApparatus, parseDocument, scanWithOptionalClamAv, validateUploadContent } from "@ice/ingestion";
import { reportError } from "@ice/observability";
import { desc, eq, sql } from "drizzle-orm";
import { analyzeEditionRun } from "./analyze";
import { allocateEditionRun, publishEditionRun } from "./runLifecycle";

/**
 * The extract-text job handlers, extracted from index.ts (whose module body
 * boots the worker) so the Phase 20.5 reliability guarantees — failed
 * reprocess retains the last good published edition, Storage/provider
 * failures are contained to the new run, atomic publication — are
 * integration-testable against the real handlers rather than asserted from
 * documentation.
 */

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function phase18EmbeddingsEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.PHASE_18_RAG_EMBEDDINGS_ENABLED ?? "").trim().toLowerCase());
}

/** v4 cannot reach a deployment until its independently controlled flag is on. */
export function activePipelineVersion(): PipelineVersion {
  const configured = pipelineVersion();
  if (configured === "v4" && !phase12FeatureEnabled("pipelineV4")) {
    console.warn("[worker] ANALYSIS_PIPELINE=v4 requested while PHASE_12_PIPELINE_V4_ENABLED is off; using v3.");
    return "v3";
  }
  return configured;
}

/**
 * While a run executes, refresh its `updated_at` every minute as a liveness
 * heartbeat. This is what makes stale-active-job detection safe (see
 * `planReprocess` in @ice/db): a live worker sitting in one long research
 * stage keeps the run visibly fresh, so only a genuinely dead worker's run
 * ever goes stale — time-since-start alone can't distinguish "long stage"
 * from "crashed", and killing a live job would duplicate paid work. The
 * status guard means publication/failure (which set a terminal status) also
 * stops the heartbeat having any effect even before the interval clears.
 */
const RUN_HEARTBEAT_MS = 60_000;

function startRunHeartbeat(runId: string): () => void {
  const interval = setInterval(() => {
    db.update(processingRuns)
      .set({ updatedAt: new Date() })
      .where(sql`${processingRuns.id} = ${runId} and ${processingRuns.status} = 'running'`)
      .catch((err: unknown) => reportError(err, { scope: "worker.runHeartbeat", runId }));
  }, RUN_HEARTBEAT_MS);
  interval.unref?.();
  return () => clearInterval(interval);
}

export async function handleExtractText(documentId: string) {
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
 * legacy annotations or a previous published run: the immutable original
 * file in Storage and the last published run both survive a failed attempt,
 * so retry is always a safe restart from source.
 */
export async function handleEditionExtraction(documentId: string) {
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
  const stopHeartbeat = startRunHeartbeat(run.id);
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
    //
    // Phase 20.5 (D-20-52): "was ready" must survive an intervening failure.
    // A failed attempt sets processingStatus to "failed", so on the RETRY the
    // ready evidence was gone and a confirmed work bounced back through
    // metadata review (caught red by the retry-after-failure integration
    // test). A prior PUBLISHED run while the document sits in a
    // failure/recovery state ("failed"/"processing") is the durable stand-in:
    // that edition already carries served metadata, and re-review after a
    // transient failure is exactly the regression the comment above forbids.
    // Known narrow trade-off (no schema change allowed this wave): a
    // never-confirmed needs_review work that is reprocessed, fails, and then
    // succeeds also auto-readies off its published prior run — a
    // `documents.confirmed_at` column is the precise durable fix.
    const [priorPublished] = await db
      .select({ id: processingRuns.id })
      .from(processingRuns)
      .where(sql`${processingRuns.documentId} = ${documentId} and ${processingRuns.isPublished} = true and ${processingRuns.id} <> ${run.id}`)
      .limit(1);
    const autoReady =
      (parsed.metadataConfidence >= 0.9 && Boolean(parsed.detectedTitle)) ||
      doc.processingStatus === "ready" ||
      (Boolean(priorPublished) && (doc.processingStatus === "failed" || doc.processingStatus === "processing"));
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
  } finally {
    stopHeartbeat();
  }
}
