import type { RelationshipCategory } from "@ice/roadmap";

export type NodeState = "primary" | "read" | "reading" | "unread" | "missing" | "structural";
export type NodeType = "work" | "reference" | "peer_reviewed_source" | "online_source" | "concept" | "person" | "section";

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

/** Relation types that are symmetric — direction carries no meaning.
 *  Everything else in the vocabulary (cites/review_of/translates/…) is a
 *  directed claim about which end does what. */
export const UNDIRECTED_EDGE_TYPES: ReadonlySet<string> = new Set(["is_comparable_to", "parallel_comparison"]);

export function isDirectedEdgeType(edgeType: string): boolean {
  return !UNDIRECTED_EDGE_TYPES.has(edgeType);
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
};

export function edgeTypeLabel(edgeType: string): string {
  return edgeType.replace(/_/g, " ");
}

export type EdgeFamily = "reference" | "influence" | "opposition" | "structural" | "prerequisite";

export const EDGE_FAMILY_META: Record<EdgeFamily, { label: string; colorVar: string }> = {
  reference: { label: "Citation / reference", colorVar: "--color-accent-ink" },
  influence: { label: "Influence / agreement", colorVar: "--color-accent-green" },
  opposition: { label: "Opposition", colorVar: "--color-credibility-critical" },
  structural: { label: "Structure", colorVar: "--color-text-muted" },
  prerequisite: { label: "Prerequisite", colorVar: "--color-credibility-warning" },
};

export const EDGE_FAMILY_ORDER: EdgeFamily[] = ["reference", "prerequisite", "influence", "opposition", "structural"];

/**
 * Explicit family assignment for every edge-type string the payload actually
 * produces (plan §21.5 audit finding: the old keyword-only matcher silently
 * defaulted `review_of`/`translation_of`/`edition_of`/`excerpt_of`/
 * `responds_to`/`translates`/`is_edition_of`/`is_comparable_to`/
 * `is_recommended_by`/`discovered_source` into "influence"). Covers the
 * 14-value `edge_type` enum, the synthetic `outline_section`/
 * `discovered_source` edges, the `edition_relation` `${workRole}_of` strings,
 * and the relation-category strings `edition_relation.relation_type` carries.
 */
const EDGE_TYPE_FAMILY: Record<string, EdgeFamily> = {
  // Citation / reference: pointers at a work — citations, quotations,
  // recommendations, reviews, replies, and discovered/supplementary sources.
  cites: "reference",
  quotes: "reference",
  is_recommended_by: "reference",
  review_of: "reference",
  responds_to: "reference",
  discovered_source: "reference",
  supplementary_context: "reference",
  explicit_reference: "reference",
  secondary_scholarly_recommendation: "reference",
  // Influence / agreement (the `is_comparable_to` mapping is deliberate:
  // parallel/comparison shares this family rather than inventing a sixth).
  influences: "influence",
  provides_context_for: "influence",
  interprets: "influence",
  is_comparable_to: "influence",
  historical_context: "influence",
  conceptual_influence: "influence",
  interpretive_aid: "influence",
  parallel_comparison: "influence",
  // Opposition.
  criticizes: "opposition",
  disagrees_with: "opposition",
  disagreement_polemical_target: "opposition",
  // Prerequisite.
  presupposes: "prerequisite",
  is_prerequisite_for: "prerequisite",
  prerequisite: "prerequisite",
  // Structure: the work's own outline plus work-form relations
  // (editions, translations, excerpts of the same work).
  outline_section: "structural",
  translates: "structural",
  is_edition_of: "structural",
  edition_of: "structural",
  translation_of: "structural",
  excerpt_of: "structural",
};

export function edgeFamilyFor(edgeType: string, category?: string | null): EdgeFamily {
  const exact = EDGE_TYPE_FAMILY[edgeType] ?? (category ? EDGE_TYPE_FAMILY[category] : undefined);
  if (exact) return exact;
  // Keyword fallback for genuinely unknown/category-augmented strings only.
  const normalized = `${edgeType} ${category ?? ""}`.toLowerCase();
  if (normalized.includes("outline") || normalized.includes("section") || normalized.includes("edition") || normalized.includes("translat") || normalized.includes("excerpt")) return "structural";
  if (normalized.includes("prerequisite") || normalized.includes("presupposes")) return "prerequisite";
  if (normalized.includes("disagrees") || normalized.includes("criticizes") || normalized.includes("polemical")) return "opposition";
  if (normalized.includes("cites") || normalized.includes("quotes") || normalized.includes("reference") || normalized.includes("review") || normalized.includes("recommend")) return "reference";
  return "influence";
}

/**
 * relationship_category → edge_type (Phase 21.2, D-21-7): mirrors
 * `apps/worker/src/analyze.ts`'s `CATEGORY_TO_EDGE` map exactly, so
 * `resource_role`/`passage_annotation` rows — real relation-bearing rows the
 * plan names that `buildGraph()` never read before this fix — project into
 * the SAME edge_type vocabulary the citation/classification `graph_edge`
 * rows already use. That means `edgeFamilyFor()` above and the legend/relation
 * filter need no new cases for either source: every edge_type this produces
 * is already one of `EDGE_TYPE_FAMILY`'s existing keys. Kept in sync
 * manually — apps/web cannot import from apps/worker.
 */
const RELATIONSHIP_CATEGORY_TO_EDGE_TYPE: Record<RelationshipCategory, string> = {
  explicit_reference: "cites",
  secondary_scholarly_recommendation: "is_recommended_by",
  historical_context: "provides_context_for",
  prerequisite: "is_prerequisite_for",
  conceptual_influence: "influences",
  disagreement_polemical_target: "disagrees_with",
  interpretive_aid: "interprets",
  parallel_comparison: "is_comparable_to",
  optional_extension: "is_recommended_by",
  ai_inferred: "provides_context_for",
};

/** Falls back to `provides_context_for` for any unrecognized category value
 *  rather than throwing — a graph edge should degrade to a plausible
 *  family, never disappear from the payload or crash the request. */
export function edgeTypeForRelationshipCategory(category: string): string {
  return RELATIONSHIP_CATEGORY_TO_EDGE_TYPE[category as RelationshipCategory] ?? "provides_context_for";
}

function linkEndpointId(end: GraphLink["source"] | GraphLink["target"]): string {
  return typeof end === "string" ? end : (end as { id: string }).id;
}

/** Which edge types touch each node — shared by the relation filter
 *  (plan §34.4 9.7: filters must be computable once and reused identically
 *  by both the table and the 3D scene, not recomputed differently by each). */
export function edgeTypesByNode(data: Pick<GraphData, "links">): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (id: string, edgeType: string) => {
    const set = map.get(id) ?? new Set<string>();
    set.add(edgeType);
    map.set(id, set);
  };
  for (const l of data.links) {
    add(linkEndpointId(l.source), l.edgeType);
    add(linkEndpointId(l.target), l.edgeType);
  }
  return map;
}

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
}

export type CredibilityBand = "high" | "medium" | "low" | "unknown";

export const CREDIBILITY_BAND_META: Record<CredibilityBand, { label: string }> = {
  high: { label: "High credibility" },
  medium: { label: "Medium credibility" },
  low: { label: "Low credibility" },
  unknown: { label: "Unknown credibility" },
};

export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
  search: "",
  state: "all",
  type: "all",
  authority: "all",
  provider: "all",
  relation: "all",
  credibilityBand: "all",
  associatedWork: "all",
};

/** True when every field is still at its default — drives the "Clear all
 *  filters" control's disabled state (nothing to clear) and lets tests
 *  assert the cleared state without re-deriving the field list themselves. */
export function isDefaultFilters(filters: GraphFilters): boolean {
  return (Object.keys(DEFAULT_GRAPH_FILTERS) as (keyof GraphFilters)[]).every(
    (key) => filters[key] === DEFAULT_GRAPH_FILTERS[key],
  );
}

export function credibilityBandFor(score: number | null | undefined): CredibilityBand {
  if (score == null) return "unknown";
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

/**
 * The ONE filtering implementation both views consume (plan §34.4 9.7:
 * "filters ... identical across the 3D scene and the accessible table").
 * Filtering nodes and then dropping any link whose endpoint got filtered
 * out means neither view can ever show a dangling edge to an invisible
 * node — a stricter, more consistent guarantee than filtering nodes and
 * links independently.
 *
 * Two contract-semantics guarantees (plan §21.1/§21.3, D-21-1/D-21-10):
 * 1. When a relation filter is active, EDGES are filtered by relation too —
 *    a non-matching edge between two visible nodes is hidden, never drawn.
 * 2. Uploaded-work nodes are the graph's anchors: they stay visible under
 *    every attribute filter (search/state/type/authority/provider/relation/
 *    credibility) by default, not only when pinned. The one filter that can
 *    scope them out is `associatedWork` — the UI's work-scoping control,
 *    i.e. the plan's "Works visibility is disabled" case — and explicit
 *    pinning still overrides even that.
 */
export function filterGraphData(data: GraphData, filters: GraphFilters, pinnedWorkIds: readonly string[] = []): GraphData {
  const byNode = edgeTypesByNode(data);
  const normalizedSearch = filters.search.trim().toLocaleLowerCase();
  const pinned = new Set(pinnedWorkIds);
  const matchesAssociatedWork = (n: GraphNode) =>
    filters.associatedWork === "all" ||
    n.id === filters.associatedWork ||
    (n.associatedWorkIds ?? []).includes(filters.associatedWork);
  const nodes = data.nodes.filter((n) => {
    // Pinned uploaded works remain visible in both projections even when a
    // filter would otherwise exclude them. Their connected nodes remain
    // honestly filtered; pinning is a selection affordance, not a claim
    // that every relationship matches the filter.
    if (pinned.has(n.id)) return true;
    if (!matchesAssociatedWork(n)) return false;
    // D-21-10: uploaded-work anchors are exempt from attribute filters.
    if (n.uploaded) return true;
    return (
      (!normalizedSearch || `${n.label} ${n.authors ?? ""} ${n.kind ?? ""}`.toLocaleLowerCase().includes(normalizedSearch)) &&
      (filters.state === "all" || n.state === filters.state) &&
      (filters.type === "all" || n.type === filters.type) &&
      (filters.authority === "all" || n.authority === filters.authority) &&
      (filters.provider === "all" || n.provider === filters.provider || n.providers?.includes(filters.provider) === true) &&
      (filters.relation === "all" || byNode.get(n.id)?.has(filters.relation) === true) &&
      (filters.credibilityBand === "all" || credibilityBandFor(n.credibilityScore) === filters.credibilityBand)
    );
  });
  const visibleIds = new Set(nodes.map((n) => n.id));
  // D-21-1: an edge must itself match the active relation filter — endpoint
  // visibility alone is not enough.
  const links = data.links.filter(
    (l) =>
      visibleIds.has(linkEndpointId(l.source)) &&
      visibleIds.has(linkEndpointId(l.target)) &&
      (filters.relation === "all" || l.edgeType === filters.relation),
  );
  return { ...data, nodes, links };
}
