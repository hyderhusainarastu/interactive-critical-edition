import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { processingRuns, textBlocks } from "./editionPipeline";
import {
  authorApparatusKindEnum,
  ragChunkSourceEnum,
  ragConversationStatusEnum,
  ragMessageRoleEnum,
} from "./enums";
import { researchClaims } from "./researchClaims";
import { researchResourceContents } from "./researchResources";
import { documents, works } from "./works";

export const ragChunks = pgTable(
  "rag_chunk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    processingRunId: uuid("processing_run_id")
      .notNull()
      .references(() => processingRuns.id, { onDelete: "cascade" }),
    textBlockId: uuid("text_block_id").references(() => textBlocks.id, { onDelete: "set null" }),
    researchResourceContentId: uuid("research_resource_content_id").references((): AnyPgColumn => researchResourceContents.id, { onDelete: "cascade" }),
    sourceType: ragChunkSourceEnum("source_type").notNull(),
    /** Stable per-block/content key; makes reindexing and stale-row deletion deterministic. */
    sourceKey: text("source_key").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    /** Reader/source URL and page/block offsets; never a fabricated locator. */
    anchor: jsonb("anchor").notNull(),
    sourceUrl: text("source_url"),
    license: text("license"),
    embedding: jsonb("embedding"),
    embeddingModel: text("embedding_model"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("rag_chunk_user_idx").on(t.userId),
    index("rag_chunk_document_idx").on(t.documentId),
    index("rag_chunk_run_idx").on(t.processingRunId),
    index("rag_chunk_resource_content_idx").on(t.researchResourceContentId),
    uniqueIndex("rag_chunk_owner_source_hash_index_unique").on(t.userId, t.sourceKey, t.contentHash, t.chunkIndex),
    check(
      "rag_chunk_exactly_one_eligible_source",
      sql`(${t.sourceType} = 'uploaded' and ${t.textBlockId} is not null and ${t.researchResourceContentId} is null) or (${t.sourceType} = 'open_access' and ${t.researchResourceContentId} is not null and ${t.textBlockId} is null)`,
    ),
  ],
);

/** Persistent, owner-scoped conversations. Context work is optional guidance
 * for the UI only; retrieval remains explicitly scoped to the whole owner's
 * eligible Library rather than silently inventing a cross-user corpus. */
export const ragConversations = pgTable(
  "rag_conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contextWorkId: uuid("context_work_id").references(() => works.id, { onDelete: "set null" }),
    title: text("title").notNull().default("New conversation"),
    status: ragConversationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("rag_conversation_user_updated_idx").on(t.userId, t.updatedAt)],
);

/**
 * Phase 28.6 (migration 0044, plan §Schema "Integration migration"): which
 * Ask Library research mode produced this message. Plain `text` + a CHECK
 * (not a pgEnum) so the value set can widen alongside `@ice/rag`'s own mode
 * union without a separate enum-widening migration — the `researchClaims
 * .claimRole`/`confidence` precedent above. `NULL` means `socratic`
 * (back-compatible with every `rag_message` row written before this
 * migration, and with every future socratic-mode row too — `mode` is only
 * ever set to a non-null value for the four research modes). Mode is a
 * per-MESSAGE property (an assistant's answer, not the whole conversation),
 * since one conversation can freely mix modes turn to turn.
 */
export const ragMessages = pgTable(
  "rag_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => ragConversations.id, { onDelete: "cascade" }),
    role: ragMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    mode: text("mode"),
    model: text("model"),
    provider: text("provider"),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("rag_message_conversation_created_idx").on(t.conversationId, t.createdAt),
    check(
      "rag_message_mode_valid",
      sql`${t.mode} IS NULL OR ${t.mode} IN ('socratic', 'find_counterarguments', 'explain_disagreement', 'map_debate', 'find_support')`,
    ),
  ],
);

/** Each answer link is a foreign key to the exact retrieved chunk. If a work,
 * run, or licensed source is deleted, its chunks and answer citations are
 * deleted by the same cascade rather than leaving an orphaned location. */
export const ragMessageCitations = pgTable(
  "rag_message_citation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => ragMessages.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => ragChunks.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rag_message_citation_message_chunk_unique").on(t.messageId, t.chunkId),
    uniqueIndex("rag_message_citation_message_ordinal_unique").on(t.messageId, t.ordinal),
    index("rag_message_citation_chunk_idx").on(t.chunkId),
  ],
);

/**
 * Phase 28.6 (migration 0044): parallel to `rag_message_citation` above, but
 * for a research-mode answer's claim citations (`find_counterarguments`/
 * `find_support`/`explain_disagreement`/`map_debate` cite `research_claim`
 * rows via the CLAIM_N label, never a `rag_chunk`). A message can carry both
 * kinds of citation rows at once — nothing here supersedes the chunk table.
 */
export const ragMessageClaimCitations = pgTable(
  "rag_message_claim_citation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => ragMessages.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => researchClaims.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("rag_message_claim_citation_message_claim_unique").on(t.messageId, t.claimId),
    uniqueIndex("rag_message_claim_citation_message_ordinal_unique").on(t.messageId, t.ordinal),
    index("rag_message_claim_citation_claim_idx").on(t.claimId),
  ],
);

/**
 * Authorial footnotes/endnotes, extracted structurally and page-anchored.
 * `kind` distinguishes authorial (from the source document — NEVER to be
 * replaced by generated notes) from any future editorial kind. `source`
 * records how it was found (grobid structure vs regex fallback).
 */
export const docFootnotes = pgTable(
  "doc_footnote",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => processingRuns.id, { onDelete: "cascade" }),
    marker: text("marker").notNull(),
    // { pageIndex, quote, prefix, suffix } and/or { bbox } — same
    // text-fingerprint idea as highlights (plan §25 R3), page-scoped.
    pageAnchor: jsonb("page_anchor"),
    text: text("text").notNull(),
    kind: text("kind").notNull().default("authorial"),
    source: text("source").notNull().default("grobid"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("doc_footnote_run_idx").on(t.runId)],
);

export const documentApparatus = pgTable(
  "document_apparatus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => processingRuns.id, { onDelete: "cascade" }),
    textBlockId: uuid("text_block_id").references(() => textBlocks.id, { onDelete: "set null" }),
    kind: authorApparatusKindEnum("kind").notNull(),
    marker: text("marker"),
    text: text("text").notNull(),
    /** { pageIndex, blockOrder, sectionTitle? } or a citation heuristic scope. */
    scope: jsonb("scope"),
    source: text("source").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("document_apparatus_run_idx").on(t.runId),
    index("document_apparatus_kind_idx").on(t.runId, t.kind),
    index("document_apparatus_block_idx").on(t.textBlockId),
  ],
);

/**
 * Auto-resolved document metadata for a run, with the winning source and a
 * confidence. High confidence lets the pipeline auto-advance past the
 * manual metadata form (Phase 8 auto-advance); low confidence keeps the
 * review step. `authors` is a jsonb string array.
 */
export const docMetadata = pgTable("doc_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id")
    .notNull()
    .references(() => processingRuns.id, { onDelete: "cascade" }),
  title: text("title"),
  authors: jsonb("authors"),
  confidence: real("confidence").notNull().default(0),
  // "embedded" | "grobid" | "title-page" | "bibliographic" | "ai"
  source: text("source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("doc_metadata_run_unique").on(t.runId)]);
