import {
  aiUsageLogs,
  annotations,
  citations,
  db,
  documents,
  graphEdges,
  processingRuns,
  works,
} from "@ice/db";
import {
  classifyRelationship,
  CLASSIFY_PROMPT_VERSION,
  estimateCostUsd,
} from "@ice/ai-adapters";
import { resolveCitation, type ResolvedRecord } from "@ice/bibliographic";
import { extractCitations } from "@ice/ingestion";
import { reportError } from "@ice/observability";
import { and, eq } from "drizzle-orm";
import {
  ANALYSIS_CONCURRENCY,
  buildTextAnchor,
  CATEGORY_TO_EDGE,
  citationFrequencyFor,
  edgeValue,
  leadingSurname,
  mapWithConcurrency,
  targetLabel,
} from "./citationAnchoring";
import { findOrCreateBibRecord } from "./classicalCitations";

export async function analyzeWork(documentId: string): Promise<void> {
  const [doc] = await db
    .select({
      id: documents.id,
      userId: documents.userId,
      workId: documents.workId,
      mimeType: documents.mimeType,
      extractedText: documents.extractedText,
      title: works.title,
      authorName: works.authorName,
    })
    .from(documents)
    .innerJoin(works, eq(works.id, documents.workId))
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) throw new Error(`Document ${documentId} not found for analysis`);
  if (!doc.extractedText?.trim()) throw new Error("No extracted text to analyze");

  // Citation-wipe guard (D-23-3). The block below deletes this document's
  // citations and re-extracts them with the OLD heuristic. That is correct
  // ONLY for legacy (v1) documents, which never create a `processing_run`.
  // Any document processed by the edition pipeline (v2/v3/v4) owns a
  // `processing_run` whose own citation-writing pass produced a richer,
  // run-scoped, provider-resolved citation set (apps/worker/src/analyze.ts's
  // analyzeEditionRun) — running legacy analysis on it silently destroys that
  // set. This guard is DATA-DRIVEN and version-independent: it never reads
  // ANALYSIS_PIPELINE, so it holds even when the web and worker env disagree,
  // and it correctly lets a true v1 document (no run) fall through to legacy
  // analysis. It also neutralises any stale analyze-work job already sitting
  // in the queue from before this fix, and any manual /analyze retrigger on
  // an edition document (whose real recovery path is /reprocess).
  const [editionRun] = await db
    .select({ id: processingRuns.id })
    .from(processingRuns)
    .where(eq(processingRuns.documentId, documentId))
    .limit(1);
  if (editionRun) {
    // The edition pipeline is the authoritative analysis for this document.
    // Record a terminal, honest status and leave its output untouched.
    // Idempotent: safe to run repeatedly on a retried/duplicate job.
    await db
      .update(documents)
      .set({ analysisStatus: "complete", analysisError: null, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    return;
  }

  await db
    .update(documents)
    .set({ analysisStatus: "analyzing", analysisError: null, updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  try {
    // Idempotent re-run: clear prior *system* output, keep user edits.
    await db
      .delete(annotations)
      .where(and(eq(annotations.documentId, documentId), eq(annotations.createdBy, "system")));
    await db.delete(citations).where(eq(citations.documentId, documentId));
    await db
      .delete(graphEdges)
      .where(
        and(
          eq(graphEdges.sourceType, "work"),
          eq(graphEdges.sourceId, doc.workId),
          eq(graphEdges.createdBy, "system"),
        ),
      );

    // Cap on citations classified per document (bounds AI spend and worker
    // time). 300 comfortably covers a full book's reference list; at the
    // cheap-tier model that's ~4-5 cents max per analysis. Candidates are
    // processed with bounded concurrency (see ANALYSIS_CONCURRENCY) so a
    // large reference list finishes in a fraction of the sequential time.
    const candidates = extractCitations(doc.extractedText, 300);
    const citationTexts = candidates.map((candidate) => `${candidate.text} ${candidate.query}`);
    const isText = doc.mimeType === "text/plain" || doc.mimeType === "text/markdown";
    const paragraphs = isText
      ? doc.extractedText.split(/\n{2,}/).filter((p) => p.trim().length > 0)
      : [];

    // Dedup bibliographic records within this run: concurrent candidates
    // resolving to the SAME work (same DOI/external id) would otherwise
    // race on find-or-create and insert duplicates. Caching the *promise*
    // by key means the first request creates the record and the rest await
    // the same result. (findOrCreateBibRecord still reads existing rows
    // first, so cross-run dedup is unaffected.)
    const bibCache = new Map<string, Promise<string>>();
    const getBibId = (record: ResolvedRecord): Promise<string> => {
      const key = record.doi
        ? `doi:${record.doi}`
        : record.externalId
          ? `ext:${record.externalId}`
          : `title:${record.title.toLowerCase()}`;
      let p = bibCache.get(key);
      if (!p) {
        p = findOrCreateBibRecord(record);
        bibCache.set(key, p);
      }
      return p;
    };

    await mapWithConcurrency(candidates, ANALYSIS_CONCURRENCY, async (candidate) => {
      // --- Stage 1: resolve against real bibliographic sources ---
      // D-20-81: see the analogous rawText note in resolveCitationMetadata.
      const record = await resolveCitation(candidate.query, { rawText: candidate.text });
      const bibId = record ? await getBibId(record) : null;

      await db.insert(citations).values({
        documentId,
        rawText: candidate.text,
        normalizedQuery: candidate.query,
        sourceType: candidate.kind === "inline" ? "inline" : "bibliography",
        parserConfidence: candidate.kind === "inline" ? 0.74 : 0.8,
        resolvedBibId: bibId,
        resolutionSource: record?.source ?? "unresolved",
        resolutionState: record ? "resolved" : "unresolved",
      });

      // --- Anchoring (text docs only) ---
      const located = isText ? buildTextAnchor(paragraphs, leadingSurname(candidate.query)) : null;
      const sourceText = located?.sourceText ?? candidate.text;
      const citationFrequency = citationFrequencyFor(
        { title: record?.title ?? candidate.text.slice(0, 160), authors: record?.authors ?? null },
        doc.extractedText ?? "",
        citationTexts,
      );

      // --- Stage 2: classify the relationship ---
      const classification = await classifyRelationship({
        primaryTitle: doc.title,
        primaryAuthor: doc.authorName,
        candidateTitle: record?.title ?? candidate.text.slice(0, 160),
        candidateAuthor: record?.authors ?? null,
        sourceText,
        resolved: Boolean(record),
        citationFrequency,
      });

      await db.insert(aiUsageLogs).values({
        documentId,
        task: "relationship_classification",
        provider: classification.provider,
        model: classification.model,
        promptTokens: classification.promptTokens,
        completionTokens: classification.completionTokens,
        estimatedCostUsd: classification.heuristic
          ? 0
          : estimateCostUsd(classification.model, classification.promptTokens, classification.completionTokens),
      });

      await db.insert(annotations).values({
        userId: doc.userId,
        documentId,
        relationshipCategory: classification.category,
        targetBibId: bibId,
        targetLabel: targetLabel(candidate, record),
        anchor: located?.anchor ?? null,
        extractedSourceText: sourceText,
        explanation: classification.explanation,
        confidence: classification.confidence,
        modelUsed: classification.model,
        promptVersion: classification.heuristic ? "heuristic" : CLASSIFY_PROMPT_VERSION,
        createdBy: "system",
        verificationStatus: "unreviewed",
      });

      // Graph edge only for resolved targets (real node on both ends).
      if (bibId) {
        await db.insert(graphEdges).values({
          userId: doc.userId,
          sourceType: "work",
          sourceId: doc.workId,
          targetType: "bibliographic_record",
          targetId: bibId,
          edgeType: edgeValue(CATEGORY_TO_EDGE[classification.category]),
          weight: 1,
          confidence: classification.confidence,
          evidence: { extractedSourceText: sourceText, category: classification.category, citationFrequency },
          createdBy: "system",
        });
      }
    });

    await db
      .update(documents)
      .set({ analysisStatus: "complete", updatedAt: new Date() })
      .where(eq(documents.id, documentId));

    console.log(`[worker] analysis complete for document ${documentId}: ${candidates.length} annotation(s)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reportError(err, { scope: "worker.analyzeWork", documentId });
    await db
      .update(documents)
      .set({ analysisStatus: "failed", analysisError: message, updatedAt: new Date() })
      .where(eq(documents.id, documentId));
    throw err;
  }
}
