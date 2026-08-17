import type { CurriculumStage } from "@ice/curriculum";
import type { PriorityTier, ReaderLevelFilter, RelationshipCategory } from "@ice/roadmap";

import type { CredibilityBand } from "./filterGraphData";

export type NodeState = "primary" | "read" | "reading" | "unread" | "missing" | "structural";
/** `claim`/`debate` (Phase 28.4, the knowledge-graph debate layer, behind
 *  `phase25FeatureEnabled('graphDebateLayer')`) are ADDITIVE — every existing
 *  NodeType value and every place that switches on it keeps working
 *  unmodified; a consumer that has never heard of `claim`/`debate` simply
 *  never sees one while the flag is off (`buildGraph()` never emits either
 *  type unless the flag is on). A `debate` node is a named `debate_cluster`
 *  (a BFS connected component over judged, non-`unrelated` `claim_relationship`
 *  edges); a `claim` node is one `research_claim` row, surfaced only via the
 *  debate-cluster expansion endpoint, never in the base payload. */
export type NodeType = "work" | "reference" | "peer_reviewed_source" | "online_source" | "concept" | "person" | "section" | "claim" | "debate";

/**
 * THE graph data contract (plan §21.1). This module is the single typed
 * source of truth for the payload `buildGraph()` (server) emits and that the
 * 3D scene, accessible table, inspector, and filters all consume — one
 * shared dataset filtered once by `filterGraphData()`, never two
 * independently filtered ones. `apps/web/src/lib/graph.ts` imports these
 * types rather than declaring parallel copies.
 */
export interface GraphNode {
  /** Stable canonical id: `work:<uuid>`, `external:bib:<uuid>`,
   *  `external:source:<key>`, `concept:<uuid>`, or `section:<uuid>` —
   *  post-canonical-collapse, so one real-world work is one id. */
  id: string;
  label: string;
  type: NodeType;
  state: NodeState;
  /** True only for the reader's OWN uploaded works — the graph's private
   *  anchors (plan §21.1 "uploaded/private status"). Everything else
   *  (references, sources, concepts, sections) is false. */
  uploaded: boolean;
  /** Node ids (`work:<uuid>`) of the uploaded works this node is directly
   *  associated with; self-inclusive for work nodes. Precomputed by
   *  `buildGraph()` so filters/inspector/table never re-derive it from
   *  edge walks (plan §21.1 "associated work IDs"). */
  associatedWorkIds: string[];
  /** In-app route for this entity when a real one exists: `/works/<id>` for
   *  uploaded works, `/library/<learningResourceId>` for Library-backed
   *  external records (only when the Library page's own ownership gate would
   *  resolve it), null otherwise — never a guessed/404 route. */
  destination: string | null;
  /** Secondary label material (authors/year), shown where appropriate. */
  authors: string | null;
  year: number | null;
  url: string | null;
  /** v2 research enrichment (null for legacy analysis nodes, and for
   *  concept/section nodes, which don't have one). */
  authority?: string | null;
  credibilityScore?: number | null;
  provider?: string | null;
  /** All provider records collapsed into this canonical external-work node. */
  providers?: string[];
  /** `concept_kind` (concept/doctrine/person/tradition/debate) for concept
   *  nodes; null for every other node type. */
  kind?: string | null;
  /** Access and retrieval provenance for external sources. */
  accessStatus?: string | null;
  sourceTextStatus?: string | null;
  license?: string | null;
  sourceUrl?: string | null;
  provenance?: { runId: string; provider: string; inspectedAt: string | null; inspectionDepth: number } | null;
  /** Provenance is plural once multiple runs/providers describe one work. */
  provenances?: { runId: string; provider: string; inspectedAt: string | null; inspectionDepth: number }[];
  /** D/E public material is useful context, never stand-alone factual support. */
  supplementary?: boolean;
  /** Roadmap-mode projection (plan §22.7 / feature plan §2.2). ABSENT on
   *  explore-only payloads — this field is the only difference between an
   *  explore payload and a roadmap payload for a given node, so every
   *  annotation-free code path (`filterGraphData` with the default
   *  `stage: "all"`, every existing graph consumer) is byte-identical to
   *  before it existed. Layered on top of `buildGraph()`'s output by
   *  `buildRoadmapGraph()` (`apps/web/src/lib/roadmapGraph.ts`), never written
   *  to the DB and never recomputed by a consumer. Concept/person/section
   *  nodes never carry one in v1 (the roadmap pipeline is bibliographic —
   *  fabricating a concept's stage placement would violate the grounding
   *  posture); they stay explore-only, see `roadmapSubset` below. */
  roadmap?: RoadmapAnnotation;

  // ---- Data contract v2 (Graph P1, additive — see PROJECT-LOG "Graph
  // redesign"). Every field below is optional and populated only where the
  // underlying data actually exists; a node never fabricates a value for a
  // field its source rows don't carry. Nothing reads these yet (P2 lands the
  // table/inspector/filters that do; P3/P4 the 3D scene). ----

  /** Union of `resource_role.reader_level` across every role targeting this
   *  node. A role with a null level ("applies at every level") expands to
   *  every value in `READER_LEVELS` rather than a separate sentinel, so
   *  `readerLevels.includes(x)` alone answers "does this apply at level x".
   *  Absent (not an empty array) when the node has no `resource_role` data
   *  at all — callers must treat absence the same as "no scoping", never as
   *  "matches nothing" (never punish missing data). Concept/section nodes
   *  never carry one (resource_role only relates a work to a resource). */
  readerLevels?: string[];
  /** How this node relates to the work identity it is canonicalized under —
   *  primary text, review, edition, translation, excerpt (`record_role`
   *  enum: `research_resource.work_role` / `learning_resource.work_role`).
   *  Null/absent when the node was never discovered via research (a
   *  citation-only reference) or carries no merged work-identity role. */
  workRole?: string | null;
  /** Consolidated credibility dossier — the six separated dimensions (plan
   *  §33/§34.2) plus score/authority/relevance/evidenceStrength/
   *  peerReviewed/rationale/creator/popularity, drawn from the SAME winning
   *  assessment/provider as the legacy `authority`/`credibilityScore` fields
   *  above (kept for back-compat, never a second, possibly-inconsistent
   *  source). Null/absent when no `credibility_assessment` row (or, for a
   *  role-only node, no `learning_resource` credibility fact) exists. */
  credibility?: {
    score: number | null;
    authority: string | null;
    publicationRigor: number | null;
    creatorExpertise: number | null;
    hostProvenance: number | null;
    pedagogicalValue: number | null;
    relevance: number | null;
    evidenceStrength: number | null;
    peerReviewed: boolean | null;
    rationale: string | null;
    creator: unknown;
    popularity: unknown;
  } | null;
  /** Raw 0–100 concept-mastery score (concept/person nodes only) — distinct
   *  from `state`, which only expresses read/known at `KNOWN_THRESHOLD`.
   *  Absent for every non-concept node and for a concept with no mastery row
   *  recorded yet (never defaulted to 0 — that would misrepresent "no data"
   *  as "definitely no understanding"). */
  masteryScore?: number | null;
  /** Concept summary/aliases (concept/person nodes only, from the shared
   *  `concept` catalog) — absent for every other node type. */
  summary?: string | null;
  aliases?: string[];
  /** Publication venue, when known (`learning_resource.venue`). */
  venue?: string | null;
  /** Digital Object Identifier, when known. */
  doi?: string | null;

  // ---- Debate layer (Phase 28.4, additive, `graphDebateLayer`-flagged) ----

  /** `debate`-typed nodes only: how many `research_claim` rows are members
   *  of this `debate_cluster` (`ClaimCluster.memberIds.length`, always ≥2 —
   *  `findClaimClusters` never emits a singleton component). Absent on
   *  every other node type. */
  debateClaimCount?: number;
  /** `debate`-typed nodes only: `debate_cluster.research_question`, when the
   *  naming pass produced one — null on the $0 deterministic-fallback-named
   *  path (`deterministicFallbackName` never invents a question), absent on
   *  every other node type. */
  debateQuestion?: string | null;
  /** `claim`-typed nodes only (surfaced by a debate expansion, never the
   *  base payload): `research_claim.claim_nature`. Absent on every other
   *  node type. */
  claimNature?: string | null;
  /** `claim`-typed nodes only: a short, deterministic tally of this claim's
   *  own judged `claim_relationship` edges within the SAME debate expansion
   *  (e.g. "2 support · 1 contradiction") — never a model-authored summary.
   *  Null when none of the expansion's returned relationship edges touch
   *  this claim (never fabricated as "no relationships" vs. "not computed"
   *  — the two are the same fact here since every returned claim is a real
   *  cluster member). Absent on every other node type. */
  valenceSummary?: string | null;
}

/**
 * The read-time roadmap projection attached to a node in roadmap layout mode
 * (feature plan §2.2). Every field is derived deterministically from the pure
 * `@ice/roadmap`/`@ice/curriculum` machinery — no new AI call, no stored
 * snapshot — so a new upload or a changed rating is reflected on the next
 * request. `stage`/`checkpoint` come from `stageForRelationship(category)`/
 * `checkpointFor(category)`; `tier`/`sequence`/`known`/`reason`/`confidence`/
 * `estimatedMinutes`/`addedManually`/`overridden` are the merged `RoadmapItem`'s
 * own fields; `rootWorkIds` records which selected root works reached this
 * node (multi-root provenance, `mergeRoadmapsAcrossRoots`).
 */
export interface RoadmapAnnotation {
  stage: CurriculumStage;
  tier: PriorityTier;
  /** 1-based global reading order after the multi-root merge. */
  sequence: number;
  /** ≥ KNOWN_THRESHOLD or completed — existing roadmap semantics. */
  known: boolean;
  /** Deterministic `reasonFor()` output (no user-facing "AI" wording). */
  reason: string;
  /** Deterministic `checkpointFor()` reflection prompt. */
  checkpoint: string;
  category: RelationshipCategory;
  confidence: number;
  estimatedMinutes: number;
  addedManually: boolean;
  overridden: boolean;
  /** Node ids (`work:<uuid>`) of the selected roadmap roots that reached this
   *  node — empty only for the anchors it is attached to by identity. */
  rootWorkIds: string[];
}

export interface GraphLink {
  /** Stable id (`source|edgeType|target`) — unique after `buildGraph()`'s
   *  read-side dedup, since that dedup keys on exactly this triple. */
  id: string;
  source: string;
  target: string;
  edgeType: string;
  /** False for inherently symmetric relations (`is_comparable_to`) — the
   *  contract's explicit direction flag, so no consumer has to guess
   *  whether source→target order is meaningful (plan §21.1 "direction"). */
  directed: boolean;
  /** Union of both endpoints' `associatedWorkIds`. */
  associatedWorkIds: string[];
  category: string | null;
  confidence: number;
  explanation?: string | null;
  evidence?: unknown;
  provenance?: { relationId: string; runId: string; depth: number } | null;
  evidences?: unknown[];
  provenances?: { relationId: string; runId: string; depth: number }[];
  /** Data contract v2 (Graph P1, additive): promoted from `evidence.readerLevel`
   *  on `resource_role`/`passage_annotation`-derived edges — the evidence copy
   *  is kept for back-compat, this is the contract-level field new consumers
   *  should read. Null/absent on every other edge kind (citation/concept/
   *  outline/source-discovery/cross-library/etc.), which carries no
   *  reader-level scoping at all. */
  readerLevel?: string | null;
}

export interface GraphStats {
  works: number;
  references: number;
  sources: number;
  concepts: number;
  people: number;
  missing: number;
  read: number;
}

/** What `buildGraph()` returns — the API routes add `title`/`analysisStatus`. */
export interface GraphPayload {
  nodes: GraphNode[];
  links: GraphLink[];
  stats: GraphStats;
}

export interface GraphData extends GraphPayload {
  title: string;
  analysisStatus?: string;
}

// State → palette token + human label. Color is never the only signal —
// the table fallback and the node labels carry the same meaning (plan §20).
export const STATE_META: Record<NodeState, { label: string; colorVar: string }> = {
  primary: { label: "Uploaded work", colorVar: "--color-accent-ink" },
  read: { label: "Read", colorVar: "--color-accent-green" },
  reading: { label: "Reading", colorVar: "--color-highlight" },
  // Was "In library, unread" — accurate for reference nodes, but concept
  // nodes carry this same state too (plan §34.4 9.7) and aren't "acquired"
  // into a library, so the label was narrowed to something true of both.
  unread: { label: "Unread", colorVar: "--color-accent-umber" },
  missing: { label: "Referenced, not acquired", colorVar: "--color-accent-burgundy" },
  structural: { label: "Section", colorVar: "--color-text-muted" },
};

export const STATE_ORDER: NodeState[] = ["primary", "reading", "unread", "read", "missing", "structural"];

export const TYPE_LABEL: Record<NodeType, string> = {
  work: "Work",
  reference: "Reference",
  peer_reviewed_source: "Peer-reviewed source",
  online_source: "Online source",
  concept: "Concept",
  person: "Person",
  section: "Section",
  claim: "Claim",
  debate: "Debate",
};

// The 3D projection is type-coloured. Read state remains a textual/table
// label, avoiding the old situation where one colour tried to mean two things.
export const TYPE_META: Record<NodeType, { colorVar: string }> = {
  work: { colorVar: "--color-accent-ink" },
  reference: { colorVar: "--color-accent-umber" },
  peer_reviewed_source: { colorVar: "--color-accent-green" },
  online_source: { colorVar: "--color-highlight" },
  concept: { colorVar: "--color-accent-burgundy" },
  person: { colorVar: "--color-credibility-warning" },
  section: { colorVar: "--color-text-muted" },
  // Debate layer (Phase 28.4): `debate` reuses `--color-credibility-critical`
  // — unused elsewhere in this table, and thematically apt for a contested
  // cluster. `claim` gets a dedicated token (`--color-graph-claim`,
  // `app/globals.css`) rather than reusing another type's color, since claim
  // nodes appear ALONGSIDE their asserting work/reference nodes once a
  // debate is expanded and would otherwise be indistinguishable by color.
  claim: { colorVar: "--color-graph-claim" },
  debate: { colorVar: "--color-credibility-critical" },
};

/**
 * Multi-filter semantics (Phase 21.3 / plan §21.3 "OR/AND semantics"
 * requirement, documented rather than invented): every field here is a
 * SINGLE-select control today — `search`/`state`/`type`/`authority`/
 * `provider`/`relation`/`credibilityBand`/`associatedWork` each hold exactly
 * one active value or `"all"`. Across DIFFERENT fields, `filterGraphData`
 * combines them with AND (a node must satisfy every active field's
 * predicate — see the `&&`-chain in `filterGraphData` below); there is no
 * OR between, say, an active `state` filter and an active `type` filter.
 * WITHIN one field there is only ever one selectable value at a time, so
 * there is no multi-value OR/AND to display in the UI — the plan's
 * "multiple relation filters have defined OR/AND semantics" line presumes a
 * multi-select control (e.g. a checkbox group for `relation`) that does not
 * exist yet. If a future sub-phase adds multi-select to any of these
 * fields, that field's own values should combine with OR (matches any of
 * the selected values) while still AND-ing against every other field —
 * consistent with how filter combination normally reads to users — and the
 * UI should say so explicitly next to that control; until then, this
 * comment is the documented decision, not a placeholder.
 */
export interface GraphFilters {
  search: string;
  state: NodeState | "all";
  type: NodeType | "all";
  authority: string | "all";
  provider: string | "all";
  relation: string | "all";
  credibilityBand: CredibilityBand | "all";
  associatedWork: string | "all";
  /** Roadmap-mode curriculum-stage filter (feature plan §2.2). `"all"` (the
   *  default) is a no-op, so every explore-mode/annotation-free payload is
   *  filtered byte-identically to before this field existed. A concrete
   *  stage matches only annotated nodes in that stage; uploaded-work anchors
   *  keep the D-21-10 exemption (they are attribute-filter-exempt), and
   *  D-21-1 edge behavior is unchanged. */
  stage: CurriculumStage | "all";
  /** Data contract v2 (Graph P1, additive): reader-level narrowing. Shares
   *  the `ReaderLevelFilter` vocabulary — and, deliberately, the same
   *  "readerLevel" URL key — that `GraphView`'s pre-existing roadmap-mode
   *  server request already uses; see that component's own comments for why
   *  P1 does not yet wire this field to the URL (P2's "filters" sub-phase
   *  does, per the redesign's phasing). `"all"` (the default) is a no-op. A
   *  node whose `readerLevels` is absent/empty carries no scoping data and is
   *  never excluded (never punish missing data) — matching
   *  `matchesReaderLevel`'s null-materialLevel rule, reused via
   *  `matchesAnyReaderLevel` below rather than re-derived. */
  readerLevel: ReaderLevelFilter;
  /** Data contract v2 (Graph P1, additive): concept-kind narrowing
   *  (concept/doctrine/person/tradition/debate). Applies only to
   *  concept/person-typed nodes (`GraphNode.kind`) — every other node type
   *  has no concept kind and stays exempt (never punish missing data), the
   *  same spirit as the D-21-10 anchor exemption for a field that is simply
   *  inapplicable rather than absent-by-omission. */
  conceptKind: string | "all";
}

/**
 * `concept_kind` enum (`packages/db/src/schema.ts`'s `conceptKindEnum`) —
 * mirrored here (apps/web cannot import from packages/db) purely for the
 * display label, the same manual-sync pattern
 * `RELATIONSHIP_CATEGORY_TO_EDGE_TYPE` above already uses. Graph P2: backs
 * the concept-kind filter select and the accessible table's concept-kind
 * column/text.
 */
export const CONCEPT_KINDS = ["concept", "doctrine", "person", "tradition", "debate"] as const;
export type ConceptKind = (typeof CONCEPT_KINDS)[number];
export const CONCEPT_KIND_LABEL: Record<ConceptKind, string> = {
  concept: "Concept",
  doctrine: "Doctrine",
  person: "Person",
  tradition: "Tradition",
  debate: "Debate",
};
export function conceptKindLabel(kind: string | null | undefined): string | null {
  if (!kind) return null;
  return CONCEPT_KIND_LABEL[kind as ConceptKind] ?? kind.replace(/_/g, " ");
}

/**
 * The six separated credibility dimensions (plan §33/§34.2) as they appear
 * on `GraphNode.credibility` — keys match that object's field names exactly
 * so a caller can iterate `CREDIBILITY_DIMENSIONS` and index straight into
 * `selected.credibility[key]` with no separate mapping table to drift.
 * Graph P2: backs the inspector's credibility dossier (text+bar meter per
 * dimension) and the accessible table's per-row dimension text.
 */
export const CREDIBILITY_DIMENSIONS = [
  "publicationRigor",
  "creatorExpertise",
  "hostProvenance",
  "pedagogicalValue",
  "relevance",
  "evidenceStrength",
] as const;
export type CredibilityDimension = (typeof CREDIBILITY_DIMENSIONS)[number];
export const CREDIBILITY_DIMENSION_LABEL: Record<CredibilityDimension, string> = {
  publicationRigor: "Publication rigor",
  creatorExpertise: "Creator expertise",
  hostProvenance: "Host provenance",
  pedagogicalValue: "Pedagogical value",
  relevance: "Relevance",
  evidenceStrength: "Evidence strength",
};
