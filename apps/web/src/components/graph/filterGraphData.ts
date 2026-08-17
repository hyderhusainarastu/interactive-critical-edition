import { matchesReaderLevel, type ReaderLevel, type ReaderLevelFilter } from "@ice/roadmap";

import type { GraphData, GraphFilters, GraphLink, GraphNode } from "./types";

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
  stage: "all",
  readerLevel: "all",
  conceptKind: "all",
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
 * Data contract v2 (Graph P1): does ANY of a node's `readerLevels` satisfy
 * the selected filter level, under the same mutually-exclusive-band
 * semantics `@ice/roadmap`'s `matchesReaderLevel` already uses everywhere
 * else a reader level is matched (Library, curriculum, the roadmap-mode
 * server request) — owner directive 2026-07-26: an exact match on the
 * selected level (or the node's own level being universal/null), never a
 * cumulative `<=`/`>=` union — so this filter cannot silently invent a
 * second definition of "matches level X". A node with no `readerLevels`
 * data at all is exempt (never punish missing data), matching
 * `matchesReaderLevel`'s own null-materialLevel rule; this helper only adds
 * the "any of several levels" step that a single-level match doesn't need.
 */
export function matchesAnyReaderLevel(node: Pick<GraphNode, "readerLevels">, selected: ReaderLevelFilter): boolean {
  if (selected === "all") return true;
  if (!node.readerLevels || node.readerLevels.length === 0) return true;
  return node.readerLevels.some((level) => matchesReaderLevel(level as ReaderLevel, selected));
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
      (!normalizedSearch ||
        `${n.label} ${n.authors ?? ""} ${n.kind ?? ""} ${(n.aliases ?? []).join(" ")}`.toLocaleLowerCase().includes(normalizedSearch)) &&
      (filters.state === "all" || n.state === filters.state) &&
      (filters.type === "all" || n.type === filters.type) &&
      (filters.authority === "all" || n.authority === filters.authority) &&
      (filters.provider === "all" || n.provider === filters.provider || n.providers?.includes(filters.provider) === true) &&
      (filters.relation === "all" || byNode.get(n.id)?.has(filters.relation) === true) &&
      (filters.credibilityBand === "all" || credibilityBandFor(n.credibilityScore) === filters.credibilityBand) &&
      // Roadmap-mode stage filter (feature plan §2.2). The default `"all"`
      // short-circuits to `true`, so an annotation-free payload — every
      // explore-mode payload — is unaffected. A concrete stage keeps only
      // nodes whose roadmap projection is in that stage (an unannotated node
      // has no `roadmap`, so `n.roadmap?.stage` is `undefined !== <stage>`
      // and it is hidden — correct: it has no place in a stage column).
      (filters.stage === "all" || n.roadmap?.stage === filters.stage) &&
      // Data contract v2 (Graph P1): reader-level and concept-kind narrowing.
      // Both default to "all" (no-op), so an unfiltered payload is unaffected.
      matchesAnyReaderLevel(n, filters.readerLevel) &&
      // conceptKind only applies to concept/person-typed nodes — every other
      // type has no concept kind at all and stays exempt (never punish
      // missing data, same spirit as the D-21-10 anchor exemption above).
      (filters.conceptKind === "all" || (n.type !== "concept" && n.type !== "person") || n.kind === filters.conceptKind)
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

/**
 * Roadmap-mode node subset (feature plan §2.2/§2.5). Keeps exactly the nodes a
 * stage-column reading roadmap should show: every roadmap-annotated node, plus
 * the reader's own uploaded-work anchors (roots and library). Concepts/people/
 * sections stay explore-only in v1 — the roadmap pipeline is bibliographic, so
 * a concept has no honestly-derived stage placement; fabricating one would
 * violate the grounding posture, so they are simply excluded here rather than
 * dropped into an invented column.
 *
 * This is an EXPORTED PURE contract function (not an inline filter in the UI)
 * precisely so the 3D scene and the accessible table can consume the exact
 * same derivation — `roadmapSubset(filterGraphData(data, filters, pinned))` —
 * and stay provably identical, the same guarantee `filterGraphData` itself
 * gives. Like `filterGraphData`, it returns a new object and never mutates its
 * input; dangling links to trimmed nodes are dropped, so neither view can show
 * an edge to an invisible node.
 */
export function roadmapSubset(data: GraphData): GraphData {
  const nodes = data.nodes.filter((n) => n.roadmap != null || n.uploaded);
  const visibleIds = new Set(nodes.map((n) => n.id));
  const links = data.links.filter(
    (l) => visibleIds.has(linkEndpointId(l.source)) && visibleIds.has(linkEndpointId(l.target)),
  );
  return { ...data, nodes, links };
}
