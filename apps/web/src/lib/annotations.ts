import { annotations, bibliographicRecords, db } from "@ice/db";
import { desc, eq } from "drizzle-orm";

/**
 * Loads a document's annotations joined to their resolved bibliographic
 * target (when any), shaped for the reader UI. Confidence and full
 * provenance (model, prompt version, extracted source text) travel with
 * every row — the UI shows them rather than presenting an AI verdict as
 * settled fact (plan §12). Hidden annotations are included with a flag so
 * the client can offer a "show hidden" toggle rather than losing them.
 */
export async function getAnnotationsForDocument(documentId: string) {
  const rows = await db
    .select({
      id: annotations.id,
      relationshipCategory: annotations.relationshipCategory,
      targetLabel: annotations.targetLabel,
      anchor: annotations.anchor,
      extractedSourceText: annotations.extractedSourceText,
      explanation: annotations.explanation,
      confidence: annotations.confidence,
      modelUsed: annotations.modelUsed,
      promptVersion: annotations.promptVersion,
      createdBy: annotations.createdBy,
      verificationStatus: annotations.verificationStatus,
      hidden: annotations.hidden,
      createdAt: annotations.createdAt,
      targetBibId: annotations.targetBibId,
      bibTitle: bibliographicRecords.title,
      bibAuthors: bibliographicRecords.authors,
      bibYear: bibliographicRecords.year,
      bibUrl: bibliographicRecords.url,
      bibDoi: bibliographicRecords.doi,
      bibAccessStatus: bibliographicRecords.accessStatus,
      bibSource: bibliographicRecords.source,
    })
    .from(annotations)
    .leftJoin(bibliographicRecords, eq(bibliographicRecords.id, annotations.targetBibId))
    .where(eq(annotations.documentId, documentId))
    .orderBy(desc(annotations.confidence));

  return rows.map((r) => ({
    id: r.id,
    relationshipCategory: r.relationshipCategory,
    targetLabel: r.targetLabel,
    anchor: r.anchor,
    extractedSourceText: r.extractedSourceText,
    explanation: r.explanation,
    confidence: r.confidence,
    modelUsed: r.modelUsed,
    promptVersion: r.promptVersion,
    // Surfaces honestly in the UI whether this was a real model verdict
    // or the deterministic heuristic stub (no API key configured).
    isHeuristic: r.promptVersion === "heuristic",
    createdBy: r.createdBy,
    verificationStatus: r.verificationStatus,
    hidden: r.hidden,
    createdAt: r.createdAt,
    target: r.targetBibId
      ? {
          id: r.targetBibId,
          title: r.bibTitle,
          authors: r.bibAuthors,
          year: r.bibYear,
          url: r.bibUrl,
          doi: r.bibDoi,
          accessStatus: r.bibAccessStatus,
          source: r.bibSource,
        }
      : null,
  }));
}

export type AnnotationDto = Awaited<ReturnType<typeof getAnnotationsForDocument>>[number];
