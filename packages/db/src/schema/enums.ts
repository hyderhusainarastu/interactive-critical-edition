import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enum vocabularies shared by more than one schema module. A pgEnum is
 * invoked while a table's columns are being built, so — unlike a
 * `.references(() => table)` thunk — it cannot tolerate a circular import.
 * Collecting the shared ones in this dependency-free module keeps every
 * consumer's evaluation order safe.
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

// --- Auth, users ---
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

// --- Admin, usage, feedback ---
export const deletionCleanupStatusEnum = pgEnum("deletion_cleanup_status", [
  "in_progress",
  "storage_failed",
  "completed",
]);

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

/**
 * Workstream J (v.5): the feedback-modal inbox the admin dashboard reads
 * (`docs/admin` gate). `userId` is a real, nullable FK with `set null` —
 * unlike the two tables above, feedback is meant to stay attributable to a
 * still-existing account when possible, but must survive that account's
 * deletion as an anonymized row rather than being destroyed with it.
 */
export const feedbackCategoryEnum = pgEnum("feedback_category", ["bug", "idea", "praise", "other"]);

// --- Works, documents, reader ---
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

/** A suggested pair never changes reading text until a person verifies it. */
export const termVerificationStatusEnum = pgEnum("term_verification_status", ["suggested", "verified"]);

// --- Edition pipeline (processing runs, text blocks, foreign spans) ---
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

// --- Citations, bibliographic records, annotations ---
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

/** Where a work was cited in the uploaded source, never inferred from lookup metadata. */
export const citationSourceTypeEnum = pgEnum("citation_source_type", ["bibliography", "footnote", "endnote", "inline"]);

export const citationResolutionStateEnum = pgEnum("citation_resolution_state", ["pending", "resolved", "unresolved"]);

// --- Concepts, identity, competency ---
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

// --- Reading roadmap, knowledge profile ---
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

// --- Graph expansion, Writer ---
export const graphExpansionStatusEnum = pgEnum("graph_expansion_status", [
  "planned",
  "queued",
  "running",
  "complete",
  "failed",
]);

// --- RAG chunks, conversations, author apparatus ---
/**
 * Phase 18: owner-scoped retrieval chunks. Uploaded source blocks and
 * explicitly licensed open-access research content are deliberately kept in
 * one narrow index with a durable owner id, a stable source key, and a
 * source-location anchor. Neither provider metadata nor unlicensed text is
 * eligible for this table.
 */
export const ragChunkSourceEnum = pgEnum("rag_chunk_source", ["uploaded", "open_access"]);

export const ragConversationStatusEnum = pgEnum("rag_conversation_status", ["active", "archived"]);

export const ragMessageRoleEnum = pgEnum("rag_message_role", ["user", "assistant"]);

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

// --- Research resources, credibility ---
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

// --- Research claims, relationships, debates, hypotheses, monitors ---
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
 * Phase 29.1: scheduled research monitoring (plan §Pipeline monitoring —
 * "in-app only" delivery per the owner's decision; no email digest surface).
 * Three monitor types share one table:
 *
 *  - `topic` — free-text keywords, scanned via `searchCorpusCandidates()`
 *    (Semantic Scholar + OpenAlex + arXiv fan-out, the same zero-AI-cost
 *    corpus-import search Phase 28.2 already ships).
 *  - `citation_alert` — a DOI-or-arXiv seed paper; new papers citing it, via
 *    Semantic Scholar's citations graph (`lookupCitations`).
 *  - `author_follow` — an author display name; their newest S2-indexed
 *    papers (`lookupAuthorRecentPapers`).
 *
 * Zero AI cost end-to-end: every hit is a real provider metadata record,
 * copied verbatim — never an LLM inference (the `research_corpus_item`
 * anti-hallucination precedent one table up literally, and several tables up
 * in this file's own history).
 *
 * `cadence` DEFAULTS `paused` (a monitor never scans until the user opts it
 * in) and the whole surface sits behind `phase25FeatureEnabled("monitoring")`,
 * which also DEFAULTS false (`packages/config/src/phase25.ts`) — two
 * independent off switches, not one, because a scheduled job is the one
 * Phase 25 surface that can act without a user present.
 */
export const researchMonitorTypeEnum = pgEnum("research_monitor_type", ["topic", "citation_alert", "author_follow"]);

export const researchMonitorCadenceEnum = pgEnum("research_monitor_cadence", ["daily", "weekly", "paused"]);
