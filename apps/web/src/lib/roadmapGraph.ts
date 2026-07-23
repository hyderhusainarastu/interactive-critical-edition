import { checkpointFor, stageForRelationship } from "@ice/curriculum";
import {
  mergeRoadmapsAcrossRoots,
  normalizeTitleForDedup,
  READER_LEVELS,
  type ProfileEntry,
  type RankOptions,
  type ReaderLevelFilter,
  type RoadmapItem,
  type RoadmapMode,
} from "@ice/roadmap";
import type { GraphNode, GraphPayload, RoadmapAnnotation } from "@/components/graph/types";
import { buildGraph } from "@/lib/graph";
import { computeRoadmapCandidates } from "@/lib/roadmap";

/**
 * Server-side, read-time "roadmap projection" (Phase 22.7 / feature plan
 * §2.1–2.3). Composes existing, proven machinery — the canonical `buildGraph()`
 * payload, per-root `computeRoadmapCandidates()`, and the pure
 * `mergeRoadmapsAcrossRoots()` — into ONE `GraphPayload` where the nodes the
 * roadmap reaches carry an optional `roadmap` annotation. No migration, no new
 * AI call, no stored snapshot: it is recomputed per request, so a new upload or
 * a changed rating is reflected automatically (the same posture the roadmap and
 * curriculum already take).
 *
 * The result flows through the existing single `filterGraphData()` +
 * `roadmapSubset()` derivation chain, so the 3D scene and the accessible table
 * stay provably identical — this module produces the annotated payload and
 * nothing view-specific.
 *
 * Identity note (feature plan §2.3): the graph collapses by canonical work key
 * while the roadmap traversal is `bibliographic_record`/title-normalized, so
 * the annotation join is a deliberate precedence chain: (a) exact
 * `external:bib:<id>` → (b) any bib id collapsed into the item → (c) the item's
 * matched owned work → (d) a normalized-title fallback. When work-identity
 * re-keying later lands beneath `buildGraph`, only steps (a)–(b) change; this
 * projection's API is stable.
 */

export interface RoadmapGraphPayload extends GraphPayload {
  /** The composed multi-root restore list (feature plan §2.4) — items hidden
   *  under every selected root that reached them. */
  hiddenItems: Array<{ bibId: string; title: string; authors: string | null; year: number | null }>;
}

const WORK_PREFIX = "work:";
const BIB_PREFIX = "external:bib:";

/** Parse the repeated `?roadmapRoot=work:<id>` params into bare work ids.
 *  Accepts a bare `<id>` too, so a caller need not always prefix. */
export function parseRoadmapRootParams(params: URLSearchParams): string[] {
  return params
    .getAll("roadmapRoot")
    .map((value) => (value.startsWith(WORK_PREFIX) ? value.slice(WORK_PREFIX.length) : value).trim())
    .filter((value) => value.length > 0);
}

/** True when the caller is asking for the roadmap layout. Absence of the param
 *  deliberately means explore mode, so every pre-existing graph request (and
 *  the committed `graph.spec.ts`) is byte-identical until the client opts in
 *  with `?layout=roadmap` — the "roadmap is the default view" decision lives in
 *  `GraphView` (URL-syncs `layout=roadmap`), not in the server. */
export function isRoadmapLayoutRequested(params: URLSearchParams): boolean {
  return params.get("layout") === "roadmap";
}

/** Ranking options carried on the graph request (reader level + concise/
 *  comprehensive mode), validated the same way the roadmap route validates
 *  them so the visualizer and the roadmap list can never disagree. */
export function parseRoadmapRankOptions(params: URLSearchParams): RankOptions {
  const mode = params.get("mode");
  const readerLevel = params.get("readerLevel");
  const maxMinutesRaw = params.get("maxMinutes");
  return {
    mode: mode === "concise" || mode === "comprehensive" ? (mode as RoadmapMode) : undefined,
    readerLevel:
      readerLevel === "all" || (READER_LEVELS as string[]).includes(readerLevel ?? "")
        ? (readerLevel as ReaderLevelFilter)
        : undefined,
    maxMinutes: maxMinutesRaw && Number.isFinite(Number(maxMinutesRaw)) ? Number(maxMinutesRaw) : undefined,
  };
}

/**
 * Builds the roadmap-annotated graph for a set of selected root works. When
 * `rootWorkIds` is empty it defaults to every uploaded work present in the base
 * graph — i.e. the global "whole library" roadmap — while a work-scoped caller
 * passes exactly `[thatWorkId]`. New uploads are auto-included by construction
 * (they appear as base-graph work nodes).
 *
 * Cost is N bounded, depth-<4 CTE traversals (one `computeRoadmapCandidates`
 * per root), an accepted read-time trade-off (feature plan §2.3): if a perf
 * budget is ever missed the fix is a short-TTL cache, not a schema change.
 */
export async function buildRoadmapGraph(
  userId: string,
  rootWorkIds: string[],
  options: RankOptions = {},
): Promise<RoadmapGraphPayload> {
  const base = await buildGraph(userId);

  const effectiveRoots =
    rootWorkIds.length > 0
      ? rootWorkIds
      : base.nodes.filter((node) => node.uploaded).map((node) => node.id.slice(WORK_PREFIX.length));

  // No roots (empty library, or an isolated/unanalyzed work with no anchors):
  // the base graph is the honest answer, with no annotations to layer on.
  if (effectiveRoots.length === 0) return { ...base, hiddenItems: [] };

  const sets = await Promise.all(effectiveRoots.map((rootWorkId) => computeRoadmapCandidates(userId, rootWorkId)));

  const perRoot = sets.map((set) => ({ rootWorkId: set.rootWorkId, candidates: set.candidates, overrides: set.overrideMap }));
  // The profile is userId-scoped (identical across roots); union defensively.
  const profile = new Map<string, ProfileEntry>();
  for (const set of sets) for (const [bibId, entry] of set.profile) profile.set(bibId, entry);

  const merged = mergeRoadmapsAcrossRoots(perRoot, profile, options);

  const annotationByNodeId = joinRoadmapAnnotations(base.nodes, merged.items, {
    mergedBibIdsByBib: merged.mergedBibIdsByBib,
    rootWorkIdsByBib: merged.rootWorkIdsByBib,
  });

  // Attach without mutating the base nodes (same non-mutating posture as
  // `filterGraphData`/`roadmapSubset`).
  const nodes = base.nodes.map((node) => {
    const annotation = annotationByNodeId.get(node.id);
    return annotation ? { ...node, roadmap: annotation } : node;
  });

  return { nodes, links: base.links, stats: base.stats, hiddenItems: merged.hiddenItems };
}

export interface RoadmapJoinProvenance {
  /** Surviving bibId → the bib ids collapsed into it (`MergedRoadmap`). */
  mergedBibIdsByBib: Map<string, string[]>;
  /** Surviving bibId → the root work ids that reached it (`MergedRoadmap`). */
  rootWorkIdsByBib: Map<string, string[]>;
}

/**
 * Pure annotation join (feature plan §2.3): maps each merged `RoadmapItem` onto
 * exactly one graph node by the precedence chain (a) exact `external:bib:<id>`
 * → (b) any bib id collapsed into the item → (c) the item's matched owned work
 * → (d) a normalized-title fallback, and returns node id → `RoadmapAnnotation`.
 *
 * Extracted from `buildRoadmapGraph` as a DB-free, exported function precisely
 * so the precedence, the fallback, and the no-match case are deterministic
 * unit tests (`roadmapGraph.test.ts`) rather than only reachable through the
 * DB. Items are consumed in reading-sequence order, so when two items would
 * claim the same node the earlier (higher-priority) one wins; an item that
 * matches no node is simply skipped (it stays in the roadmap list but has no
 * graph node — an accepted, honest gap, feature plan §2.5).
 */
export function joinRoadmapAnnotations(
  nodes: GraphNode[],
  items: RoadmapItem[],
  provenance: RoadmapJoinProvenance,
): Map<string, RoadmapAnnotation> {
  const byId = new Map<string, GraphNode>(nodes.map((node) => [node.id, node]));
  const byNormLabel = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const key = normalizeTitleForDedup(node.label);
    if (!key) continue;
    const list = byNormLabel.get(key) ?? [];
    list.push(node);
    byNormLabel.set(key, list);
  }
  for (const list of byNormLabel.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  const findNode = (item: RoadmapItem): GraphNode | undefined => {
    // (a) exact bibliographic-record node.
    const exact = byId.get(`${BIB_PREFIX}${item.bibId}`);
    if (exact) return exact;
    // (b) any bib id collapsed into this item (editions/reviews/reprints).
    for (const mergedBibId of provenance.mergedBibIdsByBib.get(item.bibId) ?? []) {
      const node = byId.get(`${BIB_PREFIX}${mergedBibId}`);
      if (node) return node;
    }
    // (c) the item's matched owned work.
    if (item.workId) {
      const node = byId.get(`${WORK_PREFIX}${item.workId}`);
      if (node) return node;
    }
    // (d) normalized-title fallback (confined to no-bib/no-work items; the
    //     basis line surfaces it, so a rare homonym mis-merge is inspectable,
    //     never silent — feature plan §2.5).
    const key = normalizeTitleForDedup(item.title);
    if (key) {
      const matches = byNormLabel.get(key);
      if (matches && matches.length > 0) return matches[0];
    }
    return undefined;
  };

  const annotationByNodeId = new Map<string, RoadmapAnnotation>();
  for (const item of items) {
    const node = findNode(item);
    if (!node || annotationByNodeId.has(node.id)) continue;
    annotationByNodeId.set(node.id, {
      stage: stageForRelationship(item.category),
      tier: item.tier,
      sequence: item.sequence,
      known: item.known,
      reason: item.reason,
      checkpoint: checkpointFor(item.category),
      category: item.category,
      confidence: item.confidence,
      estimatedMinutes: item.estimatedMinutes,
      addedManually: item.addedManually,
      overridden: item.overridden,
      rootWorkIds: provenance.rootWorkIdsByBib.get(item.bibId) ?? [],
    });
  }
  return annotationByNodeId;
}
