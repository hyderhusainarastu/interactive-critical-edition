/**
 * Disclosure (charter §8): prioritized initial neighborhood, bounded
 * explicit expansion, an overall visible cap, and deterministic aggregation
 * of whatever gets hidden. Every function here is pure — no state is kept
 * between calls; a caller (out of this package's pure-logic scope) owns the
 * running "what's visible so far" list and calls back in as the user
 * expands.
 */

import { toDisplayNodeId, type DisplayNodeId } from "./ids";
import type { CanonicalNodeTypeMirror, DisplayOnlyKind } from "./kinds";
import type { Layer } from "./layers";
import type { DisplayNode, DisplayProjection } from "./types";

export type DeviceClass = "desktop" | "mobile";

/** Charter §8, verbatim. */
export const INITIAL_NEIGHBOR_CAP: Readonly<Record<DeviceClass, number>> = { desktop: 24, mobile: 12 };
export const EXPANSION_CAP = 20;
export const VISIBLE_CAP: Readonly<Record<DeviceClass, number>> = { desktop: 120, mobile: 60 };

/**
 * One node competing for a visible slot, carrying the priority signals
 * charter §8 specifies: "Prioritize direct, verified, evidence-anchored
 * relationships before inferred or lower-confidence relationships, with
 * stable ID tie-breaking." `isRoot` nodes always win every slot and are
 * never aggregated — the context root is unconditionally visible.
 */
export interface DisclosureCandidate<TCanonicalKind extends string = CanonicalNodeTypeMirror> {
  node: DisplayNode<TCanonicalKind>;
  directVerifiedEvidenceAnchored: boolean;
  /** `null` when no confidence signal exists for this candidate — sorts
   *  below every candidate that has one, never treated as `0` (a real,
   *  meaningfully low confidence) or `1` (never punish/invent). */
  confidence: number | null;
  isRoot?: boolean;
}

export interface PrioritizedSelection<TCanonicalKind extends string = CanonicalNodeTypeMirror> {
  visible: DisplayNode<TCanonicalKind>[];
  hidden: DisplayNode<TCanonicalKind>[];
}

function comparePriority<TCanonicalKind extends string>(
  a: DisclosureCandidate<TCanonicalKind>,
  b: DisclosureCandidate<TCanonicalKind>,
): number {
  const aRoot = a.isRoot === true;
  const bRoot = b.isRoot === true;
  if (aRoot !== bRoot) return aRoot ? -1 : 1;
  if (a.directVerifiedEvidenceAnchored !== b.directVerifiedEvidenceAnchored) {
    return a.directVerifiedEvidenceAnchored ? -1 : 1;
  }
  const ac = a.confidence ?? -Infinity;
  const bc = b.confidence ?? -Infinity;
  if (ac !== bc) return bc - ac;
  // Stable, deterministic tie-break (charter §8) — independent of input
  // order or engine sort stability.
  return a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0;
}

/**
 * Sort `candidates` by charter §8 priority and split at `limit`. Pure: does
 * not mutate `candidates`.
 */
export function selectPrioritized<TCanonicalKind extends string = CanonicalNodeTypeMirror>(
  candidates: readonly DisclosureCandidate<TCanonicalKind>[],
  limit: number,
): PrioritizedSelection<TCanonicalKind> {
  const sorted = [...candidates].sort(comparePriority);
  return {
    visible: sorted.slice(0, limit).map((c) => c.node),
    hidden: sorted.slice(limit).map((c) => c.node),
  };
}

/**
 * Initial disclosure (charter §8): the root is unconditionally visible and
 * does not consume a neighbor slot; up to `INITIAL_NEIGHBOR_CAP[device]`
 * prioritized direct neighbors join it.
 */
export function initialNeighborhood<TCanonicalKind extends string = CanonicalNodeTypeMirror>(
  root: DisplayNode<TCanonicalKind>,
  neighborCandidates: readonly DisclosureCandidate<TCanonicalKind>[],
  device: DeviceClass,
): PrioritizedSelection<TCanonicalKind> {
  const { visible, hidden } = selectPrioritized(neighborCandidates, INITIAL_NEIGHBOR_CAP[device]);
  return { visible: [root, ...visible], hidden };
}

/**
 * One explicit expansion (charter §8: "Each explicit expansion adds at most
 * 20 nodes"). `newCandidates` are the nodes this one expansion action makes
 * reachable — already excludes anything already visible, a caller
 * responsibility (this function has no notion of "already visible").
 */
export function expandNeighborhood<TCanonicalKind extends string = CanonicalNodeTypeMirror>(
  newCandidates: readonly DisclosureCandidate<TCanonicalKind>[],
): PrioritizedSelection<TCanonicalKind> {
  return selectPrioritized(newCandidates, EXPANSION_CAP);
}

/**
 * Overall visible-set cap (charter §8: "Above 120 visible desktop nodes or
 * 60 mobile nodes, aggregate remaining branches ... require narrowing or
 * explicit expansion"). Takes the FULL accumulated candidate list (root +
 * every neighbor/expansion admitted so far, each still carrying its
 * priority signals) — a real caller keeps this running list as session
 * state; this function stays pure over whatever snapshot it's given.
 */
export function enforceVisibleCap<TCanonicalKind extends string = CanonicalNodeTypeMirror>(
  accumulated: readonly DisclosureCandidate<TCanonicalKind>[],
  device: DeviceClass,
): PrioritizedSelection<TCanonicalKind> {
  return selectPrioritized(accumulated, VISIBLE_CAP[device]);
}

/**
 * Deterministic "N more <kind>" aggregation (charter §8: "Do not silently
 * drop hidden nodes; show counts and the reason for aggregation" / §9:
 * "Aggregate nodes are deterministic summaries ... `basisIds` enumerate the
 * hidden display nodes they summarize"). Groups strictly by `displayKind`
 * so every aggregate is layer-homogeneous by construction (an aggregate
 * never has to guess a layer for a mixed-kind group — see `bands.ts`'s
 * `AggregateLayerLookupError` doc comment). `labelForKind` lets a real
 * caller supply nicer display copy (e.g. "sources" instead of the raw kind
 * string "peer_reviewed_source"); the default is a plain, honest fallback.
 */
export interface AggregationOptions {
  rule: string;
  version: string;
  labelForKind?: (kind: string) => string;
}

const defaultLabelForKind = (kind: string): string => `${kind.replace(/_/g, " ")}${kind.endsWith("s") ? "" : "s"}`;

export interface AggregationResult<TCanonicalKind extends string = CanonicalNodeTypeMirror> {
  aggregates: DisplayNode<TCanonicalKind>[];
  /** Hidden nodes whose layer disagreed with the rest of their own
   *  displayKind group — should never happen given how layers are assigned
   *  today, but surfaced rather than silently picking one, per charter's
   *  "never silently drop/misrepresent." */
  layerMismatchDiagnostics: { kind: string; layers: Layer[] }[];
}

export function buildAggregateNodes<TCanonicalKind extends string = CanonicalNodeTypeMirror>(
  hidden: readonly DisplayNode<TCanonicalKind>[],
  options: AggregationOptions,
): AggregationResult<TCanonicalKind> {
  const labelForKind = options.labelForKind ?? defaultLabelForKind;
  const byKind = new Map<string, DisplayNode<TCanonicalKind>[]>();
  for (const node of hidden) {
    const key = String(node.displayKind);
    const group = byKind.get(key);
    if (group) group.push(node);
    else byKind.set(key, [node]);
  }

  const aggregates: DisplayNode<TCanonicalKind>[] = [];
  const layerMismatchDiagnostics: { kind: string; layers: Layer[] }[] = [];

  // Deterministic iteration order regardless of Map insertion order/input
  // order — sort group keys alphabetically.
  for (const kind of [...byKind.keys()].sort()) {
    const group = byKind.get(kind)!;
    const layers = [...new Set(group.map((n) => n.layer))];
    if (layers.length > 1) layerMismatchDiagnostics.push({ kind, layers });
    const layer = layers[0];
    const basisIds: DisplayNodeId[] = group.map((n) => n.id);
    const projection: DisplayProjection = { basisIds, rule: options.rule, version: options.version };
    const aggregateKind: DisplayOnlyKind = "aggregate";
    aggregates.push({
      id: toDisplayNodeId(`aggregate:${options.rule}:${kind}`),
      displayKind: aggregateKind,
      canonicalNodeId: null,
      sourceEntity: { kind: "aggregate", id: `${options.rule}:${kind}` },
      layer,
      label: `${group.length} more ${labelForKind(kind)}`,
      destination: null,
      unavailableReason: null,
      projection,
    });
  }

  return { aggregates, layerMismatchDiagnostics };
}
