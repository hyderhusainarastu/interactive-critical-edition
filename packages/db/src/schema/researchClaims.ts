import {
  type AnyPgColumn,
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
  vector,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { processingRuns, textBlocks } from "./editionPipeline";
import {
  claimAnchorStateEnum,
  claimEngagementEnum,
  claimJudgeBranchEnum,
  claimLocusOriginEnum,
  claimNatureEnum,
  claimRelationCategoryEnum,
  claimRelationMechanismEnum,
  claimRelationValenceEnum,
  claimScoreDimensionEnum,
  claimScoreLabelEnum,
  claimSideEnum,
  claimSourceScopeEnum,
  corpusSourceEnum,
  debateClusterStatusEnum,
  evidenceChamberStanceConfidenceEnum,
  provenanceEnum,
  researchHypothesisGroundingEnum,
  researchHypothesisNoveltyTierEnum,
  researchJobCoverageEnum,
  researchJobStatusEnum,
  researchJobTypeEnum,
  researchMemberRoleEnum,
  researchMemberTypeEnum,
  researchMonitorCadenceEnum,
  researchMonitorTypeEnum,
  researchObjectStatusEnum,
  researchObjectTypeEnum,
  researchRevisionActionEnum,
  verificationStatusEnum,
} from "./enums";
import { writerProjects } from "./graphWriter";
import { ragConversations } from "./rag";
import { works } from "./works";

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

export const researchMonitors = pgTable(
  "research_monitor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Optional project this monitor's hits are meant to feed — display
     *  grouping only; a monitor works standalone with this null (the global
     *  `/research/monitors` view). `set null` on project delete: the monitor
     *  and its accumulated hits outlive a deleted project, unlike the hard
     *  `cascade` on `userId` above. */
    projectId: uuid("project_id").references(() => researchProjects.id, { onDelete: "set null" }),
    monitorType: researchMonitorTypeEnum("monitor_type").notNull(),
    /** Free-text topic keywords, a DOI/arXiv seed id, or an author display
     *  name — which, per `monitorType`. Never model-interpreted; passed
     *  straight to the relevant provider query untouched. */
    query: text("query").notNull(),
    cadence: researchMonitorCadenceEnum("cadence").notNull().default("paused"),
    isActive: boolean("is_active").notNull().default(true),
    lastScannedAt: timestamp("last_scanned_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("research_monitor_user_cadence_idx").on(t.userId, t.cadence),
    index("research_monitor_project_idx").on(t.projectId),
  ],
);

/**
 * One discovered candidate for a monitor, deduped per-monitor by `dedup_key`
 * (`normalizedKey()` — DOI > ISBN > URL > normalized title+author+year, the
 * exact function `research_corpus_item` dedupes with — `packages/research/
 * src/normalize.ts`). `imported_corpus_item_id` records the "Add to corpus"
 * one-click outcome without duplicating the corpus item's own fields here;
 * `set null` so a hit's history survives if the imported item is later
 * removed from the corpus.
 */
export const researchMonitorHits = pgTable(
  "research_monitor_hit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id").notNull().references(() => researchMonitors.id, { onDelete: "cascade" }),
    dedupKey: text("dedup_key").notNull(),
    title: text("title").notNull(),
    /** Author display names, provider-supplied — never inferred (the
     *  `research_corpus_item.authors` precedent). */
    authors: jsonb("authors").notNull().default([]),
    year: integer("year"),
    venue: text("venue"),
    url: text("url"),
    provider: text("provider").notNull(),
    seenAt: timestamp("seen_at").notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at"),
    importedCorpusItemId: uuid("imported_corpus_item_id").references(() => researchCorpusItems.id, { onDelete: "set null" }),
  },
  (t) => [
    index("research_monitor_hit_monitor_idx").on(t.monitorId),
    uniqueIndex("research_monitor_hit_monitor_dedup_unique").on(t.monitorId, t.dedupKey),
  ],
);
