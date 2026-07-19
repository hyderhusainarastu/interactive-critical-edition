import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
   * §14 assumed DB sessions; this is a recorded deviation, see CLAUDE.md).
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("work_user_idx").on(t.userId)]);

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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("document_work_idx").on(t.workId), index("document_user_idx").on(t.userId)]);

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

export const citations = pgTable("citation", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  rawText: text("raw_text").notNull(),
  resolvedBibId: uuid("resolved_bib_id").references(() => bibliographicRecords.id, {
    onDelete: "set null",
  }),
  // "crossref" | "openalex" | "openlibrary" | "unresolved"
  resolutionSource: text("resolution_source").notNull().default("unresolved"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [index("citation_document_idx").on(t.documentId)]);

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
  task: text("task").notNull(),
  stage: text("stage"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  estimatedCostUsd: real("estimated_cost_usd").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

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
  status: readingStatusEnum("status").notNull().default("planned"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("reading_record_user_idx").on(t.userId)]);

export const understandingRatings = pgTable("understanding_rating", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  workId: uuid("work_id").references(() => works.id, { onDelete: "cascade" }),
  bibId: uuid("bib_id").references(() => bibliographicRecords.id, { onDelete: "cascade" }),
  // 0..100 with a derived label in the UI (plan §7). >= 60 = "working
  // understanding" → the roadmap deprioritizes it (personalization pass).
  score: integer("score").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [index("understanding_rating_user_idx").on(t.userId)]);

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
    text: text("text").notNull(),
    confidence: real("confidence"),
  },
  (t) => [index("text_block_page_idx").on(t.pageId, t.blockOrder)],
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("research_resource_run_idx").on(t.runId),
  uniqueIndex("research_resource_run_key_unique").on(t.runId, t.normalizedKey),
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
