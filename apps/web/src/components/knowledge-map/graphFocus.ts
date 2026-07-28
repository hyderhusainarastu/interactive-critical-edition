/**
 * Focus-state emphasis (charter §8/§9/§10, spec §1.2's `graphFocus.ts` row:
 * "Kept, relocated to `knowledge-map/`, reviewed" against the charter's
 * `focusMode` semantics). This is the pure decision layer behind the four
 * NON-DEFAULT `GraphFocusState` values (`neighborhood`/`expand2`/`concepts`/
 * `readingPath`) plus the default `all` — charter §9's "Focus state: all
 * visible context, one-hop neighborhood, two-hop expansion, concepts-only,
 * or reading path," restored via `useGraphUrlState`'s `focus` field
 * (`@ice/graph-display`'s `GraphFocusState`/`GRAPH_FOCUS_STATES`).
 *
 * Ported and renamed from the pre-rebuild `components/graph/graphFocus.ts`
 * (Phase 21.6/D-21-2's `FocusMode` = `"focus"|"expand"|"full"|"concepts"`)
 * to the charter's own 5-value vocabulary:
 *
 *   old "focus"  -> new "neighborhood" (selected + 1 hop)
 *   old "expand"  -> new "expand2"     (selected + 2 hops)
 *   old "full"    -> new "all"         (no emphasis at all)
 *   old "concepts"-> new "concepts"    (selected + concept/person 1-hop neighbors, unchanged)
 *   (new) "readingPath" -> emphasizes an EXTERNALLY-SUPPLIED reading-path
 *     node set (never selection-driven) — see this file's own doc comment
 *     on `computeFocusEmphasis`'s `readingPathNodeIds` parameter for why
 *     that set is computed by the caller, not this module.
 *
 * Operates over the DISPLAY layer (`KnowledgeMapDisplayNode`/
 * `KnowledgeMapDisplayLink` — spec §9's `DisplayKind`/id space), not the
 * canonical `GraphNode`/`GraphLink` contract the old module used, because
 * "concepts" mode's own `displayKind` check (`"concept"`/`"person"`) is now
 * available directly on every node in scope, canonical or synthesized — no
 * separate canonical-type lookup needed the way the old module required.
 *
 * Deliberately does NOT filter which nodes/links EXIST — `disclosurePipeline.ts`
 * (topology) and `attributeVisibility.ts` (attribute filters) remain the only
 * two places that change SET MEMBERSHIP. Focus is a third, independent,
 * RENDER-level emphasis/dimming decision layered on top of whatever topology
 * + attribute-filter set is already visible — exactly the "unrelated VISIBLE
 * content dims to 0.12 opacity... never silently removed" charter §10 rule:
 * a dimmed node/link stays present (in the DOM, in the accessible List, in
 * the 3D scene) at low opacity, it is never dropped from the set entirely.
 */
import type { GraphFocusState } from "@ice/graph-display";

/** The minimal node/link shape this module needs — deliberately narrower
 *  than the full `KnowledgeMapDisplayNode`/`KnowledgeMapDisplayLink` so a
 *  test fixture (or a future caller with a differently-shaped node) doesn't
 *  need every field those types carry, only the two this module actually
 *  reads. `KnowledgeMapDisplayNode`/`KnowledgeMapDisplayLink` both satisfy
 *  these shapes structurally, so real callers pass them directly with no
 *  adapter of their own. */
export interface FocusableNode {
  id: string;
  displayKind: string;
}
export interface FocusableLink {
  id: string;
  source: string;
  target: string;
}

export interface FocusEmphasis {
  /** Nodes the active focus state keeps at full opacity — the selection
   *  plus whatever the mode adds (or the reading-path set, for
   *  `"readingPath"`). Empty whenever `"all"` is active, nothing is
   *  selected (for the selection-driven modes), or there is nothing to
   *  emphasize (e.g. `"readingPath"` with no reading-path data yet). */
  emphasizedNodeIds: ReadonlySet<string>;
  /** Every OTHER currently-visible node — always disjoint from
   *  `emphasizedNodeIds`, and empty whenever `emphasizedNodeIds` is empty
   *  (an active focus state only ever ADDS emphasis; it never
   *  independently dims anything when there is nothing to focus on). */
  dimmedNodeIds: ReadonlySet<string>;
  /** Links with BOTH endpoints in `emphasizedNodeIds`. */
  emphasizedLinkIds: ReadonlySet<string>;
}

export const EMPTY_FOCUS_EMPHASIS: FocusEmphasis = {
  emphasizedNodeIds: new Set(),
  dimmedNodeIds: new Set(),
  emphasizedLinkIds: new Set(),
};

/** Undirected adjacency — emphasis/navigation both treat "connected" as
 *  "shares an edge with," regardless of a link's own `directed` flag (a
 *  display/semantics concern for the inspector, not a reachability one
 *  here). */
export function buildNodeAdjacency(links: readonly FocusableLink[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const set = map.get(a) ?? new Set<string>();
    set.add(b);
    map.set(a, set);
  };
  for (const link of links) {
    add(link.source, link.target);
    add(link.target, link.source);
  }
  return map;
}

function linksAmong(links: readonly FocusableLink[], ids: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const link of links) {
    if (ids.has(link.source) && ids.has(link.target)) out.add(link.id);
  }
  return out;
}

function emphasizeSet(nodes: readonly FocusableNode[], links: readonly FocusableLink[], emphasized: ReadonlySet<string>): FocusEmphasis {
  if (emphasized.size === 0) return EMPTY_FOCUS_EMPHASIS;
  const dimmed = new Set(nodes.map((n) => n.id).filter((id) => !emphasized.has(id)));
  return { emphasizedNodeIds: emphasized, dimmedNodeIds: dimmed, emphasizedLinkIds: linksAmong(links, emphasized) };
}

/**
 * `focus === "all"`: no emphasis at all, regardless of selection — returns
 * `EMPTY_FOCUS_EMPHASIS` so every node/link renders at full/default
 * opacity (charter's "all visible context").
 *
 * `focus === "neighborhood"`: the selected node and its direct (one-hop)
 * neighbors.
 *
 * `focus === "expand2"`: also every neighbor OF those neighbors (two hops).
 *
 * `focus === "concepts"`: the selection plus only its one-hop neighbors
 * whose `displayKind` is `"concept"` or `"person"` — deliberately narrower
 * than `"neighborhood"`'s every-kind one-hop set.
 *
 * `focus === "readingPath"`: IGNORES selection entirely (charter's own
 * legacy-compat row treats `readingThread=1` as a standalone overlay, not a
 * selection-driven emphasis) and instead emphasizes exactly the ids in
 * `readingPathNodeIds` — a set the CALLER computes (this module has no
 * network/DB access and no opinion on where reading-path membership comes
 * from; `KnowledgeMapWorkspace.tsx` derives it from a work context's
 * roadmap-annotated nodes). An empty `readingPathNodeIds` (no reading-path
 * data available yet, or a non-work context where the concept doesn't
 * apply) degrades to `EMPTY_FOCUS_EMPHASIS` — an honest "nothing to show,"
 * never a crash and never a silent fallback to a different mode.
 *
 * A documented judgment call: unlike the other three modes, the CONTEXT
 * ROOT itself is not automatically exempted from dimming here — the
 * root work is never itself a roadmap "what to read next" candidate
 * (`roadmapGraph.ts`'s `joinRoadmapAnnotations` only annotates
 * bibliographic candidates, never the root), so under "readingPath" the
 * root dims exactly like any other node not on the path. This treats
 * "reading path" consistently as one more member of the SAME emphasis
 * vocabulary the other four states share (charter §9 lists all five as
 * coequal `GraphFocusState` values), rather than inventing a second,
 * differently-behaved "always keep the root lit" carve-out found nowhere
 * in the charter's text.
 *
 * A `selectedId` that no longer exists in `nodes` (e.g. a stale
 * `?selected=` URL param, or a node a filter just removed) degrades to
 * `EMPTY_FOCUS_EMPHASIS` rather than emphasizing nothing-but-a-ghost-id —
 * same rule the pre-rebuild module used.
 */
export function computeFocusEmphasis(
  nodes: readonly FocusableNode[],
  links: readonly FocusableLink[],
  selectedId: string | null | undefined,
  focus: GraphFocusState,
  readingPathNodeIds: ReadonlySet<string> = new Set(),
): FocusEmphasis {
  if (focus === "readingPath") {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const emphasized = new Set([...readingPathNodeIds].filter((id) => nodeIds.has(id)));
    return emphasizeSet(nodes, links, emphasized);
  }

  if (focus === "all" || !selectedId) return EMPTY_FOCUS_EMPHASIS;
  if (!nodes.some((n) => n.id === selectedId)) return EMPTY_FOCUS_EMPHASIS;

  const adjacency = buildNodeAdjacency(links);
  const oneHop = adjacency.get(selectedId) ?? new Set<string>();

  let emphasized: Set<string>;
  if (focus === "concepts") {
    const kindById = new Map(nodes.map((n) => [n.id, n.displayKind]));
    emphasized = new Set<string>([selectedId]);
    for (const id of oneHop) {
      const kind = kindById.get(id);
      if (kind === "concept" || kind === "person") emphasized.add(id);
    }
  } else {
    emphasized = new Set<string>([selectedId, ...oneHop]);
    if (focus === "expand2") {
      for (const neighborId of oneHop) {
        for (const secondHop of adjacency.get(neighborId) ?? []) emphasized.add(secondHop);
      }
    }
    // "neighborhood": nothing further to add beyond `selectedId` + `oneHop`.
  }

  return emphasizeSet(nodes, links, emphasized);
}

export type NodeEmphasisState = "selected" | "neighbor" | "dimmed" | "none";

/** The exact, DOM-assertable state a single node renders in — `"none"`
 *  means no focus effect is active at all (`"all"`, or nothing to
 *  emphasize), deliberately distinct from `"dimmed"` (emphasis IS active
 *  and this node isn't part of it). A node can be selected while its
 *  emphasis state is `"none"` under `"all"` mode — selection and focus
 *  emphasis are two different signals, not the same fact twice. */
export function emphasisStateForNode(nodeId: string, selectedId: string | null | undefined, emphasis: FocusEmphasis): NodeEmphasisState {
  if (emphasis.emphasizedNodeIds.size === 0) return "none";
  if (selectedId && nodeId === selectedId) return "selected";
  return emphasis.emphasizedNodeIds.has(nodeId) ? "neighbor" : "dimmed";
}
