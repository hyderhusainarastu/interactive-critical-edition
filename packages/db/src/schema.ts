import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
  task: text("task").notNull(),
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
});

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
});

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
});
