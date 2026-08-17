import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { bibliographicRecords } from "./citationsGraph";
import { processingRuns } from "./editionPipeline";
import { recordRoleEnum } from "./enums";

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
