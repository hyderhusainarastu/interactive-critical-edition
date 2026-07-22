import {
  annotations,
  bibliographicRecords,
  citationLibraryLinks,
  citations,
  concepts,
  db,
  graphEdges,
  learningResources,
  pages,
  ragChunks,
  ragConversations,
  ragMessageCitations,
  ragMessages,
  readingRecords,
  roadmapOverrides,
  textBlocks,
  understandingRatings,
  workIdentities,
  workIdentityMerges,
  works,
} from "@ice/db";
import { emptySnapshot, type ConsistencySnapshot } from "@ice/consistency";

/**
 * Phase 20.7 — the DB side of `@ice/consistency`. Fetches a flat, whole-DB
 * snapshot in exactly the shape the pure checks expect (`ConsistencySnapshot`,
 * `@ice/consistency`'s own doc comment on that type). No filtering by user —
 * these checks are cross-surface reference integrity, not per-user reads, so
 * this mirrors the same "audit everything, decide nothing" shape as Phase
 * 20.6's `fetchIdentityAuditCandidates`/`auditWorkIdentityDuplicates` in
 * `apps/worker/src/identity/merge.ts`.
 *
 * Deliberately NOT scoped to non-deleted works only for every table — a
 * dangling reference from a still-live row into a deleted one is exactly
 * what `graph-edge-endpoints`/`library-item-canonical-work` need to see, so
 * `works` includes trashed rows (with `deletedAt` present) rather than
 * filtering them out at the fetch boundary.
 */
export async function fetchConsistencySnapshot(): Promise<ConsistencySnapshot> {
  const [
    citationRows,
    citationLibraryLinkRows,
    learningResourceRows,
    workRows,
    workIdentityRows,
    workIdentityMergeRows,
    graphEdgeRows,
    bibliographicRecordRows,
    conceptRows,
    annotationRows,
    roadmapOverrideRows,
    readingRecordRows,
    understandingRatingRows,
    textBlockRows,
    pageRows,
    ragMessageCitationRows,
    ragMessageRows,
    ragConversationRows,
    ragChunkRows,
  ] = await Promise.all([
    db.select({
      id: citations.id,
      documentId: citations.documentId,
      processingRunId: citations.processingRunId,
      textBlockId: citations.textBlockId,
      resolvedBibId: citations.resolvedBibId,
    }).from(citations),
    db.select({
      id: citationLibraryLinks.id,
      citationId: citationLibraryLinks.citationId,
      learningResourceId: citationLibraryLinks.learningResourceId,
    }).from(citationLibraryLinks),
    db.select({
      id: learningResources.id,
      workIdentityId: learningResources.workIdentityId,
      bibRecordId: learningResources.bibRecordId,
      workRole: learningResources.workRole,
      title: learningResources.title,
      year: learningResources.year,
    }).from(learningResources),
    db.select({
      id: works.id,
      title: works.title,
      authorName: works.authorName,
      workIdentityId: works.workIdentityId,
      deletedAt: works.deletedAt,
    }).from(works),
    db.select({
      id: workIdentities.id,
      canonicalTitle: workIdentities.canonicalTitle,
      authorSurname: workIdentities.authorSurname,
      year: workIdentities.year,
    }).from(workIdentities),
    db.select({
      loserIdentityId: workIdentityMerges.loserIdentityId,
      winnerIdentityId: workIdentityMerges.winnerIdentityId,
      revertedAt: workIdentityMerges.revertedAt,
    }).from(workIdentityMerges),
    db.select({
      id: graphEdges.id,
      sourceType: graphEdges.sourceType,
      sourceId: graphEdges.sourceId,
      targetType: graphEdges.targetType,
      targetId: graphEdges.targetId,
    }).from(graphEdges),
    db.select({ id: bibliographicRecords.id, title: bibliographicRecords.title }).from(bibliographicRecords),
    db.select({ id: concepts.id }).from(concepts),
    db.select({ id: annotations.id, targetBibId: annotations.targetBibId, targetLabel: annotations.targetLabel }).from(annotations),
    db.select({ id: roadmapOverrides.id, bibId: roadmapOverrides.bibId }).from(roadmapOverrides),
    db.select({ id: readingRecords.id, bibId: readingRecords.bibId }).from(readingRecords),
    db.select({ id: understandingRatings.id, bibId: understandingRatings.bibId }).from(understandingRatings),
    db.select({ id: textBlocks.id, pageId: textBlocks.pageId }).from(textBlocks),
    db.select({ id: pages.id, runId: pages.runId }).from(pages),
    db.select({ id: ragMessageCitations.id, messageId: ragMessageCitations.messageId, chunkId: ragMessageCitations.chunkId }).from(ragMessageCitations),
    db.select({ id: ragMessages.id, conversationId: ragMessages.conversationId }).from(ragMessages),
    db.select({ id: ragConversations.id, userId: ragConversations.userId }).from(ragConversations),
    db.select({ id: ragChunks.id, userId: ragChunks.userId }).from(ragChunks),
  ]);

  return {
    ...emptySnapshot(),
    citations: citationRows,
    citationLibraryLinks: citationLibraryLinkRows,
    learningResources: learningResourceRows,
    works: workRows,
    workIdentities: workIdentityRows,
    workIdentityMerges: workIdentityMergeRows,
    graphEdges: graphEdgeRows,
    bibliographicRecords: bibliographicRecordRows,
    conceptIds: conceptRows.map((c) => c.id),
    annotations: annotationRows,
    roadmapOverrides: roadmapOverrideRows,
    readingRecords: readingRecordRows,
    understandingRatings: understandingRatingRows,
    textBlocks: textBlockRows,
    pages: pageRows,
    ragMessageCitations: ragMessageCitationRows,
    ragMessages: ragMessageRows,
    ragConversations: ragConversationRows,
    ragChunks: ragChunkRows,
  };
}
