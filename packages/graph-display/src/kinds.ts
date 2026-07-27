/**
 * DisplayKind (charter §9) and its supporting vocabularies.
 *
 * See the package README ("Type provenance") for the full reasoning. Short
 * version: `apps/web/src/components/graph/types.ts`'s `NodeType` is THE
 * canonical node-type contract, but `apps/web` is a Next.js app, not an
 * importable workspace package — and `NodeType` has genuinely grown twice
 * already (Phase 28.4 added `claim`/`debate`), so silently duplicating it
 * here risks drifting exactly the way the charter warns against ("do NOT
 * duplicate-and-drift canonical types").
 *
 * The resolution: `DisplayKind<TCanonicalKind>` is GENERIC over the
 * canonical node-type union — a real caller (future `apps/web` integration
 * code, out of this pure package's scope) instantiates it with the actual
 * `NodeType` import and gets full type safety with zero duplication. Every
 * function in this package that needs to reason about canonical kinds
 * (`layerForDisplayKind`, etc.) takes the canonical mapping as an explicit
 * parameter rather than hard-coding it — but ALSO ships a fully-specified,
 * tested DEFAULT for today's 9 known values (`CanonicalNodeTypeMirror`
 * below), using this project's own already-established manual-sync
 * discipline (see `RELATIONSHIP_CATEGORY_TO_EDGE_TYPE`'s doc comment in the
 * same canonical `types.ts`: "Kept in sync manually — apps/web cannot
 * import from apps/worker"). That default is what every totality test in
 * this package exercises.
 */

/** Manual mirror of `apps/web/src/components/graph/types.ts`'s `NodeType`
 *  (9 values, as of Phase 28.4's additive `claim`/`debate`). Keep in sync
 *  by hand if that union ever grows — the same discipline this codebase
 *  already applies to `RELATIONSHIP_CATEGORY_TO_EDGE_TYPE`/`CONCEPT_KINDS`.
 *  Used only as this package's default/reference mapping; a real caller can
 *  supply the actual `NodeType` import instead via the generic parameter. */
export const CANONICAL_NODE_TYPES = [
  "work",
  "reference",
  "peer_reviewed_source",
  "online_source",
  "concept",
  "person",
  "section",
  "claim",
  "debate",
] as const;

export type CanonicalNodeTypeMirror = (typeof CANONICAL_NODE_TYPES)[number];

/** New display-only node kinds the charter's §9 `DisplayKind` union adds on
 *  top of the canonical `NodeType` values. `"aggregate"` is deliberately
 *  handled specially everywhere in this package (see `bands.ts`'s doc
 *  comment) — its layer is never looked up statically, only ever assigned
 *  from the shared layer of the hidden nodes it summarizes. */
export const DISPLAY_ONLY_KINDS = [
  "passage",
  "question",
  "position",
  "evidence",
  "learning_step",
  "hypothesis",
  "gap",
  "writing_project",
  "aggregate",
] as const;

export type DisplayOnlyKind = (typeof DISPLAY_ONLY_KINDS)[number];

/** The charter's `DisplayKind` union, generic over the canonical node-type
 *  union so this package never has to own (and risk drifting) `NodeType`
 *  itself. Defaults to `CanonicalNodeTypeMirror` so a caller that doesn't
 *  care about strict canonical typing can use `DisplayKind` unparameterized. */
export type DisplayKind<TCanonicalKind extends string = CanonicalNodeTypeMirror> = TCanonicalKind | DisplayOnlyKind;

export function isDisplayOnlyKind(kind: string): kind is DisplayOnlyKind {
  return (DISPLAY_ONLY_KINDS as readonly string[]).includes(kind);
}

/**
 * Data-source matrix (baseline audit §9 / charter §9) entity kinds — the
 * real DB/domain-object kind a `DisplayNode.sourceEntity.id` points at.
 * This is a NEW type this package owns outright (nothing in the canonical
 * contract enumerates it today), grounded in the baseline audit's own
 * per-display-kind authorized-source column. `"synthetic"` covers nodes with
 * no single backing row (e.g. the work's own computed outline) and
 * `"aggregate"` covers a disclosure summary node, which has no single
 * source entity by definition.
 */
export const SOURCE_ENTITY_KINDS = [
  "work",
  "bibliographic_record",
  "research_resource",
  "learning_resource",
  "concept",
  "text_block",
  "passage_annotation",
  "research_claim",
  "claim_relationship",
  "debate_cluster",
  "research_project",
  "research_hypothesis",
  "research_gap",
  "writer_project",
  "roadmap_projection",
  "synthetic",
  "aggregate",
] as const;

export type SourceEntityKind = (typeof SOURCE_ENTITY_KINDS)[number];

/** Manual mirror of `apps/web/src/components/graph/types.ts`'s `NodeState`
 *  (6 values) — same discipline as `CanonicalNodeTypeMirror` above. Used
 *  only by `unavailableReasonForState` (see `state.ts`). */
export const CANONICAL_NODE_STATES = ["primary", "read", "reading", "unread", "missing", "structural"] as const;

export type CanonicalNodeStateMirror = (typeof CANONICAL_NODE_STATES)[number];
