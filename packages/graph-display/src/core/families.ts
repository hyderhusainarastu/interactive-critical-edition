/**
 * Edge-family mapping (charter §9/§10) — a TOTAL function over every
 * `edgeType`/`category` value the current codebase actually emits into a
 * canonical `GraphLink`, audited directly against the working tree rather
 * than assumed from the charter's own (slightly incomplete — see below)
 * tables. An unmapped value returns `"unclassified"` with a diagnostic; it
 * is never silently coerced into `"influence"` the way the CURRENT
 * `edgeFamilyFor()` (`apps/web/src/components/graph/types.ts`) keyword
 * fallback does for the two gaps this audit found (see "Audit findings"
 * below) — that silent-default behavior is exactly what charter §10 tells
 * this package not to reproduce.
 *
 * ## Audit method
 *
 * Grepped every `edgeType:` / `relationType:` / `relation_type` write site
 * that ends up in a canonical `GraphLink.edgeType`:
 *   - `apps/web/src/lib/graph.ts` (`edges`, `conceptEdges`, `sectionRows`
 *     outline edges, `sourceRows`/`resourceRelations` edition-relation
 *     edges, `resourceRoleRows`, `passageAnnotationLinks`, cross-library
 *     `workRelationshipJudgments` edges)
 *   - `apps/web/src/lib/graphDebate.ts` (`in_debate`, `asserts_claim`,
 *     `claim_contradicts`/`claim_supports`/`claim_nuances` via
 *     `VALENCE_EDGE_TYPE`)
 *   - `apps/worker/src/analyze.ts` (writes to `edition_relation.relation_type`
 *     and `graph_edge.edge_type` that `graph.ts` later reads)
 *   - `packages/db/src/schema.ts`'s `edgeTypeEnum` (the 14-value DB enum)
 *
 * ## Audit findings the charter's own tables omitted
 *
 * `apps/worker/src/analyze.ts` writes `editionRelations.relationType` (a
 * free-text column, not the `edge_type` enum) directly from the
 * classifier's raw `RelationshipCategory` value (`provisionalCategory`/
 * `conservativeCategory` — see that file's `classify()` call sites), NOT
 * through `edgeTypeForRelationshipCategory`'s normalization into the
 * 14-value DB enum the way the citation/passage-annotation/resource-role
 * write paths do. `apps/web/src/lib/graph.ts` then reads that column
 * straight into `GraphLink.edgeType` (`relation?.relation_type ?? ...`) —
 * so **`optional_extension` and `ai_inferred` can appear as literal
 * `edgeType` values**, not only as `category` values, something neither the
 * charter's "Required edge-type mapping" bullets nor the current
 * `EDGE_TYPE_FAMILY` table account for. Both are handled explicitly below
 * rather than falling through to the keyword-heuristic default the current
 * code has for exactly this gap.
 */

import type { DisplayEdgeFamily } from "./types";

/** The 14-value DB `edge_type` enum plus every synthetic/free-text value
 *  this package's audit (above) found actually reaching a canonical
 *  `GraphLink.edgeType` or `.category` today. Grouped by charter §10's
 *  "Required edge-type mapping" bullets, with the two audit-finding
 *  additions folded into the group the charter's own "Required
 *  relationship-category mapping" table (§10, one table up) already
 *  assigns them to. */
const REFERENCE_VALUES = [
  "cites",
  "quotes",
  "is_recommended_by",
  "review_of",
  "responds_to",
  "discovered_source",
  "supplementary_context",
  "explicit_reference",
  "secondary_scholarly_recommendation",
  // Audit finding: emitted directly as a raw `edgeType`/`category` value by
  // `editionRelations.relationType` passthrough (see module doc comment).
  // Charter's relationship-category table maps `optional_extension` →
  // Reference; applied here for the raw-edge-type case too.
  "optional_extension",
] as const;

const PREREQUISITE_VALUES = ["presupposes", "is_prerequisite_for", "prerequisite"] as const;

const INFLUENCE_VALUES = [
  "influences",
  "provides_context_for",
  "interprets",
  "is_comparable_to",
  "historical_context",
  "conceptual_influence",
  "interpretive_aid",
  "parallel_comparison",
  "claim_supports",
] as const;

const OPPOSITION_VALUES = [
  "criticizes",
  "disagrees_with",
  "disagreement_polemical_target",
  "claim_contradicts",
] as const;

const STRUCTURAL_VALUES = [
  "outline_section",
  "translates",
  "is_edition_of",
  "edition_of",
  "translation_of",
  "excerpt_of",
  "asserts_claim",
  "in_debate",
] as const;

/** Display-only override (charter §10: "Qualification: `claim_nuances`;
 *  canonical semantics remain the existing influence family, but the
 *  display adapter gives it the qualification treatment"). Canonical data
 *  keeps saying "influence" (see `CanonicalEdgeFamily` — `claim_nuances`
 *  would map to `influence` if it were only in `INFLUENCE_VALUES`); this
 *  override applies ONLY in the display-family result, never mutates
 *  anything canonical. */
const DISPLAY_ONLY_OVERRIDE_VALUES = ["claim_nuances"] as const;

/**
 * `ai_inferred` is not primarily a member of any of the groups above — it
 * is a PROVENANCE marker (charter §9/§10: "records provenance/origin. It is
 * not a tenth semantic line family... preserve the mapped semantic family
 * plus a provenance overlay flag"). In the normal case `ai_inferred` shows
 * up only as `GraphLink.category` alongside a real, already-classifiable
 * `edgeType` (e.g. `provides_context_for`) — `classifyEdgeFamily` resolves
 * the family from that `edgeType` and separately sets `aiInferred: true`.
 *
 * The one case with no separate "underlying" value to fall back to is the
 * audit finding above: `ai_inferred` appearing as the literal `edgeType`
 * itself (an unmapped `editionRelations.relationType` passthrough, where
 * `category` is the SAME string, so there's nothing else to consult). For
 * that case only, this constant supplies the explicit, documented fallback
 * family — `influence` — mirroring `apps/web`'s own
 * `RELATIONSHIP_CATEGORY_TO_EDGE_TYPE["ai_inferred"] === "provides_context_for"`
 * decision (which is itself `EDGE_TYPE_FAMILY`'s `influence` family). This
 * is a named, tested, cited rule — not the silent keyword-fallback default
 * this package otherwise refuses to reproduce.
 */
const AI_INFERRED_FALLBACK_FAMILY: DisplayEdgeFamily = "influence";

/** Renderer hint (data only, no rendering code here): charter §10's
 *  "reduce default opacity to 70% of that family" for an AI-inferred edge. */
export const AI_INFERRED_OPACITY_MULTIPLIER = 0.7;

type FamilyTableValue = DisplayEdgeFamily;

const EDGE_VALUE_FAMILY: ReadonlyMap<string, FamilyTableValue> = new Map<string, FamilyTableValue>([
  ...REFERENCE_VALUES.map((v): [string, FamilyTableValue] => [v, "reference"]),
  ...PREREQUISITE_VALUES.map((v): [string, FamilyTableValue] => [v, "prerequisite"]),
  ...INFLUENCE_VALUES.map((v): [string, FamilyTableValue] => [v, "influence"]),
  ...OPPOSITION_VALUES.map((v): [string, FamilyTableValue] => [v, "opposition"]),
  ...STRUCTURAL_VALUES.map((v): [string, FamilyTableValue] => [v, "structural"]),
  ...DISPLAY_ONLY_OVERRIDE_VALUES.map((v): [string, FamilyTableValue] => [v, "qualification"]),
  ["ai_inferred", AI_INFERRED_FALLBACK_FAMILY],
]);

/** Every edge/category value this package's mapping table covers — used by
 *  `families.test.ts` to prove every value the live audit (module doc
 *  comment) found is actually present, and by a real caller that wants to
 *  validate a payload's coverage before rendering it. */
export const KNOWN_EDGE_VALUES: readonly string[] = [...EDGE_VALUE_FAMILY.keys()];

/** Mirrors `apps/web/src/components/graph/types.ts`'s
 *  `UNDIRECTED_EDGE_TYPES` — same small/stable/manually-synced-by-design
 *  set as `CanonicalEdgeFamily` (see that type's doc comment). Used by
 *  `validateLinkDirection` below, the charter §9 "unsupported direction"
 *  invariant. */
export const UNDIRECTED_EDGE_VALUES: ReadonlySet<string> = new Set([
  "is_comparable_to",
  "parallel_comparison",
  "claim_contradicts",
  "claim_supports",
  "claim_nuances",
]);

export function isUndirectedEdgeValue(value: string): boolean {
  return UNDIRECTED_EDGE_VALUES.has(value);
}

export interface EdgeFamilyClassification {
  family: DisplayEdgeFamily;
  /** Provenance overlay (charter §9/§10) — never a distinct family. True
   *  when either the raw `edgeType` or the `category` is literally
   *  `"ai_inferred"`. */
  aiInferred: boolean;
  matchedOn: "edgeType" | "category";
  matchedValue: string;
}

export interface UnclassifiedEdge {
  family: "unclassified";
  aiInferred: boolean;
  diagnostic: {
    edgeType: string;
    category: string | null;
    reason: string;
  };
}

export type EdgeFamilyResult = EdgeFamilyClassification | UnclassifiedEdge;

/**
 * Classify one canonical edge into a `DisplayEdgeFamily`. Total over the
 * audited value set (module doc comment); anything else returns
 * `{ family: "unclassified", ... }` carrying a diagnostic rather than
 * silently defaulting — the charter §10 requirement this module exists to
 * satisfy.
 *
 * Tries `edgeType` first (the field every canonical edge always has), then
 * `category` (present on classification-sourced edges, `null`/absent on
 * several genuine write paths — see `apps/web/src/lib/graphEdgeCategory.ts`'s
 * own doc comment for exactly which ones and why that is not a bug).
 */
export function classifyEdgeFamily(edgeType: string, category?: string | null): EdgeFamilyResult {
  const aiInferred = edgeType === "ai_inferred" || category === "ai_inferred";

  const fromEdgeType = EDGE_VALUE_FAMILY.get(edgeType);
  if (fromEdgeType) {
    return { family: fromEdgeType, aiInferred, matchedOn: "edgeType", matchedValue: edgeType };
  }

  if (category) {
    const fromCategory = EDGE_VALUE_FAMILY.get(category);
    if (fromCategory) {
      return { family: fromCategory, aiInferred, matchedOn: "category", matchedValue: category };
    }
  }

  return {
    family: "unclassified",
    aiInferred,
    diagnostic: {
      edgeType,
      category: category ?? null,
      reason: category
        ? `No display-family mapping for edgeType="${edgeType}" or category="${category}".`
        : `No display-family mapping for edgeType="${edgeType}" (no category present).`,
    },
  };
}

/**
 * Charter §9's "unsupported direction" validation: a `DisplayLink` built
 * from an edge value this package knows is canonically symmetric
 * (`UNDIRECTED_EDGE_VALUES`) but that claims `directed: true` — or the
 * reverse, a value with no such symmetric meaning claiming `directed:
 * false` — is a real adapter bug, not legitimate data variance, and should
 * never silently render with the wrong arrowhead. Returns `null` when the
 * direction is consistent with what this package knows about `edgeType`.
 */
export function validateLinkDirection(edgeType: string, directed: boolean): string | null {
  const expectUndirected = isUndirectedEdgeValue(edgeType);
  if (expectUndirected && directed) {
    return `edgeType="${edgeType}" is a symmetric relation (in UNDIRECTED_EDGE_VALUES) but the link claims directed:true.`;
  }
  if (!expectUndirected && !directed) {
    return `edgeType="${edgeType}" is not in UNDIRECTED_EDGE_VALUES but the link claims directed:false.`;
  }
  return null;
}
