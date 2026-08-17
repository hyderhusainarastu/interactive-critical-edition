import {
  boolean,
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
import {
  foreignDirectionEnum,
  foreignLanguageBasisEnum,
  foreignScriptEnum,
  foreignSpanDeferredReasonEnum,
  foreignSpanProvenanceKindEnum,
  foreignSpanStatusEnum,
  foreignTranscriptionStatusEnum,
  processingRunStatusEnum,
  structureStateEnum,
  textBlockKindEnum,
} from "./enums";
import { documents } from "./works";

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
