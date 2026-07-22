export type NodeState = "primary" | "read" | "reading" | "unread" | "missing" | "structural";
export type NodeType = "work" | "reference" | "peer_reviewed_source" | "online_source" | "concept" | "person" | "section";

export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  state: NodeState;
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
  source: string;
  target: string;
  edgeType: string;
  category: string | null;
  confidence: number;
  explanation?: string | null;
  evidence?: unknown;
  provenance?: { relationId: string; runId: string; depth: number } | null;
  evidences?: unknown[];
  provenances?: { relationId: string; runId: string; depth: number }[];
}

export interface GraphData {
  title: string;
  analysisStatus?: string;
  nodes: GraphNode[];
  links: GraphLink[];
  stats: { works: number; references: number; sources: number; concepts: number; people: number; missing: number; read: number };
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

export function edgeFamilyFor(edgeType: string, category?: string | null): EdgeFamily {
  const normalized = `${edgeType} ${category ?? ""}`.toLowerCase();
  if (normalized.includes("outline") || normalized.includes("section")) return "structural";
  if (normalized.includes("prerequisite") || normalized.includes("presupposes")) return "prerequisite";
  if (normalized.includes("disagrees") || normalized.includes("criticizes") || normalized.includes("polemical")) return "opposition";
  if (normalized.includes("cites") || normalized.includes("quotes") || normalized.includes("reference")) return "reference";
  return "influence";
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
 */
export function filterGraphData(data: GraphData, filters: GraphFilters, pinnedWorkIds: readonly string[] = []): GraphData {
  const byNode = edgeTypesByNode(data);
  const associatedIds =
    filters.associatedWork === "all"
      ? null
      : new Set([
          filters.associatedWork,
          ...data.links.flatMap((l) => {
            const source = linkEndpointId(l.source);
            const target = linkEndpointId(l.target);
            if (source === filters.associatedWork) return [target];
            if (target === filters.associatedWork) return [source];
            return [];
          }),
        ]);
  const normalizedSearch = filters.search.trim().toLocaleLowerCase();
  const pinned = new Set(pinnedWorkIds);
  const nodes = data.nodes.filter(
    (n) =>
      // Pinned uploaded works remain visible in both projections even when a
      // filter would otherwise exclude them. Their connected nodes remain
      // honestly filtered; pinning is a selection affordance, not a claim
      // that every relationship matches the filter.
      (pinned.has(n.id) ||
      (!normalizedSearch || `${n.label} ${n.authors ?? ""} ${n.kind ?? ""}`.toLocaleLowerCase().includes(normalizedSearch)) &&
      (filters.state === "all" || n.state === filters.state) &&
      (filters.type === "all" || n.type === filters.type) &&
      (filters.authority === "all" || n.authority === filters.authority) &&
      (filters.provider === "all" || n.provider === filters.provider || n.providers?.includes(filters.provider)) &&
      (filters.relation === "all" || byNode.get(n.id)?.has(filters.relation)) &&
      (filters.credibilityBand === "all" || credibilityBandFor(n.credibilityScore) === filters.credibilityBand) &&
      (!associatedIds || associatedIds.has(n.id))),
  );
  const visibleIds = new Set(nodes.map((n) => n.id));
  const links = data.links.filter((l) => visibleIds.has(linkEndpointId(l.source)) && visibleIds.has(linkEndpointId(l.target)));
  return { ...data, nodes, links };
}
