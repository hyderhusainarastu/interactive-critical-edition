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
import { initialNeighborhood, type DeviceClass, type DisclosureCandidate, type PrioritizedSelection } from "@ice/graph-display";
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
