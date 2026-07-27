/**
 * DisplayNode / DisplayLink (charter §9) — the pure, tested display/render
 * contract, kept deliberately separate from the canonical `GraphNode`/
 * `GraphLink` contract (`apps/web/src/components/graph/types.ts`, "THE
 * graph data contract"). See the package README for the full type-
 * provenance reasoning; short version inline on each field below.
 */

import type { CanonicalLinkId, CanonicalNodeId, DisplayLinkId, DisplayNodeId } from "./ids";
import type { CanonicalNodeTypeMirror, DisplayKind, SourceEntityKind } from "./kinds";
import type { Layer } from "./layers";

/** `DisplayNode.projection` — present only on a node this package derived
 *  rather than read straight off one real row (an aggregate summary today;
 *  charter's "Learning-step display nodes are deterministic projections of
 *  the ... Roadmap" reserves this for other derived kinds too). `basisIds`
 *  are always `DisplayNodeId`s of the hidden/summarized nodes, never
 *  canonical ids — a consumer walking `basisIds` stays entirely inside the
 *  display id space. */
export interface DisplayProjection {
  basisIds: DisplayNodeId[];
  rule: string;
  version: string;
}

/**
 * A node's real backing entity, when it has exactly one (charter's
 * `{ kind: string; id: string }`, typed with this package's own
 * `SourceEntityKind` per "use exact project types rather than
 * string/unknown where current schemas already define them" — see
 * `kinds.ts`'s doc comment for why `SourceEntityKind` is a NEW type this
 * package owns rather than an import). `null` for a node with no single
 * backing row (an aggregate summary, or a synthetic outline/roadmap
 * projection with no row of its own).
 */
export interface DisplaySourceEntity {
  kind: SourceEntityKind;
  id: string;
}

/**
 * Generic over the canonical node-type union (`TCanonicalKind`) for the
 * same reason `DisplayKind` is generic — see `kinds.ts`. Defaults to this
 * package's `CanonicalNodeTypeMirror` so an unparameterized `DisplayNode`
 * still type-checks against today's known canonical kinds.
 */
export interface DisplayNode<TCanonicalKind extends string = CanonicalNodeTypeMirror> {
  id: DisplayNodeId;
  displayKind: DisplayKind<TCanonicalKind>;
  canonicalNodeId: CanonicalNodeId | null;
  sourceEntity: DisplaySourceEntity | null;
  layer: Layer;
  label: string;
  destination: string | null;
  unavailableReason: string | null;
  projection: DisplayProjection | null;
}

/**
 * Canonical `EdgeFamily` (`apps/web/src/components/graph/types.ts`) is a
 * frozen five-value union — `"reference" | "influence" | "opposition" |
 * "structural" | "prerequisite"` — that the charter itself restates
 * verbatim ("Keep the canonical five-value EdgeFamily contract unchanged")
 * rather than treating as an evolving enum the way `NodeType`/
 * `RelationshipCategory` are. Unlike those two (each of which has grown at
 * least once in this project's history), re-stating these five literal
 * strings locally is a deliberate, low-drift-risk choice, not the
 * "duplicate-and-drift canonical types" the charter warns against — see the
 * README's "Type provenance" section for the full reasoning, spelled out
 * per the charter's own instruction to record this choice.
 */
export type CanonicalEdgeFamily = "reference" | "influence" | "opposition" | "structural" | "prerequisite";

/** Additive display-only family (charter §10 edge grammar / §9): can
 *  distinguish `claim_nuances` from the canonical `influence` family for
 *  rendering purposes without altering stored/API semantics — canonical
 *  data continues to say "influence"; only the *display* layer says
 *  "qualification". */
export type DisplayEdgeFamily = CanonicalEdgeFamily | "qualification";

export const CANONICAL_EDGE_FAMILIES: readonly CanonicalEdgeFamily[] = [
  "reference",
  "prerequisite",
  "influence",
  "opposition",
  "structural",
];

export const DISPLAY_EDGE_FAMILIES: readonly DisplayEdgeFamily[] = [
  "reference",
  "prerequisite",
  "influence",
  "qualification",
  "opposition",
  "structural",
];

/** Mirrors the canonical `GraphLink.provenance` shape
 *  (`{ relationId, runId, depth } | null`) verbatim — small and stable
 *  enough (unlike `NodeType`) that re-declaring it locally carries
 *  negligible drift risk, and doing so lets `DisplayLink.provenance` be a
 *  real typed shape instead of `unknown`, per the charter's "use exact
 *  project types" instruction. */
export interface DisplayLinkProvenance {
  relationId: string;
  runId: string;
  depth: number;
}

export interface DisplayLink {
  id: DisplayLinkId;
  source: DisplayNodeId;
  target: DisplayNodeId;
  canonicalLinkId: CanonicalLinkId | null;
  displayFamily: DisplayEdgeFamily;
  directed: boolean;
  /** Canonical `GraphLink.evidence`/`.evidences` is itself typed `unknown`
   *  in the canonical contract (it is genuinely heterogeneous per edge
   *  source) — kept `unknown` here for the same reason, per the charter's
   *  own shape. */
  evidence: unknown;
  provenance: DisplayLinkProvenance | null;
}
