import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { workIdentities } from "./conceptsIdentity";
import { textBlocks } from "./editionPipeline";

/**
 * Phase 2 scope: upload and library. `works`/`editions` here are a
 * deliberately simplified subset of the full plan §9 schema (no shared
 * canonical-work catalog, no separate `authors` table with graph edges —
 * that arrives with bibliographic-API integration in Phase 4). Every
 * upload in Phase 2 is a private, user-owned work; sharing/canonical
 * dedup is out of scope until there's a real bibliographic source to
 * dedup against.
 */

export const workTypeEnum = pgEnum("work_type", ["primary", "secondary"]);

export const processingStatusEnum = pgEnum("processing_status", [
  "uploaded",
  "processing",
  "needs_review",
  "ready",
  "failed",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

// Phase 4: scholarly-analysis lifecycle, tracked separately from text
// extraction so the reader stays usable while analysis runs (or fails).
export const analysisStatusEnum = pgEnum("analysis_status", [
  "not_started",
  "analyzing",
  "complete",
  "failed",
]);

export const works = pgTable("work", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  authorName: text("author_name"),
  workType: workTypeEnum("work_type").notNull().default("primary"),
  /**
   * The canonical identity this upload resolves to (plan §34.4 9.5),
   * set once a v3 run derives it from the work's own resolved title/author —
   * the same `deriveWorkIdentity` computation already used for cited
   * resources (migration 0014). Null until that first v3 analysis; a
   * work analyzed only under v2 has no Library presence yet.
   */
  workIdentityId: uuid("work_identity_id").references((): AnyPgColumn => workIdentities.id, { onDelete: "set null" }),
  /**
   * Soft-delete marker (plan §34.4 9.7: "30-day work trash with restore and
   * idempotent purge"). Null = not trashed. Non-null = trashed as of this
   * timestamp; a work older than 30 days past this becomes eligible for
   * permanent purge. Deliberately NOT a hard delete — deleting a `work` row
   * cascades through nearly the entire per-document pipeline (document,
   * every reader/analysis table, reading_record/understanding_rating/
   * roadmap_override), so an accidental or regretted delete needs a
   * recovery window before that cascade actually runs.
   */
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("work_user_idx").on(t.userId),
  index("work_identity_idx").on(t.workIdentityId),
  index("work_deleted_at_idx").on(t.deletedAt),
]);

export const editions = pgTable("edition", {
  id: uuid("id").primaryKey().defaultRandom(),
  workId: uuid("work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  editionLabel: text("edition_label"),
  translator: text("translator"),
  publisher: text("publisher"),
  year: integer("year"),
  isbn: text("isbn"),
  doi: text("doi"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const documents = pgTable("document", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  workId: uuid("work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  editionId: uuid("edition_id").references(() => editions.id, {
    onDelete: "set null",
  }),
  storagePath: text("storage_path").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  /** SHA-256 of the verified stored bytes; used only for duplicate detection. */
  contentHash: text("content_hash"),
  processingStatus: processingStatusEnum("processing_status")
    .notNull()
    .default("uploaded"),
  // Raw extracted text, Phase 2 scope. Structured passages/chapters
  // (plan §9) arrive in Phase 3 when the reader needs positional data,
  // not just full text.
  extractedText: text("extracted_text"),
  extractedTitle: text("extracted_title"),
  extractedAuthor: text("extracted_author"),
  processingError: text("processing_error"),
  /**
   * Phase 3: { kind: "pdf", page: number } | { kind: "text", paragraphIndex: number }.
   * Documents are already 1:1 user-owned in this simplified schema (see
   * Phase 2 note above), so reading position lives directly on the row
   * rather than a separate per-user join table — one fewer table for
   * something that can only ever have one reader.
   */
  lastPosition: jsonb("last_position"),
  // Phase 4 scholarly-analysis state (independent of processingStatus).
  analysisStatus: analysisStatusEnum("analysis_status").notNull().default("not_started"),
  analysisError: text("analysis_error"),
  /**
   * Phase 20.8 (D-20-52): set once, at POST /api/works/[workId]/confirm — the
   * durable fact of a real user metadata confirmation, distinct from the
   * mutable `processingStatus` proxy the worker's `autoReady` used to rely on
   * alone (a run merely reaching "published" once is not the same fact as
   * "the user confirmed this"). Nullable/additive; never cleared once set.
   */
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("document_work_idx").on(t.workId),
  index("document_user_idx").on(t.userId),
  index("document_user_content_hash_idx").on(t.userId, t.contentHash),
]);

export const processingJobs = pgTable("processing_job", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  jobType: text("job_type").notNull(),
  status: jobStatusEnum("status").notNull().default("pending"),
  error: text("error"),
  attempts: integer("attempts").notNull().default(0),
  pgBossJobId: text("pg_boss_job_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("processing_job_document_idx").on(t.documentId)]);

/**
 * Phase 3 scope: the reader. `footnotes` are heuristically detected at
 * ingestion time for text/markdown documents only (regex-based marker +
 * trailing numbered-list detection — see apps/worker; a documented
 * limitation, not full layout-aware footnote extraction). PDF footnote
 * detection is deferred — text-layer extraction alone doesn't reliably
 * distinguish body text from page-bottom notes without positional data.
 *
 * `highlights`/`bookmarks` anchor by stable quote + prefix/suffix
 * context (a text-fingerprint approach, plan §25 risk R3), not raw
 * page/pixel coordinates — `anchor`/`position` shapes:
 *   PDF:  { kind: "pdf", page, quote, prefix, suffix }
 *   text: { kind: "text", paragraphIndex, quote, prefix, suffix }
 */

export const footnotes = pgTable("footnote", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  marker: text("marker").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("footnote_document_idx").on(t.documentId)]);

export const highlights = pgTable("highlight", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  anchor: jsonb("anchor").notNull(),
  color: text("color").notNull().default("gold"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("highlight_document_idx").on(t.documentId)]);

export const notes = pgTable("note", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  highlightId: uuid("highlight_id").references(() => highlights.id, {
    onDelete: "cascade",
  }),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("note_document_idx").on(t.documentId)]);

/**
 * Phase 12.4: notes can explain more than one selected passage and a passage
 * can be discussed by more than one note. `note.highlight_id` remains during
 * the rollout as a compatibility pointer for older clients; this join table
 * is the canonical relationship for new reader interactions.
 */
export const noteHighlights = pgTable(
  "note_highlight",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    highlightId: uuid("highlight_id")
      .notNull()
      .references(() => highlights.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("note_highlight_unique").on(t.noteId, t.highlightId),
    index("note_highlight_highlight_idx").on(t.highlightId),
  ],
);

/** A suggested pair never changes reading text until a person verifies it. */
export const termVerificationStatusEnum = pgEnum("term_verification_status", ["suggested", "verified"]);

export const termVariants = pgTable(
  "term_variant",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    originalScript: text("original_script").notNull(),
    transliteration: text("transliteration").notNull(),
    language: text("language").notNull(),
    direction: text("direction").notNull().default("ltr"),
    verificationStatus: termVerificationStatusEnum("verification_status").notNull().default("suggested"),
    source: text("source").notNull().default("system"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("term_variant_document_idx").on(t.documentId),
    index("term_variant_status_idx").on(t.documentId, t.verificationStatus),
    uniqueIndex("term_variant_document_pair_unique").on(t.documentId, t.originalScript, t.transliteration),
  ],
);

/** Exact processed-text offsets let verified terms render without touching PDFs. */
export const termOccurrences = pgTable(
  "term_occurrence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termVariantId: uuid("term_variant_id")
      .notNull()
      .references(() => termVariants.id, { onDelete: "cascade" }),
    textBlockId: uuid("text_block_id")
      .notNull()
      .references(() => textBlocks.id, { onDelete: "cascade" }),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("term_occurrence_block_idx").on(t.textBlockId),
    uniqueIndex("term_occurrence_unique").on(t.termVariantId, t.textBlockId, t.startOffset, t.endOffset),
    check("term_occurrence_offsets_valid", sql`${t.startOffset} >= 0 AND ${t.endOffset} > ${t.startOffset}`),
  ],
);

export const bookmarks = pgTable("bookmark", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  position: jsonb("position").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("bookmark_document_idx").on(t.documentId)]);
