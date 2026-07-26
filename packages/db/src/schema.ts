import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Phase 1 scope only: auth tables. Shape follows the @auth/drizzle-adapter
 * Postgres convention (accounts/sessions/verificationTokens) so Auth.js
 * works with minimal glue and OAuth providers can be added later (plan §14)
 * without a schema change. `passwordHash` extends the standard user table
 * for the Credentials provider (plan §14).
 *
 * The full domain schema (works, annotations, graph_edges, etc. — plan §9)
 * rolls in incrementally in later phases via their own migrations, not
 * all at once here.
 */

/**
 * Phase 9 reader levels (plan §34.4). Four, replacing the three-level
 * `preferences.expertise` vocabulary rather than sitting beside it:
 * `intermediate` maps to `undergraduate`. Declared here because `users`
 * references it below and pgEnum values are read at table-definition time.
 */
export const readerLevelEnum = pgEnum("reader_level", [
  "beginner",
  "undergraduate",
  "advanced",
  "research",
]);

export const users = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  /**
   * Auth.js v5's Credentials provider requires the JWT session strategy —
   * database sessions only auto-wire for OAuth-style adapter flows (plan
   * §14 assumed DB sessions; this is a recorded deviation, see docs/PROJECT-LOG.md).
   * Incrementing this invalidates every outstanding JWT for the user
   * (checked in the `jwt` callback), giving server-side "sign out
   * everywhere" / revocation-on-deletion without needing DB sessions.
   */
  sessionVersion: integer("session_version").notNull().default(0),
  /**
   * Phase 6: user preferences (plan §9). Currently { expertise?:
   * "beginner"|"intermediate"|"advanced", onboardedAt?: string } — the
   * onboarding-completion marker and the default expertise the roadmap
   * uses. jsonb so more preferences can be added without a migration.
   */
  preferences: jsonb("preferences"),
  /**
   * Phase 9: the reader's level, promoted out of the `preferences` jsonb into
   * a typed column with FOUR levels (plan §34.4 9.4). Migration `0015`
   * backfills it from `preferences.expertise`, mapping the old three-level
   * vocabulary (`intermediate` → `undergraduate`); the jsonb key is left in
   * place until 9.4 moves the readers over, so 9.1 changes no behaviour.
   *
   * Null means "not chosen" — the caller applies its own default rather than
   * this column pretending the user picked something. The level only ever
   * changes what opens by DEFAULT, never what is reachable.
   */
  readerLevel: readerLevelEnum("reader_level"),
  /**
   * Workstream G (v.5): explicit, unchecked-by-default opt-in for the
   * research-sharing described on the privacy page. Defaults false so
   * every pre-existing account stays opted out until they choose otherwise.
   */
  dataSharingEnabled: boolean("data_sharing_enabled").notNull().default(false),
  /**
   * Signup consent timestamp. Null means "pre-checkbox account" — the
   * consent flow shipped after this user already existed, not that they
   * declined; never backfilled, since there is nothing honest to backfill it
   * with.
   */
  policyAcceptedAt: timestamp("policy_accepted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const accounts = pgTable(
  "account",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    // @auth/drizzle-adapter's AdapterAccount type requires these specific
    // snake_case JS keys (matching OAuth2 spec field names) — DB column
    // names are unaffected, so this needed no new migration.
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

export const passwordResetTokens = pgTable(
  "password_reset_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
    used: boolean("used").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

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

/**
 * Phase 4 scope: scholarly analysis (plan §9/§11/§12). Still a
 * deliberately focused subset of plan §9 — no separate `authors`/
 * `concepts` catalog tables yet; a resolved external work lives in
 * `bibliographicRecords`, and an annotation's target is either such a
 * record (`targetBibId`) or a free-text label (`targetLabel`, for an
 * unresolved citation or a concept/tradition with no record). The
 * generic `graphEdges` table (plan §9) is populated here so Phase 5's
 * roadmap traversal has data; it isn't read by anything in Phase 4.
 */

// The 10 required relationship categories (plan §5/§12), verbatim.
export const relationshipCategoryEnum = pgEnum("relationship_category", [
  "explicit_reference",
  "secondary_scholarly_recommendation",
  "historical_context",
  "prerequisite",
  "conceptual_influence",
  "disagreement_polemical_target",
  "interpretive_aid",
  "parallel_comparison",
  "optional_extension",
  "ai_inferred",
]);

// plan §12: users can approve/reject/edit/hide any AI annotation; this
// is the lifecycle field that persists those decisions.
export const verificationStatusEnum = pgEnum("verification_status", [
  "unreviewed",
  "user_verified",
  "source_verified",
  "disputed",
  "rejected",
]);

// Where an annotation/edge came from — never silently blurred (plan §12).
export const provenanceEnum = pgEnum("provenance_source", ["system", "user", "editor"]);

// plan §11 §15: access state of a referenced work, so the UI can show
// "not accessible; consider legitimate acquisition" rather than pretend
// it has the text.
export const accessStatusEnum = pgEnum("access_status", [
  "open",
  "subscription",
  "metadata_only",
  "user_uploaded",
  "unavailable",
]);

// plan §9 graph edge_type vocabulary — a superset of the 10 annotation
// categories, since the graph also carries structural edges (translates,
// is_edition_of) the annotation layer doesn't surface.
export const edgeTypeEnum = pgEnum("edge_type", [
  "cites",
  "quotes",
  "influences",
  "criticizes",
  "responds_to",
  "presupposes",
  "provides_context_for",
  "interprets",
  "disagrees_with",
  "translates",
  "is_edition_of",
  "is_prerequisite_for",
  "is_comparable_to",
  "is_recommended_by",
]);

export const bibliographicRecords = pgTable("bibliographic_record", {
  id: uuid("id").primaryKey().defaultRandom(),
  // "unresolved" when no external source matched — the citation is kept
  // as-is rather than dropped or guessed (plan §10 step 7).
  source: text("source").notNull(),
  externalId: text("external_id"),
  title: text("title").notNull(),
  authors: text("authors"),
  year: integer("year"),
  doi: text("doi"),
  url: text("url"),
  accessStatus: accessStatusEnum("access_status").notNull().default("metadata_only"),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Where a work was cited in the uploaded source, never inferred from lookup metadata. */
export const citationSourceTypeEnum = pgEnum("citation_source_type", ["bibliography", "footnote", "endnote", "inline"]);
export const citationResolutionStateEnum = pgEnum("citation_resolution_state", ["pending", "resolved", "unresolved"]);

export const citations = pgTable("citation", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  processingRunId: uuid("processing_run_id").references(() => processingRuns.id, { onDelete: "cascade" }),
  textBlockId: uuid("text_block_id").references(() => textBlocks.id, { onDelete: "set null" }),
  rawText: text("raw_text").notNull(),
  normalizedQuery: text("normalized_query").notNull(),
  sourceType: citationSourceTypeEnum("source_type").notNull().default("inline"),
  parserConfidence: real("parser_confidence").notNull().default(0),
  /** { pageIndex, blockOrder, marker, startOffset, endOffset }. */
  sourceAnchor: jsonb("source_anchor"),
  resolvedBibId: uuid("resolved_bib_id").references(() => bibliographicRecords.id, {
    onDelete: "set null",
  }),
  // "crossref" | "openalex" | "openlibrary" | "unresolved"
  resolutionSource: text("resolution_source").notNull().default("unresolved"),
  resolutionState: citationResolutionStateEnum("resolution_state").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("citation_document_idx").on(t.documentId),
  index("citation_run_idx").on(t.processingRunId),
  index("citation_block_idx").on(t.textBlockId),
  index("citation_source_type_idx").on(t.sourceType),
]);

export const annotations = pgTable("annotation", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  relationshipCategory: relationshipCategoryEnum("relationship_category").notNull(),
  // Exactly one target is meaningful: a resolved record OR a free-text
  // label (unresolved citation / concept / tradition). Not enforced by a
  // CHECK here since a label is always set as a human-readable fallback.
  targetBibId: uuid("target_bib_id").references(() => bibliographicRecords.id, {
    onDelete: "set null",
  }),
  targetLabel: text("target_label").notNull(),
  /**
   * Same text-fingerprint shape as `highlights.anchor` (quote + prefix +
   * suffix, per plan §25 R3) so the reader can re-locate the triggering
   * passage across re-render/reflow. Nullable for a work-level annotation
   * with no single anchoring passage.
   */
  anchor: jsonb("anchor"),
  // The verbatim passage that triggered this — never paraphrased away
  // (plan §12 "preserve the extracted source text").
  extractedSourceText: text("extracted_source_text"),
  explanation: text("explanation").notNull(),
  // 0..1, always shown in the UI, never hidden (plan §12).
  confidence: real("confidence").notNull(),
  // Provenance (plan §12): for AI annotations, which model + prompt
  // version produced it; null for user-created ones.
  modelUsed: text("model_used"),
  promptVersion: text("prompt_version"),
  createdBy: provenanceEnum("created_by").notNull().default("system"),
  verificationStatus: verificationStatusEnum("verification_status")
    .notNull()
    .default("unreviewed"),
  hidden: boolean("hidden").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("annotation_document_idx").on(t.documentId)]);

/**
 * Generic typed edge table (plan §9) — a lightweight polymorphic graph
 * over the relational core, not a separate graph DB. `sourceType`/
 * `targetType` are discriminators ("work" | "bibliographic_record" |
 * "concept"); traversal is a recursive CTE in Phase 5. Per-user so each
 * reader's graph is their own (plan §9 "unique to each user").
 */
export const graphEdges = pgTable("graph_edge", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id").notNull(),
  edgeType: edgeTypeEnum("edge_type").notNull(),
  weight: real("weight").notNull().default(1),
  confidence: real("confidence").notNull().default(0.5),
  evidence: jsonb("evidence"),
  verificationStatus: verificationStatusEnum("verification_status")
    .notNull()
    .default("unreviewed"),
  createdBy: provenanceEnum("created_by").notNull().default("system"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("graph_edge_source_idx").on(t.userId, t.sourceId),
  index("graph_edge_target_idx").on(t.userId, t.targetId),
]);

/**
 * plan §11/§22: every AI call logged with token counts and an estimated
 * cost, feeding the admin cost dashboard (Phase 7). Written by the worker
 * on each provider call — including the heuristic fallback (recorded with
 * zero cost and model "heuristic-fallback"), so the log is complete and
 * honest about which annotations were real-AI vs. deterministic-stub.
 */
export const aiUsageLogs = pgTable("ai_usage_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").references(() => documents.id, {
    onDelete: "set null",
  }),
  // processingRuns is declared later in this incrementally-grown schema;
  // the database FK is supplied by migration 0010.
  runId: uuid("run_id"),
  /**
   * Phase 25.6: the research engine's jobs are NOT document-scoped (a project
   * spans works, corpus items and conversations), so neither `documentId` nor
   * `runId` can attribute their spend. `ON DELETE set null` matches
   * `documentId`'s precedent above: usage/cost history outlives the request it
   * paid for (plan §22), so a deleted request nulls the link rather than
   * destroying the ledger row. Forward reference — `researchJobRequests` is
   * declared at the end of this incrementally-grown file.
   */
  researchRequestId: uuid("research_request_id").references((): AnyPgColumn => researchJobRequests.id, {
    onDelete: "set null",
  }),
  task: text("task").notNull(),
  stage: text("stage"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // The research job runner seeds its budget by summing this table for its own
  // request id (the `analyze.ts` idiom), so this is a hot read, not reporting.
  index("ai_usage_log_research_request_idx").on(t.researchRequestId),
]);

/**
 * Phase 5 scope: reading roadmap + knowledge profile (plan §7/§13).
 *
 * The roadmap itself is computed on demand (a graph traversal over
 * `graphEdges` + a ranking pass — fast, no AI), NOT stored as a snapshot:
 * a persisted `reading_roadmaps`/`roadmap_items` pair (plan §9's literal
 * shape) would drift the moment analysis re-runs or a rating changes. So
 * only the durable, user-authored state lives here — the knowledge
 * profile (`readingRecords`, `understandingRatings`) and manual roadmap
 * adjustments (`roadmapOverrides`) — and the roadmap is recomputed from
 * those each request (recalculation-respects-overrides falls out for
 * free). A recorded deviation from plan §9, same spirit as prior phases.
 *
 * A "target" throughout is either the user's own uploaded `work` or a
 * referenced `bibliographicRecord` (a recommended reading not necessarily
 * in the library) — exactly one of the two id columns is set on each row.
 */

export const readingStatusEnum = pgEnum("reading_status", [
  "planned",
  "reading",
  "completed",
  "abandoned",
]);

// plan §13 priority tiers, in ranked order (essential highest).
export const priorityTierEnum = pgEnum("priority_tier", [
  "essential",
  "high",
  "strongly_recommended",
  "contextual",
  "interpretive_aid",
  "comparative",
  "optional",
]);

export const readingRecords = pgTable("reading_record", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
  bibId: uuid("bib_id").references(() => bibliographicRecords.id, { onDelete: "cascade" }),
  // Third polymorphic target (plan §34.4 9.5): a Library item that is neither
  // the reader's own upload nor a scholarly bibliographic record (a video, a
  // blog post, a lecture). Exactly one of the three is ever set — enforced
  // below by a DB CHECK, not just convention, same precedent as
  // `passage_annotation`'s anchor-or-whole-work constraint.
  learningResourceId: uuid("learning_resource_id").references((): AnyPgColumn => learningResources.id, { onDelete: "cascade" }),
  status: readingStatusEnum("status").notNull().default("planned"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("reading_record_user_idx").on(t.userId),
  index("reading_record_learning_resource_idx").on(t.learningResourceId),
  check(
    "reading_record_exactly_one_target",
    sql`(
      (case when ${t.workId} is null then 0 else 1 end) +
      (case when ${t.bibId} is null then 0 else 1 end) +
      (case when ${t.learningResourceId} is null then 0 else 1 end)
    ) = 1`,
  ),
]);

/**
 * Where a mastery score came from. Phase 9.4's precedence is explicit rating →
 * diagnostic → inference from completed prerequisites (weak evidence only) →
 * the reader's global level, and precedence is only enforceable if the source
 * is recorded rather than inferred back from the number. Hoisted above
 * `understandingRatings` (sub-phase 22.9b, plan §3.6) since that table now
 * also reuses this enum inline, and — unlike the lazy `AnyPgColumn` forward
 * references used elsewhere in this file for as-yet-undeclared TABLES — a
 * `pgEnum` handle is called directly inside the column definition, so it
 * must already exist at module-evaluation time, not just by the time a
 * query runs.
 */
export const masterySourceEnum = pgEnum("mastery_source", [
  "explicit",
  "diagnostic",
  "inferred",
]);

export const understandingRatings = pgTable("understanding_rating", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
  bibId: uuid("bib_id").references(() => bibliographicRecords.id, { onDelete: "cascade" }),
  // Third polymorphic target (plan §34.4 9.5) — see `readingRecords` above.
  learningResourceId: uuid("learning_resource_id").references((): AnyPgColumn => learningResources.id, { onDelete: "cascade" }),
  // 0..100 with a derived label in the UI (plan §7). >= 60 = "working
  // understanding" → the roadmap deprioritizes it (personalization pass).
  score: integer("score").notNull(),
  // Sub-phase 22.9b (plan §3.2/§3.6): reuses `mastery_source` (declared
  // below, forward-referenced the same way `learningResources` is above) so
  // a chat-inferred rating is precedence-guarded exactly like
  // `concept_mastery.source` — a NOT NULL DEFAULT keeps this additive: every
  // pre-existing row is truthfully backfilled as `explicit` (every writer
  // that existed before this column was a real user action).
  source: masterySourceEnum("source").notNull().default("explicit"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("understanding_rating_user_idx").on(t.userId),
  index("understanding_rating_learning_resource_idx").on(t.learningResourceId),
  check(
    "understanding_rating_exactly_one_target",
    sql`(
      (case when ${t.workId} is null then 0 else 1 end) +
      (case when ${t.bibId} is null then 0 else 1 end) +
      (case when ${t.learningResourceId} is null then 0 else 1 end)
    ) = 1`,
  ),
]);

/**
 * Per-user, per-root-work manual adjustments applied on top of the
 * computed roadmap (plan §13 step 7): hide an item, pin it to a tier, or
 * reorder it. `manualTier`/`manualPosition` are null unless the user set
 * them. A row can also represent a manually *added* target that the auto
 * roadmap didn't surface (`addedManually`).
 */
export const roadmapOverrides = pgTable("roadmap_override", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  rootWorkId: uuid("root_work_id")
    .notNull()
    .references(() => works.id, { onDelete: "cascade" }),
  bibId: uuid("bib_id")
    .notNull()
    .references(() => bibliographicRecords.id, { onDelete: "cascade" }),
  hidden: boolean("hidden").notNull().default(false),
  manualTier: priorityTierEnum("manual_tier"),
  manualPosition: integer("manual_position"),
  addedManually: boolean("added_manually").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("roadmap_override_root_idx").on(t.userId, t.rootWorkId)]);

/**
 * Phase 8 scope (Critical Edition Recovery): a VERSIONED, page-aware,
 * structure-preserving document-processing model (plan §33). Each
 * (re)processing attempt is a `processing_run`; only the run marked
 * `is_published = true` is read by the reader/edition UI. A failed
 * reprocess never touches the previously published run, which fixes the
 * Phase 4 "delete-before-success" defect (analyzeWork used to delete the
 * live analysis at the START of a run). Legacy Phase 2–5 tables
 * (`documents.extracted_text`, `annotations`, …) are untouched and remain
 * the fallback until a work has a published v2 run.
 */

export const processingRunStatusEnum = pgEnum("processing_run_status", [
  "pending",
  "running",
  "complete",
  "failed",
]);

// Whether the run has structured TEI semantics or the deliberately honest
// PDF.js fallback. This is distinct from success: a structure-limited run is
// still safe to publish and render, it simply cannot claim GROBID-level
// sections, references, or coordinates.
export const structureStateEnum = pgEnum("structure_state", ["full", "limited"]);

// Structural role of an extracted text block (from GROBID TEI / pdf.js).
export const textBlockKindEnum = pgEnum("text_block_kind", [
  "title",
  "header",
  "body",
  "footer",
  "footnote",
  "endnote",
  "caption",
  "bibliography",
  "reference",
]);

export const processingRuns = pgTable(
  "processing_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    // Monotonic per document; the highest published one is "current".
    version: integer("version").notNull().default(1),
    pipelineVersion: text("pipeline_version").notNull().default("v2"),
    status: processingRunStatusEnum("status").notNull().default("pending"),
    structureState: structureStateEnum("structure_state").notNull().default("limited"),
    // Human-readable current stage for live progress (e.g. "extracting",
    // "scholarly-discovery", "note-synthesis").
    stage: text("stage"),
    // Per-source position while `stage` is inside the up-to-120-source
    // discovery/classification loop (e.g. "credibility" set once per
    // discovered source) — lets the UI show "source 3 of 12" instead of
    // un-ticking and re-ticking the same three checklist steps once per
    // source. Null whenever `stage` is not inside that loop.
    stageSourceIndex: integer("stage_source_index"),
    stageSourceTotal: integer("stage_source_total"),
    // Only ONE published run per document at a time (enforced in app logic
    // on publish); the reader/edition reads exclusively the published run.
    isPublished: boolean("is_published").notNull().default(false),
    // "structure-limited" etc. degradation notes, and failure messages.
    note: text("note"),
    error: text("error"),
    // Running total of estimated AI spend for this run (plan §33: $2 soft /
    // $5 hard cap enforced by the pipeline). Surfaced in the edition response
    // and admin dashboard. Authoritative per-call rows live in ai_usage_log.
    aiCostUsd: real("ai_cost_usd").notNull().default(0),
    // True when the run fell back below its intended quality (OCR unavailable,
    // GROBID structure-limited, a research cap hit). Distinct from `failed`.
    degraded: boolean("degraded").notNull().default(false),
    // Deterministic reason research stopped early (saturation rule / cost cap).
    saturationNote: text("saturation_note"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("processing_run_document_idx").on(t.documentId),
    index("processing_run_published_idx").on(t.documentId, t.isPublished),
    uniqueIndex("processing_run_document_version_unique").on(t.documentId, t.version),
    // At most one published run per document. Created by migration 0009 in the
    // DB; declared here so drizzle's snapshot matches reality (plan 1.2). The
    // transactional publish step relies on this partial unique to make
    // "exactly one live edition" a database invariant, not just app logic.
    uniqueIndex("processing_run_one_published_per_document")
      .on(t.documentId)
      .where(sql`${t.isPublished}`),
  ],
);

export const pages = pgTable(
  "page",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => processingRuns.id, { onDelete: "cascade" }),
    pageIndex: integer("page_index").notNull(), // 0-based
    width: real("width"),
    height: real("height"),
    // Supabase Storage path for the rasterized page image (reader render).
    imagePath: text("image_path"),
    // True when this page's text came from OCR (scanned), not a text layer.
    isOcr: boolean("is_ocr").notNull().default(false),
    extractionConfidence: real("extraction_confidence"),
    text: text("text"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("page_run_idx").on(t.runId, t.pageIndex)],
);

export const textBlocks = pgTable(
  "text_block",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    blockOrder: integer("block_order").notNull(),
    kind: textBlockKindEnum("kind").notNull().default("body"),
    // { x, y, w, h } in page coordinate space, when available (GROBID coords).
    bbox: jsonb("bbox"),
    // Source marker for an apparatus block (for example footnote "12").
    // Keeping it on the block makes the page/block anchor self-contained.
    marker: text("marker"),
    text: text("text").notNull(),
    confidence: real("confidence"),
  },
  (t) => [index("text_block_page_idx").on(t.pageId, t.blockOrder)],
);

/**
 * Migration 0036 (Workstream D completion, `docs/handoffs/workstream-d.md`
 * L35-97). A foreign-script span is detected deterministically at
 * block-insert time (`apps/worker/src/foreignSpans.ts`, script-range
 * matching — never a model guess) and optionally translated/transliterated
 * by a cheap-tier model between analysis and publication
 * (`apps/worker/src/foreignText.ts`'s `processForeignText`). `sourceText` is
 * the exact stored block substring — mojibake bytes for a `recovered` row —
 * while `originalText` is the real original-script text, which differs from
 * `sourceText` only for a labelled PDF glyph-mapping recovery
 * (`packages/ingestion/src/pdfGlyphRecovery.ts`). A row never rewrites its
 * block's bytes; the reader recomputes untranscribable markers on read and
 * drops any that overlap a resolved `recovered` span here (else the
 * "untranscribable" chip would shadow the recovered Greek).
 */
export const foreignScriptEnum = pgEnum("foreign_script", ["greek", "hebrew", "arabic", "cyrillic", "cjk"]);
export const foreignLanguageBasisEnum = pgEnum("foreign_language_basis", [
  "script_range",
  "model_validated",
  "human_verified",
]);
export const foreignDirectionEnum = pgEnum("foreign_direction", ["ltr", "rtl"]);
export const foreignSpanProvenanceKindEnum = pgEnum("foreign_span_provenance_kind", [
  "source_text",
  "ocr_recovery",
  "pdf_glyph_recovery",
  "manual",
]);
export const foreignTranscriptionStatusEnum = pgEnum("foreign_transcription_status", ["legitimate", "recovered"]);
export const foreignSpanStatusEnum = pgEnum("foreign_span_status", ["pending", "resolved", "deferred"]);
export const foreignSpanDeferredReasonEnum = pgEnum("foreign_span_deferred_reason", [
  "provider_unavailable",
  "budget_exhausted",
  "invalid_model_response",
  "batch_limit",
]);

export const foreignSpans = pgTable(
  "foreign_span",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => processingRuns.id, { onDelete: "cascade" }),
    textBlockId: uuid("text_block_id")
      .notNull()
      .references(() => textBlocks.id, { onDelete: "cascade" }),
    /** Exact stored block substring; mojibake bytes for a `recovered` row. */
    sourceText: text("source_text").notNull(),
    /** Original-script text; equals `sourceText` unless recovered. */
    originalText: text("original_text").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    /** Quote-fingerprint context, same idea as highlight anchors. */
    prefix: text("prefix").notNull().default(""),
    suffix: text("suffix").notNull().default(""),
    script: foreignScriptEnum("script").notNull(),
    /** Script-derived hint only; not a language identification. */
    languageHint: text("language_hint").notNull(),
    /** Nullable until a validated translation resolves the real language. */
    languageCode: text("language_code"),
    languageLabel: text("language_label"),
    languageBasis: foreignLanguageBasisEnum("language_basis").notNull().default("script_range"),
    direction: foreignDirectionEnum("direction").notNull(),
    sourceProvenanceKind: foreignSpanProvenanceKindEnum("source_provenance_kind").notNull(),
    /** Reader-facing, factual description of how this exact text was obtained. */
    sourceProvenanceLabel: text("source_provenance_label").notNull(),
    /** Confidence in the transcription, not in any later translation. */
    sourceConfidence: real("source_confidence").notNull(),
    transcriptionStatus: foreignTranscriptionStatusEnum("transcription_status").notNull().default("legitimate"),
    transliteration: text("transliteration"),
    translation: text("translation"),
    /** Nullable until resolved; `"machine_translation"` for this worker. */
    translationProvenance: text("translation_provenance"),
    provider: text("provider"),
    model: text("model"),
    promptVersion: text("prompt_version"),
    /** 64-char SHA-256 content key; set only once a translation resolves. */
    cacheKey: text("cache_key"),
    status: foreignSpanStatusEnum("status").notNull().default("pending"),
    deferredReason: foreignSpanDeferredReasonEnum("deferred_reason"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("foreign_span_user_idx").on(t.userId),
    index("foreign_span_document_idx").on(t.documentId),
    index("foreign_span_block_idx").on(t.textBlockId),
    // Pending-batch lookup (`findPending`, ordered (textBlockId, startOffset)
    // within a run).
    index("foreign_span_status_run_idx").on(t.status, t.runId),
    // Cross-run cache reuse (`getCached`) — NOT unique: many legitimately
    // resolved occurrences of the same passage share one cache key.
    index("foreign_span_cache_key_resolved_idx").on(t.cacheKey).where(sql`${t.status} = 'resolved'`),
    // Owner-required identity constraint (workstream-d.md handoff L35-97):
    // idempotent re-insertion at block-insert time keys on the exact stored
    // substring. Must not be weakened or omitted.
    uniqueIndex("foreign_span_document_block_source_unique").on(t.documentId, t.textBlockId, t.sourceText),
    // Richer proposed uniqueness, kept IN ADDITION per the handoff — a
    // recovered row can share `sourceText` with a legitimate one at a
    // different offset within the same block.
    uniqueIndex("foreign_span_run_block_offsets_unique").on(t.runId, t.textBlockId, t.startOffset, t.endOffset),
    check("foreign_span_offsets_valid", sql`${t.startOffset} >= 0 AND ${t.endOffset} > ${t.startOffset}`),
    check("foreign_span_source_confidence_valid", sql`${t.sourceConfidence} >= 0 AND ${t.sourceConfidence} <= 1`),
  ],
);

/**
 * Phase 18: owner-scoped retrieval chunks. Uploaded source blocks and
 * explicitly licensed open-access research content are deliberately kept in
 * one narrow index with a durable owner id, a stable source key, and a
 * source-location anchor. Neither provider metadata nor unlicensed text is
 * eligible for this table.
 */
export const ragChunkSourceEnum = pgEnum("rag_chunk_source", ["uploaded", "open_access"]);

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

export const ragConversationStatusEnum = pgEnum("rag_conversation_status", ["active", "archived"]);
export const ragMessageRoleEnum = pgEnum("rag_message_role", ["user", "assistant"]);

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

/**
 * Phase 12.3: source-authored apparatus remains distinct from AI annotations.
 * It preserves the structural kind and real block/page scope so a reader can
 * filter footnotes, endnotes, bibliography entries, and citation blocks
 * independently without treating any of them as generated commentary.
 */
export const authorApparatusKindEnum = pgEnum("author_apparatus_kind", [
  "footnote",
  "endnote",
  "bibliography_entry",
  "citation_block",
]);

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

// Source authority band (plan §33): A (peer-reviewed / canonical primary) …
// E (anonymous / unverifiable). Popularity is never authority. A factual
// claim needs an A/B source or two independent C sources.
export const sourceAuthorityEnum = pgEnum("source_authority", ["A", "B", "C", "D", "E"]);

// Deterministic agreement label across a claim's independent sources
// (plan §33): strong (≥3 independent supporting, no credible contradiction),
// contested (≥2 credible each side), mixed (support + contradiction below
// that threshold), otherwise insufficient.
export const agreementStateEnum = pgEnum("agreement_state", [
  "strong",
  "contested",
  "mixed",
  "insufficient",
]);

// Per-run outcome of querying one source provider (plan §33 §2.3). Every
// enabled/disabled provider records exactly one attempt per run so the
// admin dashboard and edition can prove what was and wasn't consulted.
export const providerAttemptStatusEnum = pgEnum("provider_attempt_status", [
  "queried",
  "unavailable",
  "rate_limited",
  "failed",
  "disabled",
]);

/**
 * How a discovered record relates to the WORK it belongs to. Record-level
 * dedup cannot collapse a book with a review of it — different DOI, different
 * title, different author — and should not: both are real records. But the
 * reader must see one Library entry per work, with reviews attached.
 */
export const recordRoleEnum = pgEnum("record_role", [
  "primary",
  "review",
  "edition",
  "translation",
  "excerpt",
]);

/** Phase 8 research is scoped to a processing run, so reprocessing can
 * publish atomically without deleting the last good edition. */
export const researchResources = pgTable("research_resource", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url"),
  resourceType: text("resource_type").notNull().default("bibliographic"),
  provider: text("provider").notNull(),
  accessStatus: text("access_status").notNull().default("metadata_only"),
  inspectionDepth: integer("inspection_depth").notNull().default(0),
  // Normalized identity for deduplication (plan §33): dedup by DOI, ISBN,
  // canonical URL, then normalized title/author/year. `normalizedKey` is the
  // computed winner used for the per-run unique constraint below.
  doi: text("doi"),
  isbn: text("isbn"),
  canonicalUrl: text("canonical_url"),
  normalizedKey: text("normalized_key"),
  year: integer("year"),
  authors: jsonb("authors"),
  // Set when a scholarly resource is projected into the shared catalogue on
  // publish (books/articles become bibliographic_records; videos/web/social
  // stay research-only). Enables graph + roadmap projection (plan §33 §3.2).
  bibRecordId: uuid("bib_record_id").references(() => bibliographicRecords.id, { onDelete: "set null" }),
  raw: jsonb("raw"),
  // Canonical WORK identity (as opposed to record identity above). Observed in
  // production: one cited book arrived as five correct records — the book, two
  // reviews, and two other editions. Grouping on these lets the Library show
  // the work once with its reviews attached. Phase 9 promotes this to a shared
  // `work_identity` table; run-scoped columns are the honest first step.
  workKey: text("work_key"),
  workRole: recordRoleEnum("work_role").notNull().default("primary"),
  workCanonicalTitle: text("work_canonical_title"),
  workAuthorSurname: text("work_author_surname"),
  /** Why this record was grouped as it was — a wrong grouping must be explainable. */
  workEvidence: text("work_evidence"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("research_resource_run_idx").on(t.runId),
  index("research_resource_work_idx").on(t.runId, t.workKey),
  uniqueIndex("research_resource_run_key_unique").on(t.runId, t.normalizedKey),
  // Plan §34.4 9.5: the Library's read-time credibility join looks up the
  // most recent research_resource row by normalizedKey (scoped further to
  // the same workKey in application code) — without this, that lookup is a
  // full table scan once history accumulates across runs.
  index("research_resource_normalized_key_idx").on(t.normalizedKey),
]);

/**
 * Phase 15's deliberately narrow full-text record. A discovered source stays
 * metadata-only unless the provider metadata contains a recognizable, explicit
 * open license; an accessible landing page by itself is not enough evidence to
 * copy or index its text. The text is separate from `research_resource.raw` so
 * provenance, deletion propagation, and future owner-scoped retrieval can be
 * reasoned about without treating provider metadata as content.
 */
export const researchResourceContentStatusEnum = pgEnum("research_resource_content_status", [
  "metadata_only",
  "open_access_available",
  "open_access_indexed",
  "retrieval_failed",
]);

export const researchResourceContents = pgTable("research_resource_content", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceId: uuid("resource_id")
    .notNull()
    .references(() => researchResources.id, { onDelete: "cascade" }),
  status: researchResourceContentStatusEnum("status").notNull().default("metadata_only"),
  /** Canonical full-text endpoint selected from explicit provider metadata. */
  sourceUrl: text("source_url"),
  /** Normalized human-readable license, for example `CC BY 4.0`. */
  license: text("license"),
  /** Exact provider fields used to decide the source was eligible. */
  licenseEvidence: jsonb("license_evidence"),
  /** Extracted text only when status is `open_access_indexed`. */
  text: text("text"),
  contentHash: text("content_hash"),
  retrievedAt: timestamp("retrieved_at"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("research_resource_content_resource_unique").on(t.resourceId),
  index("research_resource_content_status_idx").on(t.status),
]);

/** One row per (run, provider): the auditable evidence of which sources were
 * actually consulted, with query count, depth, latency and error (plan §33). */
export const providerAttempts = pgTable("provider_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  status: providerAttemptStatusEnum("status").notNull(),
  queries: jsonb("queries"),
  resultCount: integer("result_count").notNull().default(0),
  inspectionDepth: integer("inspection_depth").notNull().default(0),
  latencyMs: integer("latency_ms"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("provider_attempt_run_idx").on(t.runId)]);

export const resourceProvenance = pgTable("resource_provenance", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceId: uuid("resource_id").notNull().references(() => researchResources.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  query: text("query"),
  inspectedAt: timestamp("inspected_at"),
  inspectionDepth: integer("inspection_depth").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("resource_provenance_resource_idx").on(t.resourceId)]);

export const editionRelations = pgTable("edition_relation", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade" }),
  // `resourceId` is the relation's source (or the sole endpoint for a
  // work→resource relation). `relatedResourceId`, when set, makes this a
  // resource↔resource relation (plan §33 §3.1) — e.g. resource A influences B.
  resourceId: uuid("resource_id").references(() => researchResources.id, { onDelete: "set null" }),
  relatedResourceId: uuid("related_resource_id").references(() => researchResources.id, { onDelete: "set null" }),
  relationType: text("relation_type").notNull(),
  // Traversal depth from the primary work (0 = direct, up to 2 — plan §33).
  depth: integer("depth").notNull().default(0),
  // 0–1 ranking weight for roadmap prerequisite/context trees.
  importance: real("importance"),
  evidence: jsonb("evidence"),
  confidence: real("confidence").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("edition_relation_run_idx").on(t.runId)]);

// Credibility kept as independent components (plan §33): authority and
// popularity/agreement never collapse into one number. `score` remains an
// overall convenience roll-up; the components below are what the reader shows.
export const credibilityAssessments = pgTable("credibility_assessment", {
  id: uuid("id").primaryKey().defaultRandom(),
  resourceId: uuid("resource_id").notNull().references(() => researchResources.id, { onDelete: "cascade" }),
  score: real("score").notNull(),
  authority: sourceAuthorityEnum("authority"),
  relevance: real("relevance"),
  inspectionDepth: integer("inspection_depth").notNull().default(0),
  evidenceStrength: real("evidence_strength"),
  agreement: agreementStateEnum("agreement"),
  components: jsonb("components"),
  rationale: text("rationale"),
  // Phase 9.2: the remaining separated dimensions, as real columns rather than
  // buried in `components`, because the admin review and the reader-facing
  // labels both filter on them. They come apart in practice — an expert's
  // recorded lecture has high creator expertise and high pedagogical value with
  // NO publication rigor, and collapsing that into one number would quietly
  // make "not peer-reviewed" mean "not credible", which is false.
  publicationRigor: real("publication_rigor"),
  creatorExpertise: real("creator_expertise"),
  hostProvenance: real("host_provenance"),
  pedagogicalValue: real("pedagogical_value"),
  /** Identified creator + how well corroborated. Never asserted by an LLM. */
  creator: jsonb("creator"),
  /** Fact about the venue's process, not a verdict. Null means unknown, never "no". */
  peerReviewed: boolean("peer_reviewed"),
  /** Reported popularity with its unit. Displayed; never an input to any score. */
  popularity: jsonb("popularity"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("credibility_assessment_resource_unique").on(t.resourceId)]);

export const evidenceSpans = pgTable("evidence_span", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade" }),
  resourceId: uuid("resource_id").references(() => researchResources.id, { onDelete: "set null" }),
  pageAnchor: jsonb("page_anchor"),
  quote: text("quote").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("evidence_span_run_idx").on(t.runId)]);

export const generatedNotes = pgTable("generated_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade" }),
  evidenceSpanId: uuid("evidence_span_id").references(() => evidenceSpans.id, { onDelete: "set null" }),
  noteType: text("note_type").notNull().default("critical"),
  body: text("body").notNull(),
  confidence: real("confidence").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("generated_note_run_idx").on(t.runId)]);

/**
 * A single factual/interpretive claim carried by a generated note. Claims are
 * the unit the reader validates: each links to one or more evidence spans
 * (claim_evidence, many-to-many) and carries a deterministic agreement label.
 * A factual claim may only be published if its supporting evidence meets the
 * authority bar (plan §33) — enforced in the pipeline, recorded here.
 */
export const generatedClaims = pgTable("generated_claim", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade" }),
  noteId: uuid("note_id").references(() => generatedNotes.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  // "factual" | "interpretive" | "inferred" — factual needs the A/B (or 2×C)
  // authority bar; interpretive/inferred stay visibly uncertain.
  claimType: text("claim_type").notNull().default("interpretive"),
  agreement: agreementStateEnum("agreement").notNull().default("insufficient"),
  confidence: real("confidence").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("generated_claim_run_idx").on(t.runId),
  index("generated_claim_note_idx").on(t.noteId),
]);

/** Many-to-many: which evidence spans support (or contradict) a claim. */
export const claimEvidence = pgTable("claim_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").notNull().references(() => generatedClaims.id, { onDelete: "cascade" }),
  evidenceSpanId: uuid("evidence_span_id").notNull().references(() => evidenceSpans.id, { onDelete: "cascade" }),
  // "supports" | "contradicts" — the reader shows both sides (plan §33 §3.4).
  stance: text("stance").notNull().default("supports"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("claim_evidence_unique").on(t.claimId, t.evidenceSpanId)]);

/**
 * Normalized provider-result cache (plan §33): scholarly 30d / web+video 7d /
 * social 24h. Keyed by (provider, cache_key) where cache_key is a hash of the
 * normalized query set; `results` is a RawResource[] the worker rehydrates. Not
 * user-scoped — the cached metadata is public and shared across runs.
 */
export const researchCache = pgTable("research_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  cacheKey: text("cache_key").notNull(),
  results: jsonb("results").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("research_cache_provider_key_unique").on(t.provider, t.cacheKey),
  index("research_cache_expires_idx").on(t.expiresAt),
]);

// ---------------------------------------------------------------------------
// Phase 8 relevance closeout — candidate verdicts
// ---------------------------------------------------------------------------

/**
 * The lane that produced a candidate. Discovery is run per-lane so a candidate
 * is always judged against the question that surfaced it — "did Irwin cite
 * this?" and "is this a useful lecture?" are different bars, and collapsing
 * them is how unrelated material reaches a reader.
 */
export const queryLaneEnum = pgEnum("query_lane", [
  "explicit_citation",
  "primary_prerequisite",
  "historical_background",
  "concept_doctrine",
  "scholarly_debate",
  "author_corpus",
  "reception_citation",
  "parallel_literature",
  "lecture_course",
  "video_podcast",
  "blog_newsletter",
  "public_discussion",
]);

/**
 * Relevance verdict, assigned BEFORE any authority scoring. A DOI proves a
 * record exists; it never proves relevance, and popularity proves less still.
 *   accepted    — may project into annotations, Library, roadmap, and graph
 *   quarantined — research review only; never displayed to the reader
 *   rejected    — recorded with reasons, never projected anywhere
 */
export const candidateVerdictEnum = pgEnum("candidate_verdict", [
  "accepted",
  "quarantined",
  "rejected",
]);

/**
 * Every candidate discovery surfaced, with the evidence for its verdict. This
 * table is the audit trail: a wrong inclusion (or a wrong exclusion) must be
 * explainable after the fact, which means the signals behind the decision have
 * to be stored, not just the decision.
 *
 * Rejected and quarantined rows are kept deliberately — they are what the
 * gold-eval precision/recall gates are measured against, and deleting them
 * would make the pipeline unfalsifiable.
 */
export const researchCandidates = pgTable("research_candidate", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade" }),
  lane: queryLaneEnum("lane").notNull(),
  query: text("query"),
  provider: text("provider").notNull(),
  // Identity as discovered (before any projection).
  title: text("title").notNull(),
  authors: jsonb("authors"),
  year: integer("year"),
  doi: text("doi"),
  isbn: text("isbn"),
  canonicalUrl: text("canonical_url"),
  venue: text("venue"),
  // Same dedup identity as research_resource, so an accepted candidate maps
  // 1:1 onto the resource it becomes.
  normalizedKey: text("normalized_key"),
  verdict: candidateVerdictEnum("verdict").notNull(),
  confidence: real("confidence").notNull().default(0),
  /** Machine-readable reason codes (RelevanceReason[]) — never free prose. */
  reasons: jsonb("reasons"),
  /** Full RelevanceSignals: overlap, core matches, grounding, collisions. */
  signals: jsonb("signals"),
  /** False when the venue field is present but untrustworthy (mis-indexed
   *  catalogue records are common; we degrade the field, not the record). */
  venueReliable: boolean("venue_reliable").notNull().default(true),
  /** Set only for accepted candidates that were projected into a resource. */
  resourceId: uuid("resource_id").references(() => researchResources.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("research_candidate_run_idx").on(t.runId),
  index("research_candidate_verdict_idx").on(t.runId, t.verdict),
  index("research_candidate_lane_idx").on(t.runId, t.lane),
  // One verdict per (run, lane, identity): re-running a lane updates rather
  // than duplicating, so precision metrics stay meaningful.
  uniqueIndex("research_candidate_run_lane_key_unique").on(t.runId, t.lane, t.normalizedKey),
]);


/* ---------------------------------------------------------------------------
 * Phase 9 — Interactive Learning Workspace (plan §34)
 *
 * 9.1 lands the schema only: nothing writes to these tables yet. They exist
 * first so the pipeline (9.2), the reader (9.3–9.4), the Library (9.5) and the
 * curriculum (9.6) can all be built against one set of canonical identities
 * instead of each inventing its own.
 * ------------------------------------------------------------------------ */

/**
 * What a `concept` row IS. The graph the reader needs is not concepts alone —
 * a doctrine, the person who held it, the tradition it belongs to and the
 * debate it was argued in are all nodes a reader navigates between (plan
 * §34.4 9.7). One typed table beats five near-identical ones: the columns and
 * the mastery relationship are the same for all of them.
 */
export const conceptKindEnum = pgEnum("concept_kind", [
  "concept",
  "doctrine",
  "person",
  "tradition",
  "debate",
]);

/**
 * The shared vocabulary of things a reader can understand. Global and
 * append-only like `bibliographic_record`, not per-user: two readers studying
 * the same doctrine must land on the same node, or the graph and the
 * curriculum cannot agree with each other.
 */
export const concepts = pgTable("concept", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: conceptKindEnum("kind").notNull().default("concept"),
  /** Stable, human-readable identity (e.g. `akrasia`). Unique across kinds. */
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  summary: text("summary"),
  /** Surface forms that denote this same concept, for matching extracted text. */
  aliases: jsonb("aliases"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("concept_kind_idx").on(t.kind)]);

/**
 * A reader's understanding of one concept. Deliberately shaped like the
 * existing `understanding_rating` (0–100, ≥60 = known) so the roadmap's
 * established threshold means the same thing here.
 */
export const conceptMastery = pgTable("concept_mastery", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conceptId: uuid("concept_id").notNull().references(() => concepts.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  source: masterySourceEnum("source").notNull(),
  /** Why we believe this — a diagnostic answer, a completed prerequisite. */
  evidence: text("evidence"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("concept_mastery_user_idx").on(t.userId),
  uniqueIndex("concept_mastery_user_concept_unique").on(t.userId, t.conceptId),
]);

/**
 * Sub-phase 22.9b (plan §3.6): the Conversational Competency Designation
 * ledger. One row per applied write AND per precedence-skipped write
 * (`skipped_precedence`, kept honest but not surfaced) so the in-chat
 * notice, the undo route, and every provenance touch (Library slider
 * caption, diagnostic GET, graph inspector — the last deferred to 22.8)
 * share one source of truth. Mirrors the `understanding_rating`/
 * `reading_record` exactly-one-target CHECK precedent above, restricted to
 * the two target kinds chat can actually resolve a candidate for
 * (concept/work — bibliographic-record and learning-resource targets are
 * out of scope v1, plan §3.2).
 */
export const competencySignalStatusEnum = pgEnum("competency_signal_status", [
  "applied",
  "undone",
  "superseded",
  "skipped_precedence",
]);

export const competencySignals = pgTable("competency_signal", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => ragConversations.id, { onDelete: "set null" }),
  messageId: uuid("message_id").references(() => ragMessages.id, { onDelete: "set null" }),
  conceptId: uuid("concept_id").references(() => concepts.id, { onDelete: "cascade" }),
  workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
  // The enum level ("unfamiliar".."strong") the detector/model emitted —
  // kept as text here (like `graphEdges.sourceType`/`targetType` above)
  // since `@ice/rag`'s `CompetencyLevel` is the caller-side vocabulary, not
  // a second DB enum to keep in lockstep with it.
  level: text("level").notNull(),
  newScore: integer("new_score").notNull(),
  previousScore: integer("previous_score"),
  previousSource: masterySourceEnum("previous_source"),
  // Verbatim-quote basis string (§3.2) — never a paraphrase, so the in-chat
  // notice and the Library/diagnostic provenance lines can show the reader
  // their own words back, the same grounding discipline as
  // `annotations.extractedSourceText`.
  basis: text("basis").notNull(),
  // Honest label of which signal source produced this row —
  // "self-report-pattern" (the always-on deterministic detector) or the
  // gated model's identifier — mirroring the heuristic-classifier
  // provenance precedent (`annotations.promptVersion: "heuristic"`).
  detector: text("detector").notNull(),
  status: competencySignalStatusEnum("status").notNull().default("applied"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("competency_signal_user_idx").on(t.userId, t.createdAt),
  index("competency_signal_conversation_idx").on(t.conversationId),
  check(
    "competency_signal_exactly_one_target",
    sql`(
      (case when ${t.conceptId} is null then 0 else 1 end) +
      (case when ${t.workId} is null then 0 else 1 end)
    ) = 1`,
  ),
]);

/**
 * Canonical WORK identity, promoted out of the run-scoped
 * `research_resource.work_*` columns added in `0014`. Run-scoped grouping was
 * the honest first step, but it means two runs over the same work produce two
 * unrelated groupings — so the Library cannot say "you already have this"
 * across works, and the graph cannot join them. Phase 9 needs one shared row
 * per work.
 *
 * `workKey` is the same computed key `packages/research/src/workIdentity.ts`
 * already produces (title + author, reviewer framing and edition markers
 * stripped), so promotion is a backfill rather than a re-derivation.
 */
export const workIdentities = pgTable("work_identity", {
  id: uuid("id").primaryKey().defaultRandom(),
  workKey: text("work_key").notNull().unique(),
  canonicalTitle: text("canonical_title").notNull(),
  authorSurname: text("author_surname"),
  authors: jsonb("authors"),
  year: integer("year"),
  /**
   * Phase 20.6 verified identifiers — the canonical-identity precedence chain
   * (`packages/research/src/canonicalIdentity.ts`) matches on these BEFORE
   * falling back to the title/author `workKey`. Only ever populated from a
   * PRIMARY-role record (a review's own DOI must never become the work's),
   * and only backfilled when null — never overwritten.
   */
  doi: text("doi"),
  isbn: text("isbn"),
  /** Canonical external provider id (e.g. "openalex:W…"), when one is known. */
  externalId: text("external_id"),
  /** Verified content hash of an uploaded document established as this work. */
  contentHash: text("content_hash"),
  /** Why records were grouped here — a wrong grouping must be explainable. */
  evidence: text("evidence"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  // Plain (non-unique) indexes: pre-existing rows may already duplicate an
  // identifier — exactly what the 20.6 audit finds — so uniqueness here would
  // make the migration itself fail on real data. Conflict-safe upserts stay
  // keyed on `workKey`; the precedence lookups use these indexes.
  index("work_identity_doi_idx").on(t.doi),
  index("work_identity_isbn_idx").on(t.isbn),
  index("work_identity_content_hash_idx").on(t.contentHash),
]);

/**
 * Phase 20.6: a REVERSIBLE record of one applied identity merge. The loser
 * `work_identity` row is never deleted — every row that pointed at it
 * (`works`, `learning_resource`, `resource_role`) is repointed to the winner,
 * and the exact pre-merge state is captured in `reversal` so
 * `revertWorkIdentityMerge` can restore it precisely. A loser can be merged
 * at most once while the merge is active (partial unique below); reverting
 * clears that slot so a corrected re-merge stays possible.
 */
export const workIdentityMerges = pgTable("work_identity_merge", {
  id: uuid("id").primaryKey().defaultRandom(),
  winnerIdentityId: uuid("winner_identity_id").notNull().references(() => workIdentities.id, { onDelete: "cascade" }),
  loserIdentityId: uuid("loser_identity_id").notNull().references(() => workIdentities.id, { onDelete: "cascade" }),
  /** Which precedence-chain rule justified the merge (doi/isbn/provider-id/…). */
  method: text("method").notNull(),
  evidence: jsonb("evidence"),
  /** Exact ids/rows repointed or displaced, captured for precise reversal. */
  reversal: jsonb("reversal").notNull(),
  createdBy: provenanceEnum("created_by").notNull().default("system"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revertedAt: timestamp("reverted_at"),
}, (t) => [
  index("work_identity_merge_winner_idx").on(t.winnerIdentityId),
  uniqueIndex("work_identity_merge_active_loser_unique")
    .on(t.loserIdentityId)
    .where(sql`reverted_at is null`),
]);

/**
 * A resource a reader can learn from, shared across runs and users — the
 * Library's system of record (plan §34.4 9.5). `research_resource` stays
 * run-scoped and auditable; this is its durable projection, keyed by the same
 * `normalizedKey` so the two can be reconciled without guessing.
 *
 * Note what is stored separately here: `popularity` is displayed but NEVER
 * scored as credibility (plan §34.2), and `peerReviewed` is a fact about the
 * venue, not a verdict about the content.
 */
export const learningResources = pgTable("learning_resource", {
  id: uuid("id").primaryKey().defaultRandom(),
  workIdentityId: uuid("work_identity_id").references(() => workIdentities.id, { onDelete: "set null" }),
  /**
   * Phase 20.6: how this record relates to its `workIdentityId` — primary
   * text, review, edition, translation, or excerpt. Durable projection of the
   * run-scoped `research_resource.work_role`, so the Library can show ONE
   * canonical entry per work with reviews/editions attached rather than five
   * sibling rows (the canary-10 defect).
   */
  workRole: recordRoleEnum("work_role").notNull().default("primary"),
  title: text("title").notNull(),
  url: text("url"),
  canonicalUrl: text("canonical_url"),
  doi: text("doi"),
  isbn: text("isbn"),
  /** Matches `research_resource.normalized_key` — the dedup identity. */
  normalizedKey: text("normalized_key").notNull().unique(),
  resourceType: text("resource_type").notNull().default("bibliographic"),
  provider: text("provider").notNull(),
  year: integer("year"),
  authors: jsonb("authors"),
  venue: text("venue"),
  /** Creator identity/credentials, verified in 9.2 — never asserted by the LLM. */
  creator: jsonb("creator"),
  peerReviewed: boolean("peer_reviewed"),
  /** Views/likes/citation counts as reported. Shown, never scored. */
  popularity: jsonb("popularity"),
  /** Set when this resource also exists in the shared bibliographic catalogue. */
  bibRecordId: uuid("bib_record_id").references(() => bibliographicRecords.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("learning_resource_work_idx").on(t.workIdentityId)]);

/**
 * The role one learning resource plays FOR one work, at a given reader level —
 * the join the Library, curriculum and graph all read (plan §34.4 9.5/9.6).
 * A resource has no single intrinsic role: the same commentary is a
 * prerequisite for a beginner and a parallel reading for a specialist, so the
 * role belongs on the edge and is scoped by level.
 *
 * `relationship` reuses the existing ten-category vocabulary rather than
 * inventing a second one; `readerLevel` null means "at every level".
 */
export const resourceRoles = pgTable("resource_role", {
  id: uuid("id").primaryKey().defaultRandom(),
  learningResourceId: uuid("learning_resource_id").notNull().references(() => learningResources.id, { onDelete: "cascade" }),
  workIdentityId: uuid("work_identity_id").notNull().references(() => workIdentities.id, { onDelete: "cascade" }),
  relationship: relationshipCategoryEnum("relationship").notNull(),
  readerLevel: readerLevelEnum("reader_level"),
  /** Reader-facing justification; required for anything the reader is told to read. */
  rationale: text("rationale"),
  confidence: real("confidence").notNull().default(0),
  createdBy: provenanceEnum("created_by").notNull().default("system"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("resource_role_work_idx").on(t.workIdentityId),
  index("resource_role_resource_idx").on(t.learningResourceId),
  // One role per (resource, work, level): re-running the pipeline updates a
  // judgement rather than stacking contradictory ones. NULLS NOT DISTINCT
  // because null here MEANS something ("at every level") — under Postgres's
  // default null handling the all-levels row would be the one case the
  // constraint silently failed to cover.
  unique("resource_role_unique")
    .on(t.learningResourceId, t.workIdentityId, t.readerLevel)
    .nullsNotDistinct(),
]);

/**
 * A citation mention's projection into the Library. This keeps citation
 * provenance many-to-one: one canonical work can be cited in several notes
 * and bibliography entries without creating duplicate Library rows.
 */
export const citationLibraryLinks = pgTable("citation_library_link", {
  id: uuid("id").primaryKey().defaultRandom(),
  citationId: uuid("citation_id").notNull().references(() => citations.id, { onDelete: "cascade" }).unique(),
  learningResourceId: uuid("learning_resource_id").notNull().references(() => learningResources.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("citation_library_resource_idx").on(t.learningResourceId)]);

/**
 * What KIND of note a passage annotation is making about the primary text —
 * distinct from `relationship`, which describes how a cited/related source
 * bears on the work. A passage annotation always has a type; it only
 * sometimes has a related source to relate to.
 */
export const passageAnnotationTypeEnum = pgEnum("passage_annotation_type", [
  "context",
  "clarification",
  "connection",
  "critique",
  "definition",
  "key_term",
  "concept",
  "argument",
  "evidence",
  "relationship",
]);

/**
 * An explanatory note anchored to one block of the PRIMARY text (plan §34.4
 * 9.3) — distinct from `generated_note`/`generated_claim`, which explain how
 * a discovered EXTERNAL resource relates to the work. A passage annotation
 * explains the passage itself: why it matters, what it presupposes, where it
 * disagrees with something, what a term means here.
 *
 * `textBlockId` is the real anchor; `page` is intentionally NOT duplicated
 * here — it is one join away via `text_block.page_id` — because storing it
 * twice would let the two drift. Whole-work guidance (no single passage
 * applies) is `isWholeWork = true` with no block, never a block chosen
 * because none fit better; the check constraint makes "anchored but
 * pointing nowhere real" and "whole-work but carrying a fake anchor" both
 * impossible at the database level, not just an app-level convention.
 */
export const passageAnnotations = pgTable(
  "passage_annotation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => processingRuns.id, { onDelete: "cascade" }),
    textBlockId: uuid("text_block_id").references(() => textBlocks.id, { onDelete: "cascade" }),
    isWholeWork: boolean("is_whole_work").notNull().default(false),
    /** Verbatim excerpt from the anchored block's own text — never invented, only ever a substring the pipeline already found there. Required unless whole-work. */
    quote: text("quote"),
    /** Reader-facing, app+DB length-checked (<=240 chars). */
    summary: text("summary").notNull(),
    explanation: text("explanation").notNull(),
    /** Brief reader-facing purpose, e.g. "Clarify an unfamiliar term". */
    helpfulFor: text("helpful_for"),
    /** { sectionTitle, pageIndex, blockOrder }; null for legacy/whole-work rows. */
    scope: jsonb("scope"),
    annotationType: passageAnnotationTypeEnum("annotation_type").notNull(),
    relationship: relationshipCategoryEnum("relationship").notNull(),
    /** Null means "shown at every level", same convention as `resource_role.reader_level`. */
    readerLevel: readerLevelEnum("reader_level"),
    confidence: real("confidence").notNull().default(0),
    /** Set when this note draws on a resource this run already discovered. */
    relatedResourceId: uuid("related_resource_id").references(() => researchResources.id, { onDelete: "set null" }),
    createdBy: provenanceEnum("created_by").notNull().default("system"),
    /**
     * Reader correction workflow, at parity with the legacy `annotation` table
     * (Phase 4). Reuses the SAME `verification_status` enum and `hidden`
     * boolean rather than inventing a second vocabulary. A system-written
     * annotation starts `unreviewed`/not hidden; a reader edit to the
     * explanation flips `createdBy` to "user" (edit-in-place, mirroring the
     * legacy route), and `updatedAt` tracks the correction.
     */
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("unreviewed"),
    hidden: boolean("hidden").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("passage_annotation_run_idx").on(t.runId),
    index("passage_annotation_block_idx").on(t.textBlockId),
    check(
      "passage_annotation_anchor_or_whole_work",
      sql`(${t.isWholeWork} = true AND ${t.textBlockId} IS NULL) OR (${t.isWholeWork} = false AND ${t.textBlockId} IS NOT NULL AND ${t.quote} IS NOT NULL)`,
    ),
    check("passage_annotation_summary_length", sql`char_length(${t.summary}) <= 240`),
  ],
);

/**
 * A grounded claim derived from a v4 passage annotation. These are not model
 * assertions detached from the text: every row carries the excerpt and, when
 * present, a text-block FK that produced it. Phase 12.5 will compare these
 * rows across works; v4 only prepares and persists the source evidence.
 */
export const workClaims = pgTable(
  "work_claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => processingRuns.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    textBlockId: uuid("text_block_id").references(() => textBlocks.id, { onDelete: "set null" }),
    claim: text("claim").notNull(),
    claimType: text("claim_type").notNull(),
    supportingExcerpt: text("supporting_excerpt").notNull(),
    confidence: real("confidence").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("work_claim_run_idx").on(t.runId), index("work_claim_work_idx").on(t.workId)],
);

/**
 * One compact v4 representation per work/run input. `embedding` is JSONB
 * deliberately: adding pgvector is a production infrastructure decision and
 * the phase must remain additive and rollback-safe. The later graph phase can
 * migrate these vectors into an indexed representation without re-embedding.
 */
export const workEmbeddings = pgTable(
  "work_embedding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => processingRuns.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    inputHash: text("input_hash").notNull(),
    embedding: jsonb("embedding").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("work_embedding_work_idx").on(t.workId),
    uniqueIndex("work_embedding_work_model_input_unique").on(t.workId, t.model, t.inputHash),
  ],
);

/**
 * Cheap, unjudged cross-work candidates. They are only a retrieval cache —
 * no relationship claim is made until Phase 12.5 evaluates a new pair.
 */
export const workRelationshipCandidates = pgTable(
  "work_relationship_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceWorkId: uuid("source_work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    targetWorkId: uuid("target_work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    score: real("score").notNull(),
    basis: jsonb("basis").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("work_relationship_candidate_source_idx").on(t.sourceWorkId),
    index("work_relationship_candidate_target_idx").on(t.targetWorkId),
    uniqueIndex("work_relationship_candidate_unique").on(t.sourceWorkId, t.targetWorkId, t.method),
    check("work_relationship_candidate_distinct_works", sql`${t.sourceWorkId} <> ${t.targetWorkId}`),
  ],
);

/**
 * Phase 12.5's durable answer to a *specific, source-grounded* cross-work
 * question. Candidates are intentionally cheap and disposable retrieval
 * hints; judgments are the cache. `basisHash` fingerprints the two work
 * signals and their cited claims, so unchanged evidence is never paid for a
 * second time while a changed work can be evaluated afresh. Direction is
 * explicit: `sourceWorkId --relationshipType--> targetWorkId`.
 */
export const workRelationshipJudgments = pgTable(
  "work_relationship_judgment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceWorkId: uuid("source_work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
    targetWorkId: uuid("target_work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
    /** SHA-256 of the exact claim evidence supplied to the judgement. */
    basisHash: text("basis_hash").notNull(),
    relationshipType: edgeTypeEnum("relationship_type").notNull(),
    confidence: real("confidence").notNull().default(0),
    explanation: text("explanation").notNull(),
    /** { sourceClaims: [{ claimId, textBlockId, excerpt }], targetClaims: [...] }. */
    evidence: jsonb("evidence").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("work_relationship_judgment_user_idx").on(t.userId),
    index("work_relationship_judgment_source_idx").on(t.sourceWorkId),
    index("work_relationship_judgment_target_idx").on(t.targetWorkId),
    uniqueIndex("work_relationship_judgment_basis_unique").on(t.userId, t.sourceWorkId, t.targetWorkId, t.basisHash),
    check("work_relationship_judgment_distinct_works", sql`${t.sourceWorkId} <> ${t.targetWorkId}`),
    check("work_relationship_judgment_confidence_valid", sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`),
  ],
);

export const graphExpansionStatusEnum = pgEnum("graph_expansion_status", [
  "planned",
  "queued",
  "running",
  "complete",
  "failed",
]);

/**
 * An auditable, idempotent graph-expansion request. Automatic upload work
 * creates a <=$0.25 request; manual work records the shown estimate and the
 * required explicit confirmation once it is above $1. The worker never
 * trusts client-supplied candidate counts or budget values.
 */
export const graphExpansionRequests = pgTable(
  "graph_expansion_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    sourceWorkId: uuid("source_work_id").notNull().references(() => works.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(), // automatic | manual
    requestedCandidates: integer("requested_candidates").notNull(),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    hardCapUsd: real("hard_cap_usd").notNull().default(5),
    confirmedAt: timestamp("confirmed_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: graphExpansionStatusEnum("status").notNull().default("planned"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("graph_expansion_request_user_idx").on(t.userId, t.createdAt),
    index("graph_expansion_request_source_idx").on(t.sourceWorkId),
    uniqueIndex("graph_expansion_request_idempotency_unique").on(t.userId, t.idempotencyKey),
    check("graph_expansion_request_count_valid", sql`${t.requestedCandidates} > 0 AND ${t.requestedCandidates} <= 100`),
    check("graph_expansion_request_cap_valid", sql`${t.estimatedCostUsd} >= 0 AND ${t.hardCapUsd} > 0 AND ${t.hardCapUsd} <= 5`),
  ],
);

/**
 * Private writing workspaces (Phase 12.6). A project is owned directly by a
 * user; documents, revision snapshots and citations are deliberately nested
 * beneath it so no writer API can ever grant access by a document UUID alone.
 * The content column holds canonical ProseMirror JSON, not rendered HTML.
 */
export const writerProjects = pgTable(
  "writer_project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("writer_project_user_archived_idx").on(t.userId, t.archivedAt, t.sortOrder),
  ],
);

export const writerDocuments = pgTable(
  "writer_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => writerProjects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Canonical, portable ProseMirror `doc` JSON. */
    content: jsonb("content").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("writer_document_project_archived_idx").on(t.projectId, t.archivedAt, t.sortOrder),
  ],
);

/** Immutable snapshots used for local autosave recovery and deliberate restore. */
export const writerDocumentRevisions = pgTable(
  "writer_document_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id").notNull().references(() => writerDocuments.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    content: jsonb("content").notNull(),
    reason: text("reason").notNull().default("autosave"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("writer_document_revision_document_idx").on(t.documentId, t.revision),
    uniqueIndex("writer_document_revision_unique").on(t.documentId, t.revision),
  ],
);

/** A project-scoped CSL-JSON source; key normalizes duplicates without losing provenance. */
export const writerCitations = pgTable(
  "writer_citation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => writerProjects.id, { onDelete: "cascade" }),
    normalizedKey: text("normalized_key").notNull(),
    cslJson: jsonb("csl_json").notNull(),
    source: text("source").notNull(),
    /** Phase 28.6 (migration 0044, for the sibling Phase 28.5 Writer-evidence
     *  lane): optional link back to the `research_claim` this citation's
     *  evidence-panel insertion came from. `SET NULL` on delete — a claim
     *  can be removed/superseded without invalidating the writer's own
     *  citation record, matching `passage_annotation.related_resource_id`'s
     *  "the citation survives; only its extra provenance link is cleared"
     *  precedent. Nothing in THIS lane writes to this column. */
    researchClaimId: uuid("research_claim_id").references(() => researchClaims.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("writer_citation_project_idx").on(t.projectId),
    uniqueIndex("writer_citation_project_key_unique").on(t.projectId, t.normalizedKey),
    index("writer_citation_research_claim_idx").on(t.researchClaimId),
  ],
);

/**
 * Fixed-window per-user API counters. Feature-gated routes use these as the
 * shared limiter across server instances; callers retain a small in-process
 * fallback only while an older production database has not received this
 * additive migration yet.
 */
export const apiRateLimits = pgTable(
  "api_rate_limit",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    windowStartedAt: timestamp("window_started_at").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.scope] }),
    index("api_rate_limit_window_idx").on(t.windowStartedAt),
    check("api_rate_limit_count_valid", sql`${t.count} >= 0`),
  ],
);

export const deletionCleanupStatusEnum = pgEnum("deletion_cleanup_status", [
  "in_progress",
  "storage_failed",
  "completed",
]);

/**
 * Phase 20.3: the durable record behind `@ice/deletion`'s permanent-deletion
 * state machine (real effects in `apps/web/src/lib/trash.ts`). One row per
 * permanently-deleted work; created BEFORE any destructive step so pending
 * Storage paths survive a crash, kept after completion as the deletion's
 * audit trail, and surfaced on the admin dashboard as the cleanup queue
 * whenever `status != completed`. `work_id` is deliberately NOT a foreign
 * key — the work row is hard-deleted mid-flow and this record must outlive
 * it (same "Postgres can't know about this" reasoning as the Storage and
 * pg-boss cleanup entries in the project log, made durable this time).
 */
export const deletionCleanups = pgTable(
  "deletion_cleanup",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workId: uuid("work_id").notNull(),
    /** Retained so the admin queue can still name the work after its row is gone. */
    workTitle: text("work_title").notNull(),
    status: deletionCleanupStatusEnum("status").notNull().default("in_progress"),
    /** Private Storage object paths not yet confirmed deleted. */
    pendingStoragePaths: jsonb("pending_storage_paths").notNull().default(sql`'[]'::jsonb`),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Bounded per-stage log (`@ice/deletion`'s STAGE_LOG_LIMIT). */
    stageLog: jsonb("stage_log").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    uniqueIndex("deletion_cleanup_work_unique").on(t.workId),
    index("deletion_cleanup_user_idx").on(t.userId),
    index("deletion_cleanup_status_idx").on(t.status),
  ],
);

/**
 * Workstream G (v.5): a durable, privacy-page-promised snapshot written
 * BEFORE any destructive step of account deletion (see
 * `apps/web/src/lib/accountDeletion.ts`). `userId` is deliberately NOT a
 * foreign key — the user row is hard-deleted by the flow this row records,
 * and the archive must outlive it, same reasoning as `deletion_cleanup.workId`
 * above. The unique index on `userId` makes the archive-upsert idempotent, so
 * a retried deletion attempt (e.g. after the storage-abort gate below) never
 * produces duplicate archive rows.
 */
export const userDeletionArchives = pgTable(
  "user_deletion_archive",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    userCreatedAt: timestamp("user_created_at").notNull(),
    deletedAt: timestamp("deleted_at").notNull().defaultNow(),
    /** Best-effort aggregates computed just before destruction; see the
     * accountDeletion.ts doc comment for the known ai_usage_log undercount
     * caveat (no user_id column on that table). */
    docsProcessed: integer("docs_processed"),
    totalAiCostUsd: real("total_ai_cost_usd"),
    chatMessages: integer("chat_messages"),
    lastActiveAt: timestamp("last_active_at"),
    readerLevel: text("reader_level"),
    dataSharingWasEnabled: boolean("data_sharing_was_enabled"),
  },
  (t) => [
    uniqueIndex("user_deletion_archive_user_unique").on(t.userId),
    index("user_deletion_archive_deleted_at_idx").on(t.deletedAt),
  ],
);

/**
 * Workstream H (v.5): content-free product-analytics events for the admin
 * dashboard. Bigint identity, not uuid — this is the highest-write table in
 * the schema (a page view per navigation), so a monotonically increasing
 * 8-byte key avoids the index-bloat/random-insert cost a uuid PK would add
 * at that volume. `userId` is NOT a foreign key so events survive account
 * deletion (the admin dashboard shows a deleted user's surviving event
 * series against the `user_deletion_archive` snapshot). No payload column
 * anywhere on this table by design — `path` is the only per-event detail,
 * and it is validated (see `api/usage-event/route.ts`) to rule out anyone
 * routing free-text content through it.
 */
export const usageEventTypeEnum = pgEnum("usage_event_type", [
  "page_view",
  "session_start",
  "upload",
  "chat_message",
  "feedback",
]);

export const usageEvents = pgTable(
  "usage_event",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    userId: uuid("user_id").notNull(),
    eventType: usageEventTypeEnum("event_type").notNull(),
    path: text("path"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("usage_event_user_created_idx").on(t.userId, t.createdAt),
    index("usage_event_type_created_idx").on(t.eventType, t.createdAt),
  ],
);

/**
 * Workstream J (v.5): the feedback-modal inbox the admin dashboard reads
 * (`docs/admin` gate). `userId` is a real, nullable FK with `set null` —
 * unlike the two tables above, feedback is meant to stay attributable to a
 * still-existing account when possible, but must survive that account's
 * deletion as an anonymized row rather than being destroyed with it.
 */
export const feedbackCategoryEnum = pgEnum("feedback_category", ["bug", "idea", "praise", "other"]);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email"),
    category: feedbackCategoryEnum("category").notNull(),
    body: text("body").notNull(),
    path: text("path"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    readAt: timestamp("read_at"),
  },
  (t) => [
    index("feedback_created_at_idx").on(t.createdAt),
    check("feedback_body_length", sql`char_length(${t.body}) <= 10000`),
  ],
);

/* ------------------------------------------------------------------------- *
 * Phase 25 — Research workspace foundation (migration 0038)
 *
 * The ScholarLens integration's *foundation* only: the project model, the job
 * ledger, and the revision spine. The objects those jobs produce
 * (`research_claim`, `claim_score`, `claim_locus`, `research_claim_embedding`,
 * `claim_pair_candidate`, `claim_relationship`, `debate_cluster`,
 * `evidence_chamber`, `research_hypothesis`, `research_gap`,
 * `research_corpus_item`) land in migrations 0039–0045, each with its own lane.
 *
 * Nothing here repurposes an existing table. `work_claim`, `generated_claim`,
 * `claim_evidence`, `work_relationship_candidate`/`work_relationship_judgment`
 * stay untouched — they feed the Phase 12.5 cross-library graph and generated
 * notes, and reusing them would break shipped behaviour (plan §Schema). The new
 * tables copy their proven patterns instead: `basisHash`-style idempotency,
 * DB-enforced XOR CHECKs, and the reused `verification_status`/
 * `provenance_source` enums rather than a second vocabulary.
 * ------------------------------------------------------------------------- */

/**
 * What a research project can contain. `corpus_item` is declared here in 0038
 * even though `research_corpus_item` does not exist until 0039 — a pgEnum value
 * cannot be added inside a transaction alongside its first use in older
 * Postgres, and staging the *value* now keeps 0039 additive (one column, one
 * FK, one widened CHECK). Until then the typed-target CHECK below has no
 * `corpus_item` branch, so a row claiming that type is rejected by the database
 * rather than being silently accepted with no target.
 */
export const researchMemberTypeEnum = pgEnum("research_member_type", [
  "work",
  "corpus_item",
  "writer_project",
  "rag_conversation",
]);

/**
 * How central a member is to the project's question. This drives what claim
 * extraction is allowed to spend money on: `central`/`supporting` membership is
 * one of the three triggers for extraction (plan §Pipeline — extraction never
 * auto-fires on upload), `background` is context only.
 */
export const researchMemberRoleEnum = pgEnum("research_member_role", [
  "central",
  "supporting",
  "background",
]);

/** The seven research job kinds, one per pipeline stage the program ships. */
export const researchJobTypeEnum = pgEnum("research_job_type", [
  "extract_claims",
  "detect_relationships",
  "cluster_debates",
  "synthesize_chamber",
  "generate_hypotheses",
  "import_corpus",
  "run_monitor",
]);

/**
 * Deliberately a superset of `graph_expansion_status` (which this table is
 * modelled on) rather than a reuse of it: research jobs add `cancelled`, and
 * widening the shipped graph-expansion enum to get it would change the domain
 * of a table already in production for no benefit.
 */
export const researchJobStatusEnum = pgEnum("research_job_status", [
  "planned",
  "queued",
  "running",
  "complete",
  "failed",
  "cancelled",
]);

/**
 * The honesty column's vocabulary. A job that hit a cap must say so: `partial`
 * (a soft cap stopped it, with the covered scope recorded in `note`) and
 * `sampled` (it deliberately looked at a subset) are both first-class outcomes,
 * never silently reported as `full`. Same discipline as the pipeline's
 * `structure-limited` labelling.
 */
export const researchJobCoverageEnum = pgEnum("research_job_coverage", ["full", "partial", "sampled"]);

/** Every generated research object that a user can correct, for `research_revision`. */
export const researchObjectTypeEnum = pgEnum("research_object_type", [
  "claim",
  "relationship",
  "cluster",
  "chamber",
  "position",
  "hypothesis",
  "gap",
]);

/**
 * The correction vocabulary. `generated` is the immutable revision-0 snapshot
 * the pipeline writes; every other action is a human decision. There is
 * deliberately no `endorsed`/`accepted` action and no system-authored variant
 * of one — see `research_revision_no_auto_endorsement` below.
 */
export const researchRevisionActionEnum = pgEnum("research_revision_action", [
  "generated",
  "verified",
  "disputed",
  "edited",
  "split",
  "merged",
  "hidden",
  "restored",
  "reclassified",
]);

/**
 * A research project: the scoping unit for every paid research job. Pair
 * detection is project-scoped and never library-scoped, which is what bounds
 * the O(n²) judgement surface (plan §Pipeline/Budget). Shape deliberately
 * mirrors `writer_project` above — same ownership, sort, archive and index
 * conventions — so the two workspaces behave identically where they overlap.
 */
export const researchProjects = pgTable(
  "research_project",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Optional free-text framing of the project; never model-authored. */
    summary: text("summary"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_project_user_archived_idx").on(t.userId, t.archivedAt, t.sortOrder),
  ],
);

/**
 * The user's own research questions, in their own order. Kept as rows rather
 * than a jsonb array on the project so a question can later be referenced by a
 * gap/hypothesis FK without depending on an array position.
 */
export const researchProjectQuestions = pgTable(
  "research_project_question",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("research_project_question_order_unique").on(t.projectId, t.sortOrder),
  ],
);

/**
 * What is in a project. Typed nullable FKs plus a DB CHECK that ties the
 * declared `memberType` to the column actually populated — the
 * `reading_record_exactly_one_target` precedent, extended so the type column
 * can never disagree with the target.
 *
 * STAGED ACROSS TWO MIGRATIONS (deliberate, documented deviation from the
 * plan's single-table sketch): `research_corpus_item` did not exist until
 * migration 0039, so a `corpus_item_id` column and its FK could not be
 * created in 0038. 0038 shipped three target columns and a three-branch
 * CHECK; 0039 (below) adds `corpus_item_id` + its FK and REPLACES that CHECK
 * with the four-branch version below — same constraint name, widened SQL, so
 * drizzle-kit emits a DROP CONSTRAINT + ADD CONSTRAINT rather than a second
 * constraint. Before 0039, `memberType = 'corpus_item'` matched no branch of
 * the CHECK and was rejected by Postgres — the staging was enforced, not
 * merely intended.
 */
export const researchProjectMembers = pgTable(
  "research_project_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    memberType: researchMemberTypeEnum("member_type").notNull(),
    workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
    // 0039: research_corpus_item now exists — forward-referenced via
    // AnyPgColumn (the ai_usage_log -> research_job_request precedent) since
    // `researchCorpusItems` is declared later in this incrementally-grown file.
    corpusItemId: uuid("corpus_item_id").references((): AnyPgColumn => researchCorpusItems.id, { onDelete: "cascade" }),
    writerProjectId: uuid("writer_project_id").references(() => writerProjects.id, { onDelete: "cascade" }),
    ragConversationId: uuid("rag_conversation_id").references(() => ragConversations.id, { onDelete: "cascade" }),
    role: researchMemberRoleEnum("role").notNull().default("supporting"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_project_member_project_idx").on(t.projectId, t.memberType),
    index("research_project_member_work_idx").on(t.workId),
    index("research_project_member_corpus_item_idx").on(t.corpusItemId),
    // Postgres's DEFAULT null handling (NULLS DISTINCT) is exactly what is
    // wanted here and is the opposite of `resource_role`'s case: these indexes
    // must stop the same work/project/conversation being added to one project
    // twice, while allowing any number of rows whose target column is null
    // because they point at a different member type.
    uniqueIndex("research_project_member_work_unique").on(t.projectId, t.workId),
    uniqueIndex("research_project_member_writer_unique").on(t.projectId, t.writerProjectId),
    uniqueIndex("research_project_member_conversation_unique").on(t.projectId, t.ragConversationId),
    uniqueIndex("research_project_member_corpus_item_unique").on(t.projectId, t.corpusItemId),
    check(
      "research_project_member_typed_target",
      sql`(${t.memberType} = 'work' AND ${t.workId} IS NOT NULL AND ${t.corpusItemId} IS NULL AND ${t.writerProjectId} IS NULL AND ${t.ragConversationId} IS NULL)
        OR (${t.memberType} = 'corpus_item' AND ${t.corpusItemId} IS NOT NULL AND ${t.workId} IS NULL AND ${t.writerProjectId} IS NULL AND ${t.ragConversationId} IS NULL)
        OR (${t.memberType} = 'writer_project' AND ${t.writerProjectId} IS NOT NULL AND ${t.workId} IS NULL AND ${t.corpusItemId} IS NULL AND ${t.ragConversationId} IS NULL)
        OR (${t.memberType} = 'rag_conversation' AND ${t.ragConversationId} IS NOT NULL AND ${t.workId} IS NULL AND ${t.corpusItemId} IS NULL AND ${t.writerProjectId} IS NULL)`,
    ),
  ],
);

/**
 * The single idempotency / cost / progress ledger for every research job,
 * modelled on `graph_expansion_request` (plan §Schema). Every research queue
 * payload is just `{ requestId }` — this row, not the queue message, is the
 * durable record of what was asked for, what it may spend, how far it got and
 * how honestly it covered its scope.
 *
 * `idempotencyKey` is a hash of job type + scope + the prompt/vocabulary/
 * threshold versions in force, so a re-request under an unchanged world reuses
 * the in-flight row while a prompt-version bump legitimately re-runs. The
 * unique index is PARTIAL — only in-flight statuses collide, so completed and
 * failed history accumulates instead of blocking the next identical request
 * (the shipped `graph_expansion_request_idempotency_unique` is total, which is
 * why that table can never re-run an identical expansion; deliberate divergence).
 */
export const researchJobRequests = pgTable(
  "research_job_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    jobType: researchJobTypeEnum("job_type").notNull(),
    /** What the job operates on: `{ projectId, claimIds?, workIds?, ... }`. Shape is owned by `planResearchJob()`, validated before insert. */
    scope: jsonb("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: researchJobStatusEnum("status").notNull().default("planned"),
    /** Human-readable current stage, same role as `processing_run.stage`. */
    stage: text("stage"),
    progressIndex: integer("progress_index"),
    progressTotal: integer("progress_total"),
    estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
    /** Reconciled from `ai_usage_log.research_request_id`, never trusted from a client. */
    actualCostUsd: real("actual_cost_usd").notNull().default(0),
    /** True when the shown estimate crossed the confirmation threshold; the worker refuses to start until `confirmedAt` is set. */
    requiresConfirmation: boolean("requires_confirmation").notNull().default(false),
    confirmedAt: timestamp("confirmed_at"),
    /** Null until the job finishes — an unfinished job has no coverage claim to make. */
    coverage: researchJobCoverageEnum("coverage"),
    /** Free-text honesty companion to `coverage`, e.g. the exact sections covered by a `partial` run. */
    note: text("note"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_job_request_user_type_status_idx").on(t.userId, t.jobType, t.status),
    index("research_job_request_user_created_idx").on(t.userId, t.createdAt),
    uniqueIndex("research_job_request_inflight_idempotency_unique")
      .on(t.userId, t.idempotencyKey)
      .where(sql`${t.status} in ('planned', 'queued', 'running')`),
    check("research_job_request_cost_valid", sql`${t.estimatedCostUsd} >= 0 AND ${t.actualCostUsd} >= 0`),
    check(
      "research_job_request_progress_valid",
      sql`(${t.progressIndex} IS NULL OR ${t.progressIndex} >= 0)
        AND (${t.progressTotal} IS NULL OR ${t.progressTotal} >= 0)`,
    ),
  ],
);

/**
 * The revision spine: corrections never overwrite. Every generated research
 * object gets an immutable `revision = 0` / `action = 'generated'` snapshot,
 * and every subsequent human decision appends a row carrying full before/after
 * snapshots. History views read this table; `applyResearchCorrection()` is the
 * only writer.
 *
 * STAGED ACROSS SEVEN MIGRATIONS (deliberate, documented deviation from the
 * plan's single-table sketch — recorded here because a reader of 0038 alone
 * would otherwise see a revision table with nothing to revise): the seven typed
 * object FKs cannot be created before their target tables exist, so 0038 ships
 * the shared shape plus the two CHECKs that need no FK. Each later migration
 * adds ITS OWN nullable FK column, its per-type partial unique
 * `(<object>_id, revision)`, and extends the typed-target XOR CHECK:
 *
 *   0039 → `research_claim_id`        (research_claim)
 *   0040 → `claim_relationship_id`    (claim_relationship)
 *   0041 → `debate_cluster_id`        (debate_cluster)
 *   0042 → `evidence_chamber_id` + `evidence_chamber_position_id`
 *   0043 → `research_hypothesis_id`, `research_gap_id`
 *
 * Until a type's column exists, `objectType` naming it is unsatisfiable for the
 * same reason `memberType = 'corpus_item'` is above — once the XOR CHECK lands
 * in 0039 there is no branch to satisfy. Between 0038 and 0039 the table is
 * shape-only and nothing writes to it.
 */
export const researchRevisions = pgTable(
  "research_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    objectType: researchObjectTypeEnum("object_type").notNull(),
    // 0039: first of the seven typed object FK columns listed above.
    // Forward-referenced via AnyPgColumn since `researchClaims` is declared
    // later in this incrementally-grown file (the ai_usage_log ->
    // research_job_request precedent).
    researchClaimId: uuid("research_claim_id").references((): AnyPgColumn => researchClaims.id, { onDelete: "cascade" }),
    // 0040: second of the seven typed object FK columns — same
    // forward-reference pattern (`claimRelationships` is declared later in
    // this incrementally-grown file, after `researchClaimEmbeddings`).
    claimRelationshipId: uuid("claim_relationship_id").references(
      (): AnyPgColumn => claimRelationships.id,
      { onDelete: "cascade" },
    ),
    // 0041: third of the seven typed object FK columns — same
    // forward-reference pattern (`debateClusters` is declared later in this
    // incrementally-grown file, after `claimRelationships`).
    debateClusterId: uuid("debate_cluster_id").references(
      (): AnyPgColumn => debateClusters.id,
      { onDelete: "cascade" },
    ),
    // 0042: fourth and fifth of the seven typed object FK columns — same
    // forward-reference pattern (`evidenceChambers`/`evidenceChamberPositions`
    // are declared later in this incrementally-grown file, after
    // `debateClusterRelationships`).
    evidenceChamberId: uuid("evidence_chamber_id").references(
      (): AnyPgColumn => evidenceChambers.id,
      { onDelete: "cascade" },
    ),
    evidenceChamberPositionId: uuid("evidence_chamber_position_id").references(
      (): AnyPgColumn => evidenceChamberPositions.id,
      { onDelete: "cascade" },
    ),
    // 0043: the sixth and seventh (final) of the seven typed object FK
    // columns — same forward-reference pattern (`researchHypotheses`/
    // `researchGaps` are declared later in this incrementally-grown file, at
    // the very end, after `debateClusterRelationships`).
    researchHypothesisId: uuid("research_hypothesis_id").references(
      (): AnyPgColumn => researchHypotheses.id,
      { onDelete: "cascade" },
    ),
    researchGapId: uuid("research_gap_id").references((): AnyPgColumn => researchGaps.id, { onDelete: "cascade" }),
    /** Monotonic per object. 0 is always the immutable generated snapshot. */
    revision: integer("revision").notNull(),
    action: researchRevisionActionEnum("action").notNull(),
    /** Null on revision 0 — a generated object had no prior state. */
    before: jsonb("before"),
    after: jsonb("after").notNull(),
    editor: provenanceEnum("editor").notNull(),
    /** Null for the system-authored generated snapshot; set for every human action. */
    editorUserId: uuid("editor_user_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    promptVersion: text("prompt_version"),
    provider: text("provider"),
    model: text("model"),
    /** The other objects a `split`/`merge` produced or consumed. */
    relatedObjectIds: jsonb("related_object_ids"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_revision_user_object_idx").on(t.userId, t.objectType, t.createdAt),
    index("research_revision_claim_idx").on(t.researchClaimId),
    index("research_revision_relationship_idx").on(t.claimRelationshipId),
    index("research_revision_cluster_idx").on(t.debateClusterId),
    index("research_revision_chamber_idx").on(t.evidenceChamberId),
    index("research_revision_position_idx").on(t.evidenceChamberPositionId),
    index("research_revision_hypothesis_idx").on(t.researchHypothesisId),
    index("research_revision_gap_idx").on(t.researchGapId),
    /**
     * The schema-level expression of the research-gated no-auto-endorsement
     * rule (upgrade doc Tier 3.2, plan §Improvements 5): the ONLY row the
     * database accepts from `editor = 'system'` is the immutable `generated`
     * snapshot, and conversely a `generated` row can only come from the system.
     * Combined with `applyResearchCorrection`'s editor type having no
     * `'system'` member, an auto-endorsement path cannot be written, compiled
     * OR inserted. Do not relax this to add a "system verified" convenience.
     */
    check(
      "research_revision_no_auto_endorsement",
      sql`(${t.action} = 'generated' AND ${t.editor} = 'system') OR (${t.action} <> 'generated' AND ${t.editor} <> 'system')`,
    ),
    /** The generated snapshot is revision 0 by definition, so history is always rooted at a known state. */
    check("research_revision_generated_is_zero", sql`(${t.action} <> 'generated') OR (${t.revision} = 0)`),
    /**
     * The typed-target XOR CHECK the class doc comment above describes:
     * introduced in 0039 (the first typed FK column to exist) and extended —
     * same constraint name, widened SQL — by each of 0040-0043 as their own
     * typed FK column lands, exactly like
     * `research_project_member_typed_target` above. Widened by 0041 to a
     * per-type branch that pins EVERY typed FK column, not just the one
     * being added, then independently by the parallel 0042 (Evidence
     * Chamber: `'chamber'`/`'position'`) and 0043 (`'hypothesis'`/`'gap'`)
     * lanes, each of which — landing in isolation — necessarily left the
     * other lane's two object types inside a catch-all
     * `objectType NOT IN (...)` branch it couldn't yet enumerate.
     * Reconciled here (0043, merged after 0042) into the final, single
     * constraint covering all seven typed object types with NO catch-all
     * branch at all: every `research_object_type` enum value now has its
     * own explicit branch pinning all six OTHER typed FKs to null, so the
     * XOR invariant is total over the enum, not partial. This closes a real
     * gap the 27.2 merge-gate's adversarial verification proved empirically
     * (register row D-25-7): with the catch-all branch left in place, an
     * `object_type = 'chamber'` row with every typed FK NULL satisfied the
     * catch-all and inserted successfully, silently falsifying this class's
     * own documented "unimplemented object types are unsatisfiable"
     * invariant. Do not reintroduce a catch-all for a future eighth type —
     * add that type's own explicit branch instead, exactly as this
     * reconciliation does for the seven that exist today.
     */
    check(
      "research_revision_typed_target",
      sql`(${t.objectType} = 'claim' AND ${t.researchClaimId} IS NOT NULL AND ${t.claimRelationshipId} IS NULL AND ${t.debateClusterId} IS NULL AND ${t.evidenceChamberId} IS NULL AND ${t.evidenceChamberPositionId} IS NULL AND ${t.researchHypothesisId} IS NULL AND ${t.researchGapId} IS NULL)
        OR (${t.objectType} = 'relationship' AND ${t.claimRelationshipId} IS NOT NULL AND ${t.researchClaimId} IS NULL AND ${t.debateClusterId} IS NULL AND ${t.evidenceChamberId} IS NULL AND ${t.evidenceChamberPositionId} IS NULL AND ${t.researchHypothesisId} IS NULL AND ${t.researchGapId} IS NULL)
        OR (${t.objectType} = 'cluster' AND ${t.debateClusterId} IS NOT NULL AND ${t.researchClaimId} IS NULL AND ${t.claimRelationshipId} IS NULL AND ${t.evidenceChamberId} IS NULL AND ${t.evidenceChamberPositionId} IS NULL AND ${t.researchHypothesisId} IS NULL AND ${t.researchGapId} IS NULL)
        OR (${t.objectType} = 'chamber' AND ${t.evidenceChamberId} IS NOT NULL AND ${t.researchClaimId} IS NULL AND ${t.claimRelationshipId} IS NULL AND ${t.debateClusterId} IS NULL AND ${t.evidenceChamberPositionId} IS NULL AND ${t.researchHypothesisId} IS NULL AND ${t.researchGapId} IS NULL)
        OR (${t.objectType} = 'position' AND ${t.evidenceChamberPositionId} IS NOT NULL AND ${t.researchClaimId} IS NULL AND ${t.claimRelationshipId} IS NULL AND ${t.debateClusterId} IS NULL AND ${t.evidenceChamberId} IS NULL AND ${t.researchHypothesisId} IS NULL AND ${t.researchGapId} IS NULL)
        OR (${t.objectType} = 'hypothesis' AND ${t.researchHypothesisId} IS NOT NULL AND ${t.researchClaimId} IS NULL AND ${t.claimRelationshipId} IS NULL AND ${t.debateClusterId} IS NULL AND ${t.evidenceChamberId} IS NULL AND ${t.evidenceChamberPositionId} IS NULL AND ${t.researchGapId} IS NULL)
        OR (${t.objectType} = 'gap' AND ${t.researchGapId} IS NOT NULL AND ${t.researchClaimId} IS NULL AND ${t.claimRelationshipId} IS NULL AND ${t.debateClusterId} IS NULL AND ${t.evidenceChamberId} IS NULL AND ${t.evidenceChamberPositionId} IS NULL AND ${t.researchHypothesisId} IS NULL)`,
    ),
    /** Per-type partial unique `(<object>_id, revision)` — the claim branch. */
    uniqueIndex("research_revision_claim_revision_unique")
      .on(t.researchClaimId, t.revision)
      .where(sql`${t.researchClaimId} IS NOT NULL`),
    /** Per-type partial unique `(<object>_id, revision)` — the relationship branch. */
    uniqueIndex("research_revision_relationship_revision_unique")
      .on(t.claimRelationshipId, t.revision)
      .where(sql`${t.claimRelationshipId} IS NOT NULL`),
    /** Per-type partial unique `(<object>_id, revision)` — the cluster branch. */
    uniqueIndex("research_revision_cluster_revision_unique")
      .on(t.debateClusterId, t.revision)
      .where(sql`${t.debateClusterId} IS NOT NULL`),
    /** Per-type partial unique `(<object>_id, revision)` — the chamber branch. */
    uniqueIndex("research_revision_chamber_revision_unique")
      .on(t.evidenceChamberId, t.revision)
      .where(sql`${t.evidenceChamberId} IS NOT NULL`),
    /** Per-type partial unique `(<object>_id, revision)` — the position branch. */
    uniqueIndex("research_revision_position_revision_unique")
      .on(t.evidenceChamberPositionId, t.revision)
      .where(sql`${t.evidenceChamberPositionId} IS NOT NULL`),
    /** Per-type partial unique `(<object>_id, revision)` — the hypothesis branch. */
    uniqueIndex("research_revision_hypothesis_revision_unique")
      .on(t.researchHypothesisId, t.revision)
      .where(sql`${t.researchHypothesisId} IS NOT NULL`),
    /** Per-type partial unique `(<object>_id, revision)` — the gap branch. */
    uniqueIndex("research_revision_gap_revision_unique")
      .on(t.researchGapId, t.revision)
      .where(sql`${t.researchGapId} IS NOT NULL`),
  ],
);

/* -------------------------------------------------------------------------
 * Phase 26.1 (migration 0039): claim extraction. `research_corpus_item`,
 * `research_claim`, `claim_score`, `claim_locus`, `research_claim_embedding`
 * land here; `claim_pair_candidate`, `claim_relationship`, `debate_cluster`,
 * `evidence_chamber`, `research_hypothesis`, `research_gap` land in their own
 * later migrations (0040-0043, plan §Schema) — not here.
 * ------------------------------------------------------------------------- */

/** What a claim's own text asserts. Palimnote's corpus spans empirical
 *  papers AND philosophy/textual-scholarship works, where most claims are
 *  interpretive, historical, or conceptual rather than empirical — this axis
 *  keeps those honestly distinguished instead of forced into an
 *  empirical-shaped bucket. Mirrors `@ice/claims`'s `CLAIM_NATURES` exactly
 *  (that package is pure/dependency-free and does not import this schema, so
 *  the two lists are kept in lockstep by hand, not by a shared import). */
export const claimNatureEnum = pgEnum("claim_nature", [
  "empirical",
  "textual",
  "interpretive",
  "historical",
  "conceptual",
  "normative",
  "definitional",
  "methodological",
]);

/**
 * Whether a claim's `text_block_id` anchor is currently trustworthy.
 * `anchored`: the claim was extracted from and still points at a real text
 * block of the run that produced it. `rebound`: a later reprocess
 * content-addressed the claim and `findQuoteOffset` (via `@ice/claims`'s
 * `anchoring.ts`) re-located exactly one match in the new published run's
 * blocks. `unanchored`: a reprocess found zero or multiple matches (or a
 * corpus-item-sourced claim was never anchored to any block at all) — the
 * claim is NEVER deleted for this, only marked, since the user may have
 * verified or cited it (plan §Pipeline "Reprocess supersession").
 */
export const claimAnchorStateEnum = pgEnum("claim_anchor_state", ["anchored", "rebound", "unanchored"]);

/** What portion of the source text a claim's `supporting_excerpt` was
 *  actually drawn from. `full_text`: the complete uploaded-work body was in
 *  scope for extraction (even if map-reduce chunked it). `abstract`: a
 *  corpus-item import, where only the provider's abstract is ever available
 *  — never the full paper body (no model writes to `research_corpus_item`,
 *  the bibliographic rule). `sampled`: extraction covered less than the full
 *  eligible text because a cost/chunk cap was hit (`@ice/claims`'s
 *  `ExtractionCoverage`, same honesty vocabulary as `research_job_request.coverage`). */
export const claimSourceScopeEnum = pgEnum("claim_source_scope", ["full_text", "abstract", "sampled"]);

/** Lifecycle for a research object that reprocessing can supersede.
 *  `superseded` rows are never deleted — same "never delete, always mark"
 *  discipline as `claim_anchor_state`'s `unanchored`, and as
 *  `processing_run.isPublished`'s own supersession pattern. */
export const researchObjectStatusEnum = pgEnum("research_object_status", ["active", "superseded"]);

/** Which of `@ice/claims`'s two parallel scorers produced a `claim_score`
 *  row — the empirical track (ported verbatim from ScholarLens) and the
 *  humanities/textual-support track (new, same architectural DNA). Mirrors
 *  `@ice/claims`'s `ClaimScoreDimension` exactly. */
export const claimScoreDimensionEnum = pgEnum("claim_score_dimension", ["evidence_strength", "textual_support"]);

/** Mirrors `@ice/claims`'s `ClaimScore.label` exactly. */
export const claimScoreLabelEnum = pgEnum("claim_score_label", ["strong", "moderate", "weak"]);

/** Where a `claim_locus` row's normalized locus key was harvested from: the
 *  claim's own verbatim excerpt, its full anchored text block, an authorial
 *  footnote/endnote near the claim, or a structurally resolved citation's
 *  raw text. Multiple origins can independently corroborate the same locus
 *  for the same claim (the `(claim_id, locus_key, origin)` unique below keeps
 *  those as distinct rows rather than colliding them). */
export const claimLocusOriginEnum = pgEnum("claim_locus_origin", ["excerpt", "block", "footnote", "citation"]);

/** The three corpus-import provider adapters `packages/research` gains for
 *  Phase 25.7/28.2 (Semantic Scholar, OpenAlex, and a new arXiv adapter —
 *  none exists today). Every `research_corpus_item` column is populated only
 *  from a real payload from one of these, never invented (the
 *  `bibliographic_record` anti-hallucination rule, applied to imports). */
export const corpusSourceEnum = pgEnum("corpus_source", ["semanticscholar", "openalex", "arxiv"]);

/**
 * An imported-not-uploaded work (plan §Schema): a research project member
 * the user added by reference to a real scholarly-database record, not by
 * uploading a document. User-scoped (not a shared catalog like
 * `bibliographic_record`) because corpus import is a per-project research
 * action, not a cross-user canonical fact store — `(user_id, dedup_key)` is
 * the import-time dedup key, so re-importing the same paper into a second
 * project reuses the row rather than duplicating it. Every column below is
 * populated only from the real provider payload that produced `externalId`
 * — no model ever writes to this table.
 */
export const researchCorpusItems = pgTable(
  "research_corpus_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    source: corpusSourceEnum("source").notNull(),
    /** The provider's own id for this record (e.g. a Semantic Scholar paperId, an OpenAlex work id, an arXiv id). */
    externalId: text("external_id").notNull(),
    /** Normalized title(+year/DOI) key this row was deduped against at import time. */
    dedupKey: text("dedup_key").notNull(),
    title: text("title").notNull(),
    /** Author display names, provider-supplied — never inferred. */
    authors: jsonb("authors").notNull().default([]),
    year: integer("year"),
    doi: text("doi"),
    url: text("url"),
    /** The provider's own abstract text, when supplied — the only source text a corpus-item claim can ever cite (`claim_source_scope = 'abstract'`). */
    abstract: text("abstract"),
    venue: text("venue"),
    /** Full raw provider payload, for audit/re-derivation — the `bibliographic_record.raw` precedent. */
    raw: jsonb("raw").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_corpus_item_user_idx").on(t.userId),
    index("research_corpus_item_source_external_idx").on(t.source, t.externalId),
    uniqueIndex("research_corpus_item_user_dedup_unique").on(t.userId, t.dedupKey),
  ],
);

/**
 * The core research object (plan §Schema): a specific, falsifiable assertion
 * extracted directly from a work's own text (never from a summary), always
 * traceable back to a literal, re-verified excerpt of that source. Exactly
 * one of `work_id`/`corpus_item_id` is the claim's source (XOR CHECK below)
 * — an uploaded Palimnote work, or a project's imported corpus item.
 *
 * Grounding is enforced, not merely conventional: a work-sourced claim is
 * always either anchored to a real `text_block` (`text_block_id` set) or
 * explicitly marked `anchor_state = 'unanchored'` after a reprocess lost its
 * anchor (never silently deleted, plan §Pipeline "Reprocess supersession");
 * a corpus-item-sourced claim is `source_scope = 'abstract'` since no text
 * block exists to anchor to. There is deliberately no third "whole-work"
 * escape hatch — the `research_claim_grounded` CHECK rejects any row that
 * fits none of these three cases.
 *
 * `content_hash` (sha256 of the normalized `claim_text`) plus
 * `prompt_version` is the dedup/idempotency key (the `basis_hash` precedent
 * from `work_relationship_judgment`): a re-run under an unchanged prompt
 * version inserts nothing new (`ON CONFLICT DO NOTHING` at the app layer),
 * while a prompt-version bump legitimately re-extracts. `excerpt_verified`
 * is a deterministic, app-computed fact (was this excerpt re-checked as a
 * literal substring of its named block, right before insert) — deliberately
 * NOT a review state, which is what `verification_status` (reused from the
 * `annotation`/`passage_annotation` precedent) is for.
 */
export const researchClaims = pgTable(
  "research_claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
    corpusItemId: uuid("corpus_item_id").references(() => researchCorpusItems.id, { onDelete: "cascade" }),
    /** SET NULL, not cascade: `research_claim.processing_run_id` is deliberately
     *  nullable so a claim survives past the run that extracted it (content-
     *  addressed identity) — a later reprocess rebinds it rather than losing it. */
    processingRunId: uuid("processing_run_id").references(() => processingRuns.id, { onDelete: "set null" }),
    /** SET NULL for the same reason: the referenced text_block can be deleted
     *  out from under a claim by a reprocess (cascading from a new processing_run's
     *  pages), and the rebind step decides the claim's new anchor afterward —
     *  the claim row itself must survive that deletion. */
    textBlockId: uuid("text_block_id").references(() => textBlocks.id, { onDelete: "set null" }),
    /** {quote,prefix,suffix} anchor — the same text-fingerprint idiom as
     *  `highlight`/`passage_annotation`. Null for a claim that has never had
     *  a locatable anchor (a corpus-item claim drawn from an abstract). */
    quote: text("quote"),
    prefix: text("prefix"),
    suffix: text("suffix"),
    anchorState: claimAnchorStateEnum("anchor_state").notNull().default("anchored"),
    claimText: text("claim_text").notNull(),
    claimNature: claimNatureEnum("claim_nature").notNull(),
    /** Stage-2 argumentative role (premise/conclusion/objection/reply/
     *  qualification/speculative, plan §Dual-track "Claim taxonomy" stage 2).
     *  Deliberately plain text, not yet a pgEnum: the stage-2 taxonomy ships
     *  once the reader-side passage-role suggestions land (plan §Program,
     *  Phase 28+), and an enum with zero ratified values isn't valid
     *  Postgres syntax. Nothing writes to this column yet. */
    claimRole: text("claim_role"),
    /** "high"/"medium"/"low", exactly `@ice/claims`'s `ClaimConfidence` —
     *  plain text (not a DB enum) since it is not one of this migration's
     *  eight reserved enum names; validated at the application layer by the
     *  same `buildClaimExtractionPrompt`/`validateClaimExtraction` pair that
     *  produces it. */
    confidence: text("confidence").notNull(),
    /** The section label this claim was extracted from (`@ice/claims`'s
     *  `ExtractionChunk.sectionLabel` / `ExtractedClaim.section`). */
    section: text("section").notNull(),
    sourceScope: claimSourceScopeEnum("source_scope").notNull(),
    /** A LITERAL, VERBATIM substring of the source text supplied to the
     *  model — verified before insert, never repaired or paraphrased. */
    supportingExcerpt: text("supporting_excerpt").notNull(),
    /** Deterministic re-verification fact, NOT a review state (see class doc comment). */
    excerptVerified: boolean("excerpt_verified").notNull().default(false),
    /** sha256 of the normalized claim_text — the dedup/idempotency key alongside `prompt_version`. */
    contentHash: text("content_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    status: researchObjectStatusEnum("status").notNull().default("active"),
    /** Reused verbatim — the `annotation`/`passage_annotation` correction-workflow precedent. */
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("unreviewed"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_claim_user_idx").on(t.userId),
    index("research_claim_work_idx").on(t.workId),
    index("research_claim_corpus_item_idx").on(t.corpusItemId),
    index("research_claim_text_block_idx").on(t.textBlockId),
    index("research_claim_user_status_idx").on(t.userId, t.status),
    // Two partial dedup uniques (plan §Schema PART 1) rather than one over
    // both nullable source columns: exactly one of work_id/corpus_item_id is
    // ever set per row (the XOR CHECK below), so each unique only ever
    // scopes the dedup key to the source type it actually names.
    uniqueIndex("research_claim_work_dedup_unique")
      .on(t.workId, t.contentHash, t.promptVersion)
      .where(sql`${t.workId} IS NOT NULL`),
    uniqueIndex("research_claim_corpus_item_dedup_unique")
      .on(t.corpusItemId, t.contentHash, t.promptVersion)
      .where(sql`${t.corpusItemId} IS NOT NULL`),
    check(
      "research_claim_exactly_one_source",
      sql`(${t.workId} IS NOT NULL AND ${t.corpusItemId} IS NULL) OR (${t.workId} IS NULL AND ${t.corpusItemId} IS NOT NULL)`,
    ),
    /** No whole-work escape hatch: a claim is always passage-anchored
     *  (`text_block_id` set), abstract-scoped (a corpus-item claim), or
     *  explicitly `unanchored` after a reprocess lost a real prior anchor —
     *  never inserted with none of the three. */
    check(
      "research_claim_grounded",
      sql`${t.textBlockId} IS NOT NULL OR ${t.sourceScope} = 'abstract' OR ${t.anchorState} = 'unanchored'`,
    ),
    /** Tightens the grounded invariant above: once a claim is explicitly
     *  `unanchored` (a reprocess lost its prior anchor, plan §Pipeline
     *  "Reprocess supersession"), `text_block_id` must actually be cleared,
     *  not left pointing at a stale/superseded block. Without this, a row
     *  could satisfy `research_claim_grounded` via the `anchor_state =
     *  'unanchored'` branch while still carrying a dangling `text_block_id`
     *  from before the rebind — self-contradictory grounding metadata. */
    check(
      "research_claim_unanchored_no_block",
      sql`${t.anchorState} <> 'unanchored' OR ${t.textBlockId} IS NULL`,
    ),
    check("research_claim_excerpt_nonempty", sql`char_length(trim(${t.supportingExcerpt})) > 0`),
  ],
);

/**
 * A named, scored dimension of one claim (plan §Dual-track "evidence
 * model"). Both `@ice/claims` scorers (`scoreEvidenceStrength` for
 * empirical claims, `scoreTextualSupport` for humanities/textual ones) run
 * over every claim's text for free (pure regex, no LLM); a row is written
 * only when the scorer found at least one real signal
 * (`MIN_SIGNAL_FLOOR`) — a claim with zero rows here is honestly
 * "unscored" on that dimension, never a fabricated default score. The two
 * dimensions are never averaged or compared against each other (plan
 * §Dual-track: "the two scores are visibly different dimensions, not one
 * scale"). `scorer_version` keys the dedup unique so a scorer-algorithm
 * change legitimately re-scores rather than silently reusing a stale row.
 */
export const claimScores = pgTable(
  "claim_score",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
    dimension: claimScoreDimensionEnum("dimension").notNull(),
    score: real("score").notNull(),
    label: claimScoreLabelEnum("label").notNull(),
    /** The specific matched category that drove `score` (`EvidenceStrength.design` / `TextualSupport.mode`). */
    tier: text("tier"),
    /** The named signals that fired — `@ice/claims`'s `ClaimScore.signals`. */
    signals: jsonb("signals").notNull().default([]),
    scorerVersion: text("scorer_version").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("claim_score_claim_idx").on(t.claimId),
    uniqueIndex("claim_score_claim_dimension_version_unique").on(t.claimId, t.dimension, t.scorerVersion),
  ],
);

/**
 * A normalized classical-locus key (`author:work-slug:page-letter`, line
 * numbers deliberately dropped so 1151a20 and 1151a25 collide — the plan's
 * `canonicalLocusKey` contract) harvested from one claim, powering the
 * locus retrieval channel (plan §Pipeline "Three-channel Stage 1": two
 * claims sharing a `locus_key` become a Stage-1 candidate pair at score 1.0,
 * deterministic and free, regardless of embedding/BM25 vocabulary distance
 * between them). A claim can carry more than one locus row — the same locus
 * independently corroborated from its own excerpt AND a nearby footnote is
 * two distinct, non-colliding rows (the `(claim_id, locus_key, origin)`
 * unique below), not a single fact overwritten.
 */
export const claimLoci = pgTable(
  "claim_locus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
    locusKey: text("locus_key").notNull(),
    origin: claimLocusOriginEnum("origin").notNull(),
    /** The verbatim locus text this key was derived from (e.g. "1151a20-8"), for display. */
    rawLocus: text("raw_locus"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("claim_locus_locus_key_idx").on(t.locusKey),
    uniqueIndex("claim_locus_claim_key_origin_unique").on(t.claimId, t.locusKey, t.origin),
  ],
);

/**
 * A claim's embedding vector — the pgvector provider seam (plan §Owner-
 * ratified decisions 7 and §Schema): a real indexed `vector` column, not
 * jsonb, dimension-typed now that the calibration spike (Phase 25.5) chose
 * `text-embedding-3-small` (1536). `dim` is stored alongside the fixed-width
 * `vector(1536)` column so a future provider/model swap is legible from the
 * row itself without decoding the column type; `(claim_id, model,
 * input_hash)` is the provider-swap-safe unique — a new model or a changed
 * input produces a new row rather than overwriting the old one, so a
 * provider swap is purely additive (flip config, new rows accumulate).
 * HNSW `vector_cosine_ops` index below backs the dense-retrieval Stage-1
 * channel's `<=>` cosine search (plan §Pipeline).
 */
export const researchClaimEmbeddings = pgTable(
  "research_claim_embedding",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    claimId: uuid("claim_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    inputHash: text("input_hash").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    dim: integer("dim").notNull().default(1536),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_claim_embedding_claim_idx").on(t.claimId),
    uniqueIndex("research_claim_embedding_claim_model_hash_unique").on(t.claimId, t.model, t.inputHash),
    index("research_claim_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

/* -------------------------------------------------------------------------
 * Phase 26.2a (migration 0040): the DETERMINISTIC half of relationship
 * detection — Stage-1 three-channel candidate retrieval (dense/bm25/locus)
 * plus citation-graph engagement, both $0. `claim_pair_candidate` is the
 * cheap/disposable retrieval output; `claim_relationship` is the paid/
 * durable judged output, whose write path (26.2b, a later lane) is a typed
 * TODO in `apps/worker/src/research/detectRelationships.ts` — this
 * migration ships the table now so 26.2b is additive, not a second schema
 * change to the same job type.
 * ------------------------------------------------------------------------- */

/**
 * FROZEN — do not add, remove, or rename a value here without bumping
 * `TAXONOMY_VERSION_RELATIONSHIPS` (`@ice/claims`'s `taxonomy.ts`) and
 * treating it as a new taxonomy version. Mirrors `CLAIM_RELATION_VALENCES`
 * exactly: this is the eval-certified axis (macro-F1 0.788, kappa 0.683 on
 * the ScholarLens-ported gold set) every downstream gate/gold-label file/
 * clustering rule is written against.
 */
export const claimRelationValenceEnum = pgEnum("claim_relation_valence", [
  "contradiction",
  "support",
  "nuance",
  "unrelated",
]);

/** Mirrors `@ice/claims`'s `CLAIM_RELATION_CATEGORIES` exactly. */
export const claimRelationCategoryEnum = pgEnum("claim_relation_category", [
  "methodological",
  "findings",
  "theoretical",
  "scope",
]);

/**
 * Stage 1: a single, honest placeholder (mirrors `@ice/claims`'s
 * `CLAIM_RELATION_MECHANISMS` exactly) — no stage of this pipeline yet
 * infers *why* two claims relate the way they do beyond the valence itself.
 * Stage 2 (the humanities judge gate, plan §Dual-track/§Program 27.3) adds
 * `different_definition`, `interprets_differently`, and
 * `different_scope_conditions` to this enum in migration 0046, ONLY once the
 * humanities gold-set eval clears its floors — until then those three
 * values do not exist in the Postgres type at all, so a misclassification
 * into them cannot be persisted even if a bug tried. Stage 3 (any further
 * mechanism refinement) would land in a still-later migration under the
 * same discipline.
 */
export const claimRelationMechanismEnum = pgEnum("claim_relation_mechanism", ["unspecified"]);

/**
 * Deterministic, $0 citation-graph context for a candidate/judged pair
 * (plan §Improvements "Citation-graph-aware disagreement judgment"):
 * resolved via `citation.resolved_bib_id` → `bibliographic_record` →
 * normalized-title match against the OTHER claim's own work (the
 * `roadmap.ts`/`graph.ts` owned-work-match precedent), never inferred by a
 * model. `direct_citation`: one work cites the other. `reciprocal_citation`:
 * both cite each other. `shared_citation`: neither cites the other directly,
 * but both cite some third, common bibliographic record. `none_detected`:
 * none of the above — a checked-and-empty result, distinguishable from
 * "never checked" by this column simply always being set.
 */
export const claimEngagementEnum = pgEnum("claim_engagement", [
  "direct_citation",
  "reciprocal_citation",
  "shared_citation",
  "none_detected",
]);

/** Which of the dual-track judge prompts (plan §Dual-track) produced a
 *  `claim_relationship` row — routed by the pair's claims' `claim_nature`,
 *  never mixed within one judged pair. */
export const claimJudgeBranchEnum = pgEnum("claim_judge_branch", ["empirical", "humanities"]);

/** Which claim of an ordered (lo, hi) pair the judge found to carry the
 *  stronger evidence — `JudgeResult.strongerEvidence`'s `"paper_a"` maps to
 *  `lo`, `"paper_b"` to `hi`, `"neither"` to `neither`. Deliberately NOT a
 *  chamber "winner" (plan §Schema `evidence_chamber` "no winner/verdict/
 *  stronger column exists, ever") — this is a per-pair judge signal used to
 *  populate the Evidence Chamber's named-signal display, not a verdict on
 *  the underlying scholarly question. */
export const claimSideEnum = pgEnum("claim_side", ["lo", "hi", "neither"]);

/**
 * A cheap, disposable Stage-1 retrieval hit (plan §Pipeline "Three-channel
 * Stage 1"): two claims from DIFFERENT works that at least one of the dense
 * (pgvector cosine)/BM25/locus channels flagged as plausibly related. Zero
 * AI cost — this table is a retrieval index, not a judgment. `claimLoId <
 * claimHiId` is DB-enforced so a pair is always stored in one canonical
 * order regardless of which claim a channel happened to find first (the
 * `unionCandidates` dedup precedent, enforced here at the DB layer too).
 * `(user_id, claim_lo_id, claim_hi_id)` is the whole identity — re-running
 * detection over an unchanged claim set (or a second project sharing the
 * same two claims) is a no-op insert, not a duplicate row; `project_id`
 * records only which project's run first surfaced the pair.
 */
export const claimPairCandidates = pgTable(
  "claim_pair_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    claimLoId: uuid("claim_lo_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
    claimHiId: uuid("claim_hi_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
    /** `CandidatePair.retrievalSources` (`@ice/claims`'s `retrieval/union.ts`)
     *  — every channel that independently found this pair, each with its own
     *  score: `[{channel: "dense"|"bm25"|"locus"|"locus_section", score}]`. */
    retrievalSources: jsonb("retrieval_sources").notNull().default([]),
    /** `CandidatePair.bestScore` — display/ranking only, never used for dedup. */
    bestRetrievalScore: real("best_retrieval_score").notNull(),
    engagement: claimEngagementEnum("engagement").notNull().default("none_detected"),
    /** The deterministic evidence behind `engagement` (which bibliographic
     *  record / which work resolved the citation) — audit/display only,
     *  never model-authored. Null exactly when `engagement = 'none_detected'`. */
    engagementEvidence: jsonb("engagement_evidence"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("claim_pair_candidate_project_idx").on(t.projectId),
    index("claim_pair_candidate_lo_idx").on(t.claimLoId),
    index("claim_pair_candidate_hi_idx").on(t.claimHiId),
    index("claim_pair_candidate_user_idx").on(t.userId),
    uniqueIndex("claim_pair_candidate_user_lo_hi_unique").on(t.userId, t.claimLoId, t.claimHiId),
    check("claim_pair_candidate_lo_hi_order", sql`${t.claimLoId} < ${t.claimHiId}`),
  ],
);

/**
 * A paid, durable judged relationship between two claims (plan §Schema): the
 * output of the future 26.2b judge lane, over a `claim_pair_candidate` pair.
 * `valence` is the FROZEN eval-certified axis (see `claimRelationValenceEnum`
 * above) — never widen it in place. `mechanism` is nullable and, at Stage 1,
 * constrained to `NULL`/`'unspecified'` by `claim_relationship_mechanism_matches_valence`
 * below; that CHECK is the widening point for the Stage-2 humanities gate
 * (migration 0046), once the enum itself gains the three stage-2 values —
 * same constraint name, wider SQL, the `research_project_member_typed_target`
 * precedent. `basis_hash` (covering both claims' text/excerpts/prompt
 * version/judge branch/engagement) is this table's idempotency key, the
 * `work_relationship_judgment.basisHash` precedent: a re-judgment under an
 * UNCHANGED world reuses the key and inserts nothing new, while any real
 * input change (an edited claim, a reclassified engagement, a prompt-version
 * bump) legitimately re-judges and re-pays.
 */
export const claimRelationships = pgTable(
  "claim_relationship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    claimLoId: uuid("claim_lo_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
    claimHiId: uuid("claim_hi_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
    valence: claimRelationValenceEnum("valence").notNull(),
    category: claimRelationCategoryEnum("category").notNull(),
    mechanism: claimRelationMechanismEnum("mechanism"),
    judgeBranch: claimJudgeBranchEnum("judge_branch").notNull(),
    /** `JudgeResult.strongerEvidence` mapped onto the ordered pair — see `claimSideEnum` above. */
    strongerSide: claimSideEnum("stronger_side").notNull().default("neither"),
    explanation: text("explanation").notNull(),
    /** `JudgeResult.resolution` — one concrete sentence on what would resolve the disagreement. */
    resolution: text("resolution").notNull(),
    /** Carried over from the candidate that produced this judgment (plan
     *  §Pipeline "Citation-graph engagement": "the judge receives this as
     *  context and the relationship row stores it") — an ablation input, not
     *  re-derived here. */
    engagement: claimEngagementEnum("engagement").notNull(),
    /** A computed differential between the two claims' `claim_score` rows ON
     *  THE SAME dimension — e.g. |scoreLo - scoreHi|. Null when either claim
     *  lacks a score on that dimension (an honest "no gap to report", never
     *  a fabricated one). `evidence_gap_dimension` names WHICH dimension the
     *  gap was measured on, so an empirical gap can never be silently
     *  compared against a textual-support one (`claim_relationship_gap_dimensioned` below). */
    evidenceGap: real("evidence_gap"),
    evidenceGapDimension: claimScoreDimensionEnum("evidence_gap_dimension"),
    /** sha256 covering both claims' text/excerpts, prompt version, judge
     *  branch, and engagement — this table's re-judge/idempotency key. */
    basisHash: text("basis_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider"),
    model: text("model"),
    status: researchObjectStatusEnum("status").notNull().default("active"),
    /** Reused verbatim — the `annotation`/`passage_annotation`/`research_claim` correction-workflow precedent. */
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("unreviewed"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("claim_relationship_project_idx").on(t.projectId),
    index("claim_relationship_lo_idx").on(t.claimLoId),
    index("claim_relationship_hi_idx").on(t.claimHiId),
    index("claim_relationship_user_status_idx").on(t.userId, t.status),
    uniqueIndex("claim_relationship_user_lo_hi_basis_unique").on(t.userId, t.claimLoId, t.claimHiId, t.basisHash),
    check("claim_relationship_lo_hi_order", sql`${t.claimLoId} < ${t.claimHiId}`),
    /**
     * Stage-1 form: with only `'unspecified'` in the enum, this is
     * necessarily trivial (mechanism can only ever be NULL or
     * 'unspecified') — but the constraint NAME is the widening point for
     * the Stage-2 humanities gate (migration 0046), which replaces the SQL
     * here with a real per-valence mapping (`MECHANISM_VALENCE`) once
     * `different_definition`/`interprets_differently`/
     * `different_scope_conditions` exist in the enum, exactly like
     * `research_project_member_typed_target`'s in-place widening.
     */
    check("claim_relationship_mechanism_matches_valence", sql`${t.mechanism} IS NULL OR ${t.mechanism} = 'unspecified'`),
    check(
      "claim_relationship_gap_dimensioned",
      sql`${t.evidenceGap} IS NULL OR ${t.evidenceGapDimension} IS NOT NULL`,
    ),
  ],
);

/* -------------------------------------------------------------------------
 * Phase 26.3 (migration 0041): the debate layer — grouping judged
 * `claim_relationship` edges (everything except `unrelated`, per
 * `@ice/claims`'s `findClaimClusters`) into named `debate_cluster`s via BFS
 * connected components. `debate_cluster_member`/`debate_cluster_relationship`
 * are pure join tables (which claims, which judged edges belong to a
 * cluster) so a cluster's membership can be recomputed/diffed without
 * re-deriving it from `claim_relationship` scans every time.
 * ------------------------------------------------------------------------- */

/**
 * `active`: this is the CURRENT connected-component membership for its
 * `member_hash`. `stale`: a later `cluster_debates` run found this exact
 * cluster's membership has changed (an edge was added/removed/reclassified,
 * so the BFS produced a different component) — the row is NEVER deleted
 * (plan §Pipeline: "membership shifts mark old clusters `stale`, never
 * delete (user verifications survive)"), it just stops being the surfaced
 * membership. Deliberately a DEDICATED enum, not a reuse of
 * `research_object_status`'s `active|superseded` — `superseded` implies a
 * newer row replaced this one by identity (the `research_claim` rebind
 * precedent), whereas a stale cluster's membership simply changed; there is
 * no single "successor" row to point at (a stale cluster's members may now
 * be split across several new clusters, or folded into one that already
 * existed under a different `member_hash`).
 */
export const debateClusterStatusEnum = pgEnum("debate_cluster_status", ["active", "stale"]);

/**
 * A named debate/tension detected by `cluster_debates` (plan §Pipeline/
 * §Program 26.3): a BFS connected component over non-`unrelated`
 * `claim_relationship` edges, scoped to one project (same project-scoping
 * discipline as `claim_pair_candidate`/`claim_relationship` — bounds the
 * surface, and lets the identical claim membership be named independently
 * in two different projects rather than forcing a global namespace).
 * `member_hash` (`@ice/claims`'s `memberHash()` — sha256 of the sorted
 * member claim ids) is this table's idempotency key: re-running clustering
 * over an UNCHANGED component reuses the existing row (reactivating it if it
 * had gone `stale`) rather than paying to re-name it, which is what makes
 * "repeat run costs nothing new" a real, testable guarantee here exactly
 * like `claim_pair_candidate`'s dedup unique. `name`/`researchQuestion`/
 * `description` come from `@ice/claims`'s `buildClusterNamingPrompt`, with
 * `deterministicFallbackName` as the $0 fallback when the naming call fails
 * or no provider is configured — `prompt_version`/`provider`/`model` are
 * nullable and left null on that fallback path (the `annotation`
 * `promptVersion: "heuristic"` precedent, applied via a sentinel value at
 * the write site rather than widening this column's own type).
 */
export const debateClusters = pgTable(
  "debate_cluster",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    researchQuestion: text("research_question"),
    description: text("description"),
    /** sha256 of the sorted member claim ids (`@ice/claims`'s `memberHash()`) — this table's naming-idempotency key. */
    memberHash: text("member_hash").notNull(),
    /** How many non-`unrelated` `claim_relationship` edges connect this cluster's members — `ClaimCluster.edgeCount`. */
    edgeCount: integer("edge_count").notNull().default(0),
    /** Per-valence edge tally (`ClaimCluster.counts`: `{contradiction, support, nuance}`) — display only, never re-derived from a live scan. */
    counts: jsonb("counts").notNull().default({}),
    status: debateClusterStatusEnum("status").notNull().default("active"),
    promptVersion: text("prompt_version"),
    provider: text("provider"),
    model: text("model"),
    /** Reused verbatim — the `claim_relationship`/`research_claim` correction-workflow precedent. */
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("unreviewed"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("debate_cluster_project_idx").on(t.projectId),
    index("debate_cluster_user_status_idx").on(t.userId, t.status),
    /** The whole naming-idempotency contract: ANY prior cluster (active or
     *  stale) with this exact membership, in this project, is reused rather
     *  than re-named. */
    uniqueIndex("debate_cluster_user_project_member_hash_unique").on(t.userId, t.projectId, t.memberHash),
  ],
);

/** Which claims belong to a cluster — the BFS component's membership, materialized. */
export const debateClusterMembers = pgTable(
  "debate_cluster_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clusterId: uuid("cluster_id").notNull().references(() => debateClusters.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("debate_cluster_member_cluster_idx").on(t.clusterId),
    index("debate_cluster_member_claim_idx").on(t.claimId),
    uniqueIndex("debate_cluster_member_cluster_claim_unique").on(t.clusterId, t.claimId),
  ],
);

/** Which judged edges (non-`unrelated` `claim_relationship` rows) connect a cluster's members — the BFS component's own edge set, materialized. */
export const debateClusterRelationships = pgTable(
  "debate_cluster_relationship",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clusterId: uuid("cluster_id").notNull().references(() => debateClusters.id, { onDelete: "cascade" }),
    claimRelationshipId: uuid("claim_relationship_id").notNull().references(() => claimRelationships.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("debate_cluster_relationship_cluster_idx").on(t.clusterId),
    index("debate_cluster_relationship_rel_idx").on(t.claimRelationshipId),
    uniqueIndex("debate_cluster_relationship_cluster_rel_unique").on(t.clusterId, t.claimRelationshipId),
  ],
);

/* -------------------------------------------------------------------------
 * Phase 27.1 (migration 0042): the Evidence Chamber — a neutral, structured
 * comparison of the positions inside a `debate_cluster`
 * (`packages/claims/src/prompts/evidenceChamber.ts`). This is the schema-
 * level enforcement half of the plan's "never declares a winner" rule (the
 * other two halves are the prompt's own instructions and
 * `validateEvidenceChamberResponse`'s recursive forbidden-key rejection):
 * NEITHER `evidence_chamber` NOR `evidence_chamber_position` NOR
 * `evidence_chamber_position_claim` HAS A WINNER/VERDICT/STRONGER COLUMN,
 * ANYWHERE, EVER — there is no column for a future migration to widen into
 * one either, unlike `claim_relationship_mechanism_matches_valence`'s
 * deliberate staged-widening CHECK above. Positions render in ordinal
 * order (`evidence_chamber_position.ordinal`), never sorted or ranked by
 * any derived score.
 * ------------------------------------------------------------------------- */

/**
 * Mirrors `EvidenceChamberPosition.stanceConfidence` exactly — the model's
 * own self-reported confidence in how strongly the SOURCE TEXT states this
 * position (never the model's confidence in who is right, per the prompt's
 * own instruction). Kept alongside a derived numeric `stance_confidence`
 * column below (the `claim_score.score`/`label` precedent: a real column
 * for filtering/display alongside the label a reader actually reads).
 */
export const evidenceChamberStanceConfidenceEnum = pgEnum("evidence_chamber_stance_confidence_label", [
  "high",
  "medium",
  "low",
]);

/** Deterministic label -> [0,1] mapping for `evidence_chamber_position.stance_confidence`
 *  (worker-side, reused by `apps/web`'s read path for display-only rounding
 *  checks) — never a model-invented number, just a fixed, documented scale
 *  applied to the model's own three-way self-report. */
export const EVIDENCE_CHAMBER_STANCE_CONFIDENCE_VALUE: Record<"high" | "medium" | "low", number> = {
  high: 0.9,
  medium: 0.6,
  low: 0.3,
};

/**
 * One synthesis of a `debate_cluster`'s positions (plan §Schema
 * `evidence_chamber`), produced by `buildEvidenceChamberPrompt`/
 * `validateEvidenceChamberResponse`. Project-scoped like `claim_relationship`/
 * `debate_cluster` (the same O(n²)-bounding discipline, even though a
 * chamber synthesis is one call per cluster, not a pairwise scan).
 *
 * `basis_hash` (sha256 over the cluster's member claim ids + their own
 * text/excerpt + prompt version — `computeChamberBasisHash`,
 * `@ice/claims`'s `basisHash.ts`) is this table's re-synthesis/idempotency
 * key: a re-run over an UNCHANGED cluster membership and prompt version
 * reuses the key and costs $0 (`UNIQUE (user_id, cluster_id, basis_hash)`
 * below), while a real change (the cluster's membership shifted, or a
 * member claim's text/excerpt changed, or a prompt-version bump)
 * legitimately re-synthesizes and re-pays. Multiple rows CAN exist for the
 * same `cluster_id` over time (one per distinct basis hash, e.g. across a
 * membership change) — the read path picks the most recent `active` one;
 * older rows are never deleted, only left as history (no explicit
 * `superseded`-marking sweep ships in this lane — a documented, narrower
 * scope than `debate_cluster`'s own stale-marking pass, since a chamber's
 * FULL content — not just a name — is comparatively expensive to keep
 * continuously current).
 *
 * There is deliberately no deterministic fallback synthesis (unlike
 * `debate_cluster`'s `deterministicFallbackName`): a chamber's entire value
 * is its structured neutral comparison, so a row is only ever written on a
 * genuine, validated model response — `provider`/`model`/`prompt_version`
 * are therefore NOT NULL, unlike `debate_cluster`'s nullable provenance
 * triple.
 */
export const evidenceChambers = pgTable(
  "evidence_chamber",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    clusterId: uuid("cluster_id").notNull().references(() => debateClusters.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    sharedGround: text("shared_ground").notNull(),
    pointOfDivergence: text("point_of_divergence").notNull(),
    possibleReconciliation: text("possible_reconciliation").notNull(),
    unresolvedQuestion: text("unresolved_question").notNull(),
    missingEvidence: text("missing_evidence").notNull(),
    nextAction: text("next_action").notNull(),
    /** sha256 over the cluster's member claim ids + text/excerpt + prompt version — this table's re-synthesis/idempotency key. */
    basisHash: text("basis_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** `active`/`superseded` — the `research_claim`/`claim_relationship` precedent; never deleted. */
    status: researchObjectStatusEnum("status").notNull().default("active"),
    /** Reused verbatim — the `claim_relationship`/`debate_cluster` correction-workflow precedent (the correction UX itself is Phase 29.2; this column exists so `research_revision` has somewhere real to point at). */
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("unreviewed"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("evidence_chamber_project_idx").on(t.projectId),
    index("evidence_chamber_cluster_idx").on(t.clusterId),
    index("evidence_chamber_user_status_idx").on(t.userId, t.status),
    /** The whole re-synthesis-idempotency contract: an UNCHANGED basis hash for this cluster reuses the existing row rather than paying to re-synthesize. */
    uniqueIndex("evidence_chamber_user_cluster_basis_unique").on(t.userId, t.clusterId, t.basisHash),
  ],
);

/**
 * One position within a chamber (plan §Schema: "positions render in ordinal
 * order") — `EvidenceChamberResult.positions[]`, persisted in the EXACT
 * order the model returned them (`ordinal` = array index), never re-sorted
 * by any score. `stance_confidence_label` is the model's own verbatim
 * three-way self-report; `stance_confidence` is the fixed, documented
 * `EVIDENCE_CHAMBER_STANCE_CONFIDENCE_VALUE` mapping of that label — a
 * display/filter convenience derived from a closed three-value vocabulary,
 * never a model-invented decimal (the `claim_score.score`/`label` split
 * applied here to a three-way enum instead of a continuous scorer).
 */
export const evidenceChamberPositions = pgTable(
  "evidence_chamber_position",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chamberId: uuid("chamber_id").notNull().references(() => evidenceChambers.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    label: text("label").notNull(),
    summary: text("summary").notNull(),
    method: text("method").notNull(),
    scope: text("scope").notNull(),
    stanceConfidenceLabel: evidenceChamberStanceConfidenceEnum("stance_confidence_label").notNull(),
    /** Derived from `stance_confidence_label` via `EVIDENCE_CHAMBER_STANCE_CONFIDENCE_VALUE` — never itself a model output. */
    stanceConfidence: real("stance_confidence").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("evidence_chamber_position_chamber_idx").on(t.chamberId),
    /** Positions render in ordinal order — this is what makes that order stable and unambiguous per chamber. */
    uniqueIndex("evidence_chamber_position_chamber_ordinal_unique").on(t.chamberId, t.ordinal),
    check("evidence_chamber_position_stance_confidence_range", sql`${t.stanceConfidence} >= 0 AND ${t.stanceConfidence} <= 1`),
  ],
);

/**
 * Which `research_claim`(s) ground a chamber position (plan §Build "every
 * position >=1 claim enforced in the write transaction") — a position is
 * never persisted without at least one row here, and this is the ONLY
 * mechanism by which a position's neutral summary traces back to real
 * source text. The chamber prompt presents each cluster claim to the model
 * as a short synthetic label (`CLAIM_1`, `CLAIM_2`, ...), and asks each
 * position for the `claimLabels` it draws from — the CONFLICT_N/`labelToReal`
 * label-then-validate pattern `hypothesis.ts`'s `buildHypothesisPrompt`/
 * `validateHypothesisResponse` already uses. `validateEvidenceChamberResponse`
 * (`@ice/claims`) resolves those labels back to real claim ids via the SAME
 * map the prompt was built with, dropping any label that doesn't resolve
 * (a fabrication) and dropping a position outright if it's left with zero
 * resolved claims — never a second model call, never a guess persisted.
 * This replaced an earlier title-matching contract (`matchChamberPositionClaims`,
 * matching a position's `label` against a claim's owning-work title) that a
 * real canary found unworkable: a real synthesis's position labels are often
 * granular interpretive-stance phrases ("Corrupt Rational Endorsement"), not
 * work titles, so title-matching silently failed on real model output.
 *
 * `excerpt` is a snapshot of the matched claim's `supporting_excerpt` AT
 * SYNTHESIS TIME (not a live join) — the `research_revision` before/after
 * snapshot precedent, applied here so a chamber's displayed evidence never
 * silently changes out from under a reader if the claim is later edited,
 * hidden, or rebound by a reprocess.
 */
export const evidenceChamberPositionClaims = pgTable(
  "evidence_chamber_position_claim",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    positionId: uuid("position_id").notNull().references(() => evidenceChamberPositions.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    /** A literal snapshot of `research_claim.supporting_excerpt` at synthesis time — never re-derived, never empty. */
    excerpt: text("excerpt").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("evidence_chamber_position_claim_position_idx").on(t.positionId),
    index("evidence_chamber_position_claim_claim_idx").on(t.claimId),
    uniqueIndex("evidence_chamber_position_claim_position_claim_unique").on(t.positionId, t.claimId),
    uniqueIndex("evidence_chamber_position_claim_position_ordinal_unique").on(t.positionId, t.ordinal),
    check("evidence_chamber_position_claim_excerpt_nonempty", sql`char_length(trim(${t.excerpt})) > 0`),
  ],
);

/* -------------------------------------------------------------------------
 * Phase 27.2 (migration 0043): hypotheses + research gaps. `research_hypothesis`
 * ports ScholarLens's `[CONFLICT_N]` label-then-validate hypothesis generation
 * (`@ice/claims`'s `prompts/hypothesis.ts`) over a project's detected,
 * undisputed `claim_relationship` conflicts (contradiction/nuance); novelty is
 * ALWAYS computed (cosine distance vs. the project's own `research_claim_embedding`
 * vectors), never self-assessed by the model (plan §Crown jewels "Computed
 * novelty scoring"). `research_gap` is the $0, no-LLM structural counterpart:
 * a deterministic, template-based row per `debate_cluster` that still carries
 * an unresolved contradiction — same "no fabricated content" discipline as
 * `packages/curriculum`'s deterministic checkpoint sentences.
 * ------------------------------------------------------------------------- */

/**
 * How a hypothesis was grounded. `detected_conflicts` is the only value this
 * lane's worker ever writes — every `research_hypothesis` row is required (by
 * the label-then-validate pattern: a hypothesis with zero validated
 * `research_hypothesis_source` rows is dropped, never inserted) to cite at
 * least one real conflict. `single_work_gaps` is a Stage-1 honest placeholder
 * (the `claim_relation_mechanism` precedent): when a project has zero
 * undisputed conflicts to hypothesize about, the worker skips hypothesis
 * generation entirely rather than inventing one, and derives `research_gap`
 * rows instead — this value is reserved for a future lane that generates a
 * hypothesis FROM a gap rather than a conflict, not written by this one.
 */
export const researchHypothesisGroundingEnum = pgEnum("research_hypothesis_grounding", [
  "detected_conflicts",
  "single_work_gaps",
]);

/** Mirrors `@ice/claims`'s `NoveltyTier` exactly (`novelty.ts`). `unknown`
 *  means novelty WAS attempted (an embedder was configured) but the project's
 *  claim corpus had nothing to compare against yet — distinct from a fully
 *  NULL novelty (embedder unavailable, never attempted at all): see
 *  `research_hypothesis_novelty_provenance` below. */
export const researchHypothesisNoveltyTierEnum = pgEnum("research_hypothesis_novelty_tier", [
  "high",
  "medium",
  "low",
  "unknown",
]);

/**
 * A generated research hypothesis (plan §Schema `research_hypothesis`): the
 * output of `generate_hypotheses`, always grounded in real, cited conflicts
 * (never a whole-project synthesis with no traceable source — the
 * label-then-validate pattern's whole point). `run_hash` is this row's OWN
 * content-addressed identity — sha256 of THIS hypothesis's own validated,
 * sorted `sourceConflictIds` + the research question + prompt version +
 * novelty embedding model (`@ice/claims`'s `computeHypothesisRunHash`) — so a
 * hypothesis grounded in an unchanged set of conflicts, under an unchanged
 * question/prompt/model, is never duplicated across re-runs, exactly like
 * `research_claim.content_hash` or `claim_relationship.basis_hash` are their
 * own rows' identities. This is DELIBERATELY row-scoped, not job-scoped: a
 * single `generate_hypotheses` call can validly produce several hypotheses
 * that each cite different subsets of the same conflict pool, and each gets
 * its own hash — `UNIQUE (user_id, run_hash)` protects against a literal
 * duplicate hypothesis, not against a second LLM call being made at all. The
 * SEPARATE guarantee that a genuinely identical whole-job re-run costs $0 is
 * enforced one layer up, in the worker (`generateHypotheses.ts`'s own
 * pre-call check against a prior COMPLETED `research_job_request` sharing the
 * same idempotency key) — see that file's doc comment for why job-level
 * dedup could not be expressed as a single `run_hash` column here without
 * breaking "more than one hypothesis per job" outright.
 *
 * Novelty is computed, never model-asserted (`@ice/claims`'s `noveltyFor`) —
 * `research_hypothesis_novelty_provenance` below enforces that
 * `novelty_embedding_model`/`novelty_corpus` are set together with
 * `novelty_tier` or not at all, so a tier can never appear with no record of
 * what it was measured against.
 */
export const researchHypotheses = pgTable(
  "research_hypothesis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    /** The researcher's own free-text question, when one was given at
     *  dispatch time (`generate_hypotheses` scope's optional `question`) —
     *  null when the run instead asked for "the most promising directions". */
    question: text("question"),
    statement: text("statement").notNull(),
    rationale: text("rationale").notNull(),
    methodology: text("methodology").notNull(),
    /** `HypothesisResult.challenges` — a list of predicted obstacles. */
    challenges: jsonb("challenges").notNull().default([]),
    grounding: researchHypothesisGroundingEnum("grounding").notNull().default("detected_conflicts"),
    /** Cosine DISTANCE (1 - similarity) to the nearest claim in the project's
     *  own embedded corpus — null exactly when novelty was never attempted
     *  (no embedder configured) OR the corpus was empty (`tier = 'unknown'`,
     *  where a distance would be a fabricated number, not a measurement). */
    noveltyDistance: real("novelty_distance"),
    noveltyTier: researchHypothesisNoveltyTierEnum("novelty_tier"),
    /** The embedding model novelty was measured under — required whenever
     *  `novelty_tier` is set, so a later model swap can never be silently
     *  compared against a stale-model tier (the `thresholds.ts`
     *  `assertThresholdsCalibratedFor` discipline, recorded per-row here). */
    noveltyEmbeddingModel: text("novelty_embedding_model"),
    /** Human/audit-readable descriptor of what corpus novelty was measured
     *  against, e.g. `"project_claims:42"` — never a raw vector dump, just
     *  enough to explain the number (the `research_job_request.note` honesty
     *  precedent, applied to one row instead of a whole job). */
    noveltyCorpus: text("novelty_corpus"),
    runHash: text("run_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    /** Reused verbatim — the `research_claim`/`claim_relationship`/`debate_cluster` precedent. */
    status: researchObjectStatusEnum("status").notNull().default("active"),
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("unreviewed"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_hypothesis_project_idx").on(t.projectId),
    index("research_hypothesis_user_status_idx").on(t.userId, t.status),
    uniqueIndex("research_hypothesis_user_run_hash_unique").on(t.userId, t.runHash),
    check("research_hypothesis_statement_nonempty", sql`char_length(trim(${t.statement})) > 0`),
    /** The novelty CHECK the plan calls for: `novelty_embedding_model` and
     *  `novelty_corpus` are required together with `novelty_tier` — either
     *  all three are null (novelty never attempted) or all three are set
     *  (novelty was attempted, whatever the resulting tier). */
    check(
      "research_hypothesis_novelty_provenance",
      sql`(${t.noveltyTier} IS NULL AND ${t.noveltyEmbeddingModel} IS NULL AND ${t.noveltyCorpus} IS NULL)
        OR (${t.noveltyTier} IS NOT NULL AND ${t.noveltyEmbeddingModel} IS NOT NULL AND ${t.noveltyCorpus} IS NOT NULL)`,
    ),
    /** Tightens the invariant above: a REAL tier (high/medium/low) must carry
     *  a real measured distance; only `unknown` (an empty corpus — nothing to
     *  measure against) is allowed to leave `novelty_distance` null rather
     *  than persist a meaningless placeholder number. */
    check(
      "research_hypothesis_novelty_distance_present",
      sql`${t.noveltyTier} IS NULL OR ${t.noveltyTier} = 'unknown' OR ${t.noveltyDistance} IS NOT NULL`,
    ),
  ],
);

/**
 * Which real, validated conflicts (`claim_relationship` rows) a hypothesis
 * cites — the label-then-validate pattern's durable record (plan §Schema
 * `research_hypothesis`: "`[CONFLICT_N]` grounding"). Cascades from
 * `claim_relationship`: if a cited relationship is later deleted outright
 * (not just hidden/disputed — those stay real rows), this join row goes with
 * it, but the hypothesis itself survives with whatever OTHER sources remain
 * (a hypothesis is never deleted just because one of several citations did).
 */
export const researchHypothesisSources = pgTable(
  "research_hypothesis_source",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hypothesisId: uuid("hypothesis_id").notNull().references(() => researchHypotheses.id, { onDelete: "cascade" }),
    claimRelationshipId: uuid("claim_relationship_id").notNull().references(() => claimRelationships.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_hypothesis_source_hypothesis_idx").on(t.hypothesisId),
    index("research_hypothesis_source_relationship_idx").on(t.claimRelationshipId),
    uniqueIndex("research_hypothesis_source_hypothesis_relationship_unique").on(t.hypothesisId, t.claimRelationshipId),
  ],
);

/**
 * The distinct works/corpus items a hypothesis's cited conflicts actually
 * touch (plan §Schema `research_hypothesis_support`: "work XOR corpus_item
 * CHECK") — a materialized, deduplicated denormalization derived from
 * `research_hypothesis_source`'s claim_relationship rows' own claims'
 * `work_id`/`corpus_item_id` (the `research_claim_exactly_one_source` XOR
 * precedent, one level up), so a UI can show "this hypothesis draws on: X, Y"
 * without joining through source -> relationship -> claim -> work every time.
 */
export const researchHypothesisSupport = pgTable(
  "research_hypothesis_support",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hypothesisId: uuid("hypothesis_id").notNull().references(() => researchHypotheses.id, { onDelete: "cascade" }),
    workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
    corpusItemId: uuid("corpus_item_id").references(() => researchCorpusItems.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_hypothesis_support_hypothesis_idx").on(t.hypothesisId),
    uniqueIndex("research_hypothesis_support_hypothesis_work_unique")
      .on(t.hypothesisId, t.workId)
      .where(sql`${t.workId} IS NOT NULL`),
    uniqueIndex("research_hypothesis_support_hypothesis_corpus_item_unique")
      .on(t.hypothesisId, t.corpusItemId)
      .where(sql`${t.corpusItemId} IS NOT NULL`),
    check(
      "research_hypothesis_support_exactly_one_target",
      sql`(${t.workId} IS NOT NULL AND ${t.corpusItemId} IS NULL) OR (${t.workId} IS NULL AND ${t.corpusItemId} IS NOT NULL)`,
    ),
  ],
);

/**
 * A deterministic, $0, no-LLM structural finding (plan §Schema
 * `research_gap`): one row per ACTIVE `debate_cluster` that still carries at
 * least one unresolved contradiction edge — "this remains a documented open
 * disagreement in your library" is a plain fact about the graph, not a
 * synthesized insight, so it costs nothing and can never be fabricated (the
 * `packages/curriculum` deterministic-checkpoint precedent, applied to a
 * per-project structural summary instead of a per-category lookup).
 * `(user_id, debate_cluster_id)` is the whole idempotency contract: a re-run
 * over an unchanged cluster reuses (and refreshes) the same row rather than
 * duplicating it, and a cluster later going `stale` (plan §Pipeline
 * "membership shifts mark old clusters stale, never delete") leaves this row
 * in place too — a gap about a debate that's since been reclassified is still
 * honest history, not something to silently delete.
 */
export const researchGaps = pgTable(
  "research_gap",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => researchProjects.id, { onDelete: "cascade" }),
    debateClusterId: uuid("debate_cluster_id").notNull().references(() => debateClusters.id, { onDelete: "cascade" }),
    /** Deterministic template sentence over the cluster's own `name`/
     *  `research_question` (`@ice/claims`'s `buildGapDescription`) — never
     *  model-authored. */
    description: text("description").notNull(),
    /** `debate_cluster.counts.contradiction` at the time this row was last
     *  written — display/audit only, refreshed on every idempotent re-run. */
    unresolvedContradictionCount: integer("unresolved_contradiction_count").notNull(),
    status: researchObjectStatusEnum("status").notNull().default("active"),
    verificationStatus: verificationStatusEnum("verification_status").notNull().default("unreviewed"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_gap_project_idx").on(t.projectId),
    index("research_gap_user_status_idx").on(t.userId, t.status),
    uniqueIndex("research_gap_user_cluster_unique").on(t.userId, t.debateClusterId),
    check("research_gap_count_nonnegative", sql`${t.unresolvedContradictionCount} >= 0`),
  ],
);
