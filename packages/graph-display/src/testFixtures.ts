/**
 * Shared test fixtures (not exported from `index.ts` — internal to this
 * package's own test suite). Not matched by vitest's default `*.test.ts`
 * include glob, so this file is never run as a test itself.
 */

import { toDisplayLinkId, toDisplayNodeId, type DisplayLinkId, type DisplayNodeId } from "./ids";
import type { CanonicalNodeTypeMirror } from "./kinds";
import { DEFAULT_CANONICAL_NODE_TYPE_LAYER } from "./bands";
import { LAYER_ORDER, type Layer } from "./layers";
import type { DisplayEdgeFamily, DisplayLink, DisplayNode } from "./types";
import {
  GRAPH_CONTEXT_KINDS,
  GRAPH_FILTER_KEYS,
  GRAPH_FOCUS_STATES,
  GRAPH_VIEW_MODES,
  type GraphUrlContext,
  type GraphUrlFilters,
  type GraphUrlState,
} from "./urlState";

export function makeNode(
  id: string,
  displayKind: DisplayNode["displayKind"],
  overrides: Partial<DisplayNode> = {},
): DisplayNode {
  const layer =
    overrides.layer ??
    DEFAULT_CANONICAL_NODE_TYPE_LAYER[displayKind as CanonicalNodeTypeMirror] ??
    "intellectual";
  return {
    id: toDisplayNodeId(id),
    displayKind,
    canonicalNodeId: null,
    sourceEntity: null,
    layer,
    label: id,
    destination: null,
    unavailableReason: null,
    projection: null,
    ...overrides,
  };
}

export function makeLink(
  id: string,
  source: DisplayNodeId,
  target: DisplayNodeId,
  displayFamily: DisplayEdgeFamily,
  overrides: Partial<DisplayLink> = {},
): DisplayLink {
  return {
    id: toDisplayLinkId(id),
    source,
    target,
    canonicalLinkId: null,
    displayFamily,
    directed: true,
    evidence: null,
    provenance: null,
    ...overrides,
  };
}

/**
 * The full audited edge-value set (see `families.ts`'s module doc comment
 * for how this was derived) — the 14-value DB `edge_type` enum, every
 * synthetic/free-text value `apps/web/src/lib/graph.ts`/`graphDebate.ts`
 * emit, and the two audit-finding values (`optional_extension`,
 * `ai_inferred`) that reach `GraphLink.edgeType` directly via the
 * `editionRelations.relationType` passthrough.
 */
export const ALL_EMITTED_EDGE_VALUES: readonly string[] = [
  // 14-value DB edge_type enum (packages/db/src/schema.ts).
  "cites",
  "quotes",
  "influences",
  "criticizes",
  "responds_to",
  "presupposes",
  "provides_context_for",
  "interprets",
  "disagrees_with",
  "translates",
  "is_edition_of",
  "is_prerequisite_for",
  "is_comparable_to",
  "is_recommended_by",
  // Synthetic / free-text values from apps/web/src/lib/graph.ts.
  "outline_section",
  "discovered_source",
  "review_of",
  "edition_of",
  "translation_of",
  "excerpt_of",
  // The 10 relationship_category values, reachable directly as edgeType via
  // editionRelations.relationType passthrough (audit finding).
  "explicit_reference",
  "secondary_scholarly_recommendation",
  "historical_context",
  "prerequisite",
  "conceptual_influence",
  "disagreement_polemical_target",
  "interpretive_aid",
  "parallel_comparison",
  "optional_extension",
  "ai_inferred",
  // Debate layer (apps/web/src/lib/graphDebate.ts).
  "in_debate",
  "asserts_claim",
  "claim_contradicts",
  "claim_supports",
  "claim_nuances",
];

export const ALL_CANONICAL_NODE_TYPES: readonly CanonicalNodeTypeMirror[] = [
  "work",
  "reference",
  "peer_reviewed_source",
  "online_source",
  "concept",
  "person",
  "section",
  "claim",
  "debate",
];

/**
 * Deterministic seeded PRNG (mulberry32) — used by the `GraphUrlState`
 * "property-based-style" round-trip suite (`urlState.test.ts`). No new
 * dependency (e.g. `fast-check`) is added per this workstream's own
 * constraint ("no new npm dependencies beyond devDeps consistent with
 * existing packages/* conventions"); a tiny hand-rolled generator over
 * many seeds gives the same "round-trip identity over generated states"
 * property the brief asks for, fully reproducibly (same seed -> same
 * failure, every run, no flakiness).
 */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

function randomInt(rand: () => number, maxInclusive: number): number {
  return Math.floor(rand() * (maxInclusive + 1));
}

/** Deliberately includes characters that are meaningful to URL/query-string
 *  encoding (`&`, `=`, `+`, `%`, `#`, whitespace) and non-ASCII text, so the
 *  round-trip suite actually exercises `URLSearchParams`'s own
 *  encode/decode behavior rather than only ever seeing "safe" identifiers. */
const INTERESTING_STRING_POOL: readonly string[] = [
  "work-1234",
  "a b c",
  "100% sure?",
  "a&b=c",
  "héllo wörld",
  "日本語のテスト",
  "emoji-🔥-id",
  "",
  "  leading-and-trailing  ",
  "slash/in/id",
  "colon:in:id",
  "plus+sign",
  "hash#fragment",
];

function randomInterestingString(rand: () => number): string {
  return pick(rand, INTERESTING_STRING_POOL);
}

function randomDisplayNodeId(rand: () => number, index: number): DisplayNodeId {
  return toDisplayNodeId(`${randomInterestingString(rand) || "id"}-${index}`);
}

/**
 * Generates one random, well-formed `GraphUrlState` — every field
 * populated from its own real domain (context kinds, view modes, focus
 * states, the real `Layer`/filter-key vocabularies), not arbitrary
 * unconstrained data. This is what "round-trip identity over generated
 * states" is checked against: a state this generator can produce must
 * always survive `parseGraphUrlState(serializeGraphUrlState(state))`
 * unchanged.
 */
export function randomGraphUrlState(rand: () => number): GraphUrlState {
  const context: GraphUrlContext = {
    kind: pick(rand, GRAPH_CONTEXT_KINDS),
    id: randomInterestingString(rand) || "fallback-id",
  };

  const activeLayerCount = randomInt(rand, LAYER_ORDER.length);
  const activeLayers: Layer[] = [];
  for (let i = 0; i < activeLayerCount; i++) {
    activeLayers.push(pick(rand, LAYER_ORDER));
  }

  const filters: GraphUrlFilters = {};
  for (const key of GRAPH_FILTER_KEYS) {
    if (rand() < 0.4) {
      filters[key] = randomInterestingString(rand);
    }
  }

  const expansionCount = randomInt(rand, 6); // well under EXPANSION_CAP by construction
  const expansionTrail: DisplayNodeId[] = [];
  for (let i = 0; i < expansionCount; i++) {
    expansionTrail.push(randomDisplayNodeId(rand, i));
  }

  return {
    context,
    view: pick(rand, GRAPH_VIEW_MODES),
    selectedId: rand() < 0.5 ? randomDisplayNodeId(rand, 999) : null,
    activeLayers,
    filters,
    expansionTrail,
    focus: pick(rand, GRAPH_FOCUS_STATES),
  };
}
