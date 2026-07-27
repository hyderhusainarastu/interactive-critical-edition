/**
 * Shared test fixtures (not exported from `index.ts` — internal to this
 * package's own test suite). Not matched by vitest's default `*.test.ts`
 * include glob, so this file is never run as a test itself.
 */

import { toDisplayLinkId, toDisplayNodeId, type DisplayLinkId, type DisplayNodeId } from "./ids";
import type { CanonicalNodeTypeMirror } from "./kinds";
import { DEFAULT_CANONICAL_NODE_TYPE_LAYER } from "./bands";
import type { DisplayEdgeFamily, DisplayLink, DisplayNode } from "./types";

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
