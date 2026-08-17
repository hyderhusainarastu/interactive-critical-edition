import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { processingRuns, textBlocks } from "./editionPipeline";
import {
  accessStatusEnum,
  citationResolutionStateEnum,
  citationSourceTypeEnum,
  edgeTypeEnum,
  provenanceEnum,
  relationshipCategoryEnum,
  verificationStatusEnum,
} from "./enums";
import { researchJobRequests } from "./researchClaims";
import { documents } from "./works";

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
