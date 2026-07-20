export type NodeState = "primary" | "read" | "reading" | "unread" | "missing" | "structural";
export type NodeType = "work" | "reference" | "concept" | "section";

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
  provider?: string | null;
  /** `concept_kind` (concept/doctrine/person/tradition/debate) for concept
   *  nodes; null for every other node type. */
  kind?: string | null;
}

export interface GraphLink {
  source: string;
  target: string;
  edgeType: string;
  category: string | null;
  confidence: number;
}

export interface GraphData {
  title: string;
  analysisStatus?: string;
  nodes: GraphNode[];
  links: GraphLink[];
  stats: { works: number; references: number; concepts: number; missing: number; read: number };
}

// State → palette token + human label. Color is never the only signal —
// the table fallback and the node labels carry the same meaning (plan §20).
export const STATE_META: Record<NodeState, { label: string; colorVar: string }> = {
  primary: { label: "Your work", colorVar: "--color-accent-ink" },
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
  concept: "Concept",
  section: "Section",
};

export function edgeTypeLabel(edgeType: string): string {
  return edgeType.replace(/_/g, " ");
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
  state: NodeState | "all";
  type: NodeType | "all";
  authority: string | "all";
  provider: string | "all";
  relation: string | "all";
}

export const DEFAULT_GRAPH_FILTERS: GraphFilters = {
  state: "all",
  type: "all",
  authority: "all",
  provider: "all",
  relation: "all",
};

/**
 * The ONE filtering implementation both views consume (plan §34.4 9.7:
 * "filters ... identical across the 3D scene and the accessible table").
 * Filtering nodes and then dropping any link whose endpoint got filtered
 * out means neither view can ever show a dangling edge to an invisible
 * node — a stricter, more consistent guarantee than filtering nodes and
 * links independently.
 */
export function filterGraphData(data: GraphData, filters: GraphFilters): GraphData {
  const byNode = edgeTypesByNode(data);
  const nodes = data.nodes.filter(
    (n) =>
      (filters.state === "all" || n.state === filters.state) &&
      (filters.type === "all" || n.type === filters.type) &&
      (filters.authority === "all" || n.authority === filters.authority) &&
      (filters.provider === "all" || n.provider === filters.provider) &&
      (filters.relation === "all" || byNode.get(n.id)?.has(filters.relation)),
  );
  const visibleIds = new Set(nodes.map((n) => n.id));
  const links = data.links.filter((l) => visibleIds.has(linkEndpointId(l.source)) && visibleIds.has(linkEndpointId(l.target)));
  return { ...data, nodes, links };
}
