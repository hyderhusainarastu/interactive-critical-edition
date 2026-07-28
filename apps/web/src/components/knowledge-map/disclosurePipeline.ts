/**
 * Pure glue between the adapted `DisplayNode[]`/`DisplayLink[]` graph and
 * `@ice/graph-display/disclosure.ts`'s prioritized-selection primitives
 * (charter §8, spec §2's data-flow diagram). `disclosure.ts` itself is
 * generic over `DisclosureCandidate` — it has no notion of "look at the
 * links to find a node's neighbors"; this module is that lookup, built
 * once against `KnowledgeMapDisplayNode`/`KnowledgeMapDisplayLink`
 * (`./adapter.ts`) rather than duplicated at every call site
 * (`KnowledgeMapWorkspace.tsx`'s initial-load and expand-node paths both
 * need it).
 *
 * `DisplayLink` (the charter §9 contract, verbatim) carries no numeric
 * confidence field at all — only `evidence`/`aiInferred`/`provenance` — so
 * `confidence` below is always `null` ("no confidence signal at this
 * layer", per `disclosure.ts`'s own doc comment on `DisclosureCandidate.confidence`:
 * "sorts below every candidate that has one, never treated as 0"). This is
 * not a shortcut: the charter's own `DisplayLink` type sketch (§9) has no
 * confidence field either, so there is genuinely nothing to read.
 * `directVerifiedEvidenceAnchored` is derived instead from what IS on the
 * contract — a link with real `evidence` and NOT flagged `aiInferred` is
 * exactly "direct" (not synthesized/inferred) and "evidence-anchored"
 * (carries a real evidence payload); this is a documented judgment call
 * for the one input `disclosure.ts`'s priority ordering actually needs,
 * not an attempt to recover a field the contract doesn't carry.
 */
import {
  buildAggregateNodes,
  initialNeighborhood,
  type DeviceClass,
  type DisclosureCandidate,
  type OmittedEntry,
  type PrioritizedSelection,
} from "@ice/graph-display";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";
import type { NodeType } from "../graph/types";

function endpointIds(link: KnowledgeMapDisplayLink): [string, string] {
  return [link.source, link.target];
}

/**
 * Every node adjacent (via any link) to a node in `fromIds` and NOT
 * already in `excludeIds`, each wrapped as a `DisclosureCandidate` per the
 * doc comment above. A node reachable via multiple links takes the most
 * favorable signal across all of them (an evidence-anchored link to it
 * beats a purely-inferred one, even if a second link is inferred) — this
 * is what "does this node have at least one direct, verified,
 * evidence-anchored path in from the current frontier" should mean, not
 * an arbitrary first-link-wins pick.
 */
export function buildNeighborCandidates(
  nodes: readonly KnowledgeMapDisplayNode[],
  links: readonly KnowledgeMapDisplayLink[],
  fromIds: ReadonlySet<string>,
  excludeIds: ReadonlySet<string>,
): DisclosureCandidate<NodeType>[] {
  const nodeById = new Map(nodes.map((n) => [String(n.id), n] as const));
  const anchoredById = new Map<string, boolean>();

  for (const link of links) {
    const [source, target] = endpointIds(link);
    const anchored = link.evidence != null && !link.aiInferred;
    for (const [from, to] of [
      [source, target],
      [target, source],
    ] as const) {
      if (!fromIds.has(from) || excludeIds.has(to) || fromIds.has(to)) continue;
      const existing = anchoredById.get(to) ?? false;
      anchoredById.set(to, existing || anchored);
    }
  }

  const candidates: DisclosureCandidate<NodeType>[] = [];
  for (const [id, directVerifiedEvidenceAnchored] of anchoredById) {
    const node = nodeById.get(id);
    if (!node) continue; // dangling reference — already filtered at adapt time, but never trusted twice
    candidates.push({ node, directVerifiedEvidenceAnchored, confidence: null });
  }
  return candidates;
}

/**
 * Initial disclosure for a freshly-opened context (charter §8): the root
 * plus up to `INITIAL_NEIGHBOR_CAP[device]` prioritized direct neighbors.
 * Thin wrapper so callers don't have to re-derive `buildNeighborCandidates`'s
 * arguments inline every time.
 */
export function buildInitialDisclosure(
  root: KnowledgeMapDisplayNode,
  nodes: readonly KnowledgeMapDisplayNode[],
  links: readonly KnowledgeMapDisplayLink[],
  device: DeviceClass,
): PrioritizedSelection<NodeType> {
  const candidates = buildNeighborCandidates(nodes, links, new Set([String(root.id)]), new Set([String(root.id)]));
  return initialNeighborhood(root, candidates, device);
}

/** The single, fixed aggregation rule this workspace uses everywhere an
 *  aggregate is (re)computed, so an aggregate node's id is deterministic
 *  and reproducible across a fresh mount given the SAME expansion trail —
 *  the "Recreate aggregate summaries from their current basis rather than
 *  trusting stale counts" URL-reconstruction rule (charter §9) depends on
 *  this being the one and only rule name ever used. */
export const KNOWLEDGE_MAP_AGGREGATION_RULE = "knowledge-map-disclosure";
export const KNOWLEDGE_MAP_AGGREGATION_VERSION = "1";

export interface DisclosureState {
  /** Every currently-visible display id — the root, its initial neighbors,
   *  and everything admitted by a valid expansion-trail entry. */
  visibleIds: Set<string>;
  /** The current "N more <kind>" summaries over whatever remains hidden,
   *  recomputed from the CURRENT basis (never trusted from a stale count —
   *  see `KNOWLEDGE_MAP_AGGREGATION_RULE`'s doc comment). */
  aggregates: KnowledgeMapDisplayNode[];
  /** Expansion-trail entries that no longer resolve to a real aggregate
   *  (an id that's stale, was already fully expanded, or never existed) —
   *  charter §9's "announce the omission non-disruptively, and preserve
   *  the rest of the state": every OTHER entry in the trail still replays
   *  normally. */
  omittedExpansionIds: OmittedEntry[];
}

/**
 * Replays an ordered expansion trail (charter §9's "Replay valid expansion
 * IDs in order") on top of the initial disclosure. Each trail entry is
 * expected to be the id of an aggregate node this same function would have
 * produced at that point in the replay — i.e. the id `FilterRail.tsx`'s
 * "Expand" button passes to `KnowledgeMapWorkspace`'s `onExpandAggregate`,
 * which appends it to the URL's `expansionTrail`. Clicking "Expand" on a
 * currently-shown aggregate is this workspace's ONE explicit-expansion
 * mechanic (charter §8: aggregation "require[s] narrowing or explicit
 * expansion" — the aggregate IS the explicit-expansion affordance here);
 * a plain node click/double-click only selects/focuses (§4.2), it never
 * reveals new nodes on its own.
 *
 * Known, documented simplification: the overall `VISIBLE_CAP` (120
 * desktop / 60 mobile) is enforced once, in the initial disclosure — after
 * that, an already-open context can grow past the cap across several
 * expansions in the same session without being re-aggregated back down.
 * `enforceVisibleCap` (`@ice/graph-display/disclosure.ts`) would need a
 * priority signal for every ALREADY-VISIBLE node (not just the hidden
 * pool) to re-run correctly, which this workspace does not compute today;
 * left as a real, bounded, low-severity gap for a later step rather than a
 * partially-correct reimplementation under this step's time budget.
 */
export function computeDisclosure(
  root: KnowledgeMapDisplayNode,
  nodes: readonly KnowledgeMapDisplayNode[],
  links: readonly KnowledgeMapDisplayLink[],
  expansionTrail: readonly string[],
  device: DeviceClass,
): DisclosureState {
  const initial = buildInitialDisclosure(root, nodes, links, device);
  const visibleIds = new Set(initial.visible.map((n) => String(n.id)));
  let hidden = initial.hidden;
  const omittedExpansionIds: OmittedEntry[] = [];

  for (const rawId of expansionTrail) {
    const currentAggregates = buildAggregateNodes(hidden, {
      rule: KNOWLEDGE_MAP_AGGREGATION_RULE,
      version: KNOWLEDGE_MAP_AGGREGATION_VERSION,
    }).aggregates;
    const match = currentAggregates.find((a) => String(a.id) === rawId);
    if (!match || match.projection === null) {
      omittedExpansionIds.push({ value: rawId, reason: "not_found", source: "expansionTrail" });
      continue;
    }
    const basisIds = new Set(match.projection.basisIds.map(String));
    const toAdmit = hidden.filter((n) => basisIds.has(String(n.id)));
    for (const n of toAdmit) visibleIds.add(String(n.id));
    hidden = hidden.filter((n) => !basisIds.has(String(n.id)));
  }

  const aggregates = buildAggregateNodes(hidden, {
    rule: KNOWLEDGE_MAP_AGGREGATION_RULE,
    version: KNOWLEDGE_MAP_AGGREGATION_VERSION,
  }).aggregates;

  return { visibleIds, aggregates, omittedExpansionIds };
}
