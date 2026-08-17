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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { bibliographicRecords, citations } from "./citationsGraph";
import { processingRuns, textBlocks } from "./editionPipeline";
import {
  competencySignalStatusEnum,
  conceptKindEnum,
  edgeTypeEnum,
  masterySourceEnum,
  passageAnnotationTypeEnum,
  provenanceEnum,
  readerLevelEnum,
  recordRoleEnum,
  relationshipCategoryEnum,
  verificationStatusEnum,
} from "./enums";
import { ragConversations, ragMessages } from "./rag";
import { researchResources } from "./researchResources";
import { works } from "./works";

/* ---------------------------------------------------------------------------
 * Phase 9 — Interactive Learning Workspace (plan §34)
 *
 * 9.1 lands the schema only: nothing writes to these tables yet. They exist
 * first so the pipeline (9.2), the reader (9.3–9.4), the Library (9.5) and the
 * curriculum (9.6) can all be built against one set of canonical identities
 * instead of each inventing its own.
 * ------------------------------------------------------------------------ */

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
