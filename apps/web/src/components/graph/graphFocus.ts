// Relative import, not the `@/*` alias: this module (like
// `graphSceneScaling.ts`) is invoked directly via bare `tsx` for its unit
// test — no Next.js/webpack path-alias resolution available there.
import type { GraphData, GraphLink } from "./types";

/**
 * Phase 21.6 (D-21-2): selection-focus decisions, kept as PURE functions of
 * the shared `GraphData`/`selectedNodeId` props — never force-layout
 * internals (simulated x/y/z, `hoverNode`, camera distance) — so the
 * upcoming Roadmap layout mode (22.8) can reuse this exact module unchanged
 * against its own fixed-position node set. `KnowledgeGraph3D.tsx` unions the
 * result with its own local hover state before rendering (hover ADDS
 * emphasis on top of a selection, it never replaces the selection-driven
 * set — see that file's own doc comment); `GraphAccessibleFallback.tsx`
 * consumes the same `FocusEmphasis` value directly with no hover concept at
 * all, which is what makes the table's `data-emphasis` attribute a
 * WebGL-independent, E2E-assertable proxy for the 3D scene's fade/highlight
 * behavior (WebGL opacity itself isn't DOM-testable).
 *
 * Deliberately does NOT filter `data.nodes`/`data.links` — `filterGraphData`
 * (types.ts) remains the only function that changes which nodes/edges
 * exist in the payload both views render. Focus mode is a RENDER-level
 * emphasis/visibility decision layered on top of that one shared filtered
 * set, never a second, parallel data-derivation path.
 */

// Graph P4: a fourth mode, "concepts" — the selection plus only its one-hop
// concept/person neighbors (never reference/peer_reviewed_source/
// online_source/section/work neighbors), for a reader who wants to see
// "what ideas does this connect to" without the surrounding citation web.
export type FocusMode = "focus" | "expand" | "full" | "concepts";

export const DEFAULT_FOCUS_MODE: FocusMode = "focus";

export const FOCUS_MODES: readonly FocusMode[] = ["focus", "expand", "full", "concepts"];

export const FOCUS_MODE_LABEL: Record<FocusMode, string> = {
  focus: "Focus selected",
  expand: "Expand one hop",
  full: "Full graph",
  concepts: "Concepts",
};

function linkEndpointId(end: GraphLink["source"] | GraphLink["target"]): string {
  return typeof end === "string" ? end : (end as { id: string }).id;
}

/** Undirected adjacency — emphasis/navigation both treat "connected" as
 *  "shares an edge with," regardless of the edge's own `directed` flag
 *  (which is a display/semantics concern for the inspector, not a
 *  reachability one here). */
export function buildNodeAdjacency(links: readonly Pick<GraphLink, "source" | "target">[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const set = map.get(a) ?? new Set<string>();
    set.add(b);
    map.set(a, set);
  };
  for (const link of links) {
    const source = linkEndpointId(link.source);
    const target = linkEndpointId(link.target);
    add(source, target);
    add(target, source);
  }
  return map;
}

export interface FocusEmphasis {
  /** The selected node plus whatever the active mode adds — never includes
   *  a node the mode doesn't reach. Empty whenever nothing is selected or
   *  mode is "full" (no selection-driven fade at all in that mode). */
  emphasizedNodeIds: ReadonlySet<string>;
  /** Every OTHER node in `data.nodes` — always disjoint from
   *  `emphasizedNodeIds`, and empty whenever `emphasizedNodeIds` is empty
   *  (selection only ever ADDS emphasis; it never independently dims
   *  anything when there is nothing selected to focus on). */
  dimmedNodeIds: ReadonlySet<string>;
  /** Links with BOTH endpoints in `emphasizedNodeIds`. */
  emphasizedLinkIds: ReadonlySet<string>;
}

export const EMPTY_FOCUS_EMPHASIS: FocusEmphasis = {
  emphasizedNodeIds: new Set(),
  dimmedNodeIds: new Set(),
  emphasizedLinkIds: new Set(),
};

/**
 * `mode === "focus"`: the selected node and its direct (one-hop) neighbors.
 * `mode === "expand"`: also every neighbor OF those neighbors (two hops).
 * `mode === "full"`: no focus effect at all, regardless of selection —
 * returns `EMPTY_FOCUS_EMPHASIS` so every node/link renders at full
 * emphasis (the "Return to full graph" requirement).
 * `mode === "concepts"` (Graph P4): the selection plus only its one-hop
 * neighbors of type `concept`/`person` — a reader-oriented "what ideas does
 * this touch" view, deliberately narrower than `"focus"`'s every-type
 * one-hop set.
 *
 * A `selectedNodeId` that no longer exists in `data.nodes` (e.g. a stale
 * `?selected=` URL param, or a node a filter just removed) degrades to
 * `EMPTY_FOCUS_EMPHASIS` rather than emphasizing nothing-but-a-ghost-id.
 */
export function computeFocusEmphasis(
  data: Pick<GraphData, "nodes" | "links">,
  selectedNodeId: string | null | undefined,
  mode: FocusMode,
): FocusEmphasis {
  if (!selectedNodeId || mode === "full") return EMPTY_FOCUS_EMPHASIS;
  if (!data.nodes.some((node) => node.id === selectedNodeId)) return EMPTY_FOCUS_EMPHASIS;

  const adjacency = buildNodeAdjacency(data.links);
  const oneHop = adjacency.get(selectedNodeId) ?? new Set<string>();
  let emphasized: Set<string>;
  if (mode === "concepts") {
    const typeById = new Map(data.nodes.map((node) => [node.id, node.type]));
    emphasized = new Set<string>([selectedNodeId]);
    for (const id of oneHop) {
      const type = typeById.get(id);
      if (type === "concept" || type === "person") emphasized.add(id);
    }
  } else {
    emphasized = new Set<string>([selectedNodeId, ...oneHop]);
    if (mode === "expand") {
      for (const neighborId of oneHop) {
        for (const secondHop of adjacency.get(neighborId) ?? []) emphasized.add(secondHop);
      }
    }
  }

  const dimmed = new Set(data.nodes.map((node) => node.id).filter((id) => !emphasized.has(id)));
  const emphasizedLinkIds = new Set(
    data.links
      .filter((link) => emphasized.has(linkEndpointId(link.source)) && emphasized.has(linkEndpointId(link.target)))
      .map((link) => link.id),
  );
  return { emphasizedNodeIds: emphasized, dimmedNodeIds: dimmed, emphasizedLinkIds };
}

export type NodeEmphasisState = "selected" | "neighbor" | "dimmed" | "none";

/** The exact, DOM-assertable state a single node renders in — "none" means
 *  no focus effect is active at all (nothing selected, or "full" mode),
 *  which is deliberately distinct from "not emphasized while something else
 *  is" (that's "dimmed"). Orthogonal to plain `data-selected` — a node can
 *  be `data-selected="true"` while its `data-emphasis` is "none" under
 *  "full" mode: selection and fade are two different signals. */
export function emphasisStateForNode(
  nodeId: string,
  selectedNodeId: string | null | undefined,
  emphasis: FocusEmphasis,
): NodeEmphasisState {
  if (!selectedNodeId || emphasis.emphasizedNodeIds.size === 0) return "none";
  if (nodeId === selectedNodeId) return "selected";
  return emphasis.emphasizedNodeIds.has(nodeId) ? "neighbor" : "dimmed";
}

/**
 * Deterministic (label-sorted, id-tiebroken) one-hop neighbor order — the
 * exact sequence prev/next-connected-node keyboard navigation steps
 * through. Sorting is required precisely because `Set` iteration order,
 * while stable within one process, is insertion-order-dependent and not a
 * contract callers should rely on for "previous" vs. "next" to mean
 * anything reproducible across a reload or a different seed order.
 */
export function connectedNodeIds(data: Pick<GraphData, "nodes" | "links">, nodeId: string): string[] {
  const adjacency = buildNodeAdjacency(data.links);
  const neighbors = [...(adjacency.get(nodeId) ?? [])];
  const labelById = new Map(data.nodes.map((node) => [node.id, node.label]));
  return neighbors.sort((a, b) => {
    const byLabel = (labelById.get(a) ?? a).localeCompare(labelById.get(b) ?? b);
    return byLabel !== 0 ? byLabel : a.localeCompare(b);
  });
}
