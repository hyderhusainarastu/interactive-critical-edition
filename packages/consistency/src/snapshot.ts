/**
 * Flat row shapes every check reads. Deliberately not the Drizzle
 * `$inferSelect` types — those live in `@ice/db`, which this package must
 * not depend on (pure package, no DB). The worker-side fetcher
 * (`apps/worker/src/consistency/snapshot.ts`) is responsible for mapping
 * real rows into exactly this shape.
 */

export interface CitationRow {
  id: string;
  documentId: string;
  processingRunId: string | null;
  textBlockId: string | null;
  resolvedBibId: string | null;
}

export interface CitationLibraryLinkRow {
  id: string;
  citationId: string;
  learningResourceId: string;
}

export interface LearningResourceRow {
  id: string;
  workIdentityId: string | null;
  bibRecordId: string | null;
  workRole: string;
  title: string;
  year: number | null;
}

export interface WorkRow {
  id: string;
  title: string;
  authorName: string | null;
  workIdentityId: string | null;
  deletedAt: string | Date | null;
}

export interface WorkIdentityRow {
  id: string;
  canonicalTitle: string;
  authorSurname: string | null;
  year: number | null;
}

export interface WorkIdentityMergeRow {
  loserIdentityId: string;
  winnerIdentityId: string;
  revertedAt: string | Date | null;
}

export interface GraphEdgeRow {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
}

export interface BibliographicRecordRow {
  id: string;
  title: string;
}

export interface AnnotationRow {
  id: string;
  targetBibId: string | null;
  targetLabel: string;
}

/** `roadmap_override`/`reading_record`/`understanding_rating` all carry a
 *  nullable `bibId` target — the only one of the (up to three) polymorphic
 *  targets a bibliographic-record duplicate can drift on. */
export interface RoadmapTargetRow {
  id: string;
  bibId: string | null;
}

export interface TextBlockRow {
  id: string;
  pageId: string;
}

export interface PageRow {
  id: string;
  runId: string;
}

export interface RagMessageCitationRow {
  id: string;
  messageId: string;
  chunkId: string;
}

export interface RagMessageRow {
  id: string;
  conversationId: string;
}

export interface RagConversationRow {
  id: string;
  userId: string;
}

export interface RagChunkRow {
  id: string;
  userId: string;
}

export interface ConsistencySnapshot {
  citations: CitationRow[];
  citationLibraryLinks: CitationLibraryLinkRow[];
  learningResources: LearningResourceRow[];
  works: WorkRow[];
  workIdentities: WorkIdentityRow[];
  workIdentityMerges: WorkIdentityMergeRow[];
  graphEdges: GraphEdgeRow[];
  bibliographicRecords: BibliographicRecordRow[];
  conceptIds: string[];
  annotations: AnnotationRow[];
  roadmapOverrides: RoadmapTargetRow[];
  readingRecords: RoadmapTargetRow[];
  understandingRatings: RoadmapTargetRow[];
  textBlocks: TextBlockRow[];
  pages: PageRow[];
  ragMessageCitations: RagMessageCitationRow[];
  ragMessages: RagMessageRow[];
  ragConversations: RagConversationRow[];
  ragChunks: RagChunkRow[];
}

export function emptySnapshot(): ConsistencySnapshot {
  return {
    citations: [],
    citationLibraryLinks: [],
    learningResources: [],
    works: [],
    workIdentities: [],
    workIdentityMerges: [],
    graphEdges: [],
    bibliographicRecords: [],
    conceptIds: [],
    annotations: [],
    roadmapOverrides: [],
    readingRecords: [],
    understandingRatings: [],
    textBlocks: [],
    pages: [],
    ragMessageCitations: [],
    ragMessages: [],
    ragConversations: [],
    ragChunks: [],
  };
}
