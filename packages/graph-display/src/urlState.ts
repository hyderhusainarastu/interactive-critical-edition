/**
 * `GraphUrlState` (charter §9 "Make the following URL state restorable")
 * — the typed shape of everything the Knowledge Map's address bar must be
 * able to reconstruct. This module owns the SCHEMA only (types + small
 * total-function guards); parsing/serializing to/from `URLSearchParams`
 * lives in `urlStateCodec.ts`, reconstruction-with-validation lives in
 * `reconstruct.ts`, and legacy-URL translation lives in `legacyGraphUrl.ts`
 * — kept as four separate files because they have four separable
 * responsibilities (schema vs. wire format vs. authorization-aware replay
 * vs. one-time migration), matching the same "one file, one concern"
 * granularity the rest of this package already uses (`families.ts` vs.
 * `disclosure.ts` vs. `validate.ts`).
 *
 * Explicitly NOT in this state (charter, verbatim): "Camera coordinates
 * remain ephemeral." No field here represents camera position/orientation
 * — that is deliberately session-local render state, never persisted to
 * the URL, and reconstructing a context always re-derives a deterministic
 * "Home" framing rather than restoring a prior camera pose.
 */

import type { DisplayNodeId } from "./ids";
import type { Layer } from "./layers";

/** Charter §9's five context kinds ("Context kind and ID"). A "question"
 *  context is a Research question/debate-adjacent entry point distinct
 *  from a fully-formed `debate` cluster — both are legitimate root
 *  contexts per the charter's target IA (§6 Research). */
export const GRAPH_CONTEXT_KINDS = ["work", "passage", "question", "claim", "debate"] as const;
export type GraphContextKind = (typeof GRAPH_CONTEXT_KINDS)[number];

export function isGraphContextKind(value: string): value is GraphContextKind {
  return (GRAPH_CONTEXT_KINDS as readonly string[]).includes(value);
}

/** The root the Knowledge Map is currently centered on. `id` is a raw
 *  string (not a branded id) — a context id is looked up against whichever
 *  system owns that kind (works, passages, research questions, claims,
 *  debate clusters), not against this package's own display-id space. */
export interface GraphUrlContext {
  kind: GraphContextKind;
  id: string;
}

export const GRAPH_VIEW_MODES = ["3d", "2d", "list"] as const;
export type GraphViewMode = (typeof GRAPH_VIEW_MODES)[number];

export function isGraphViewMode(value: string): value is GraphViewMode {
  return (GRAPH_VIEW_MODES as readonly string[]).includes(value);
}

/**
 * Charter §9's five focus states, using the task brief's own literal names
 * (`all|neighborhood|expand2|concepts|readingPath`) rather than a
 * discriminated-union `{kind:...}` shape — a plain string union is the
 * simplest total representation and matches how `layers`/`view` are
 * already modeled here.
 */
export const GRAPH_FOCUS_STATES = ["all", "neighborhood", "expand2", "concepts", "readingPath"] as const;
export type GraphFocusState = (typeof GRAPH_FOCUS_STATES)[number];

export function isGraphFocusState(value: string): value is GraphFocusState {
  return (GRAPH_FOCUS_STATES as readonly string[]).includes(value);
}

export const DEFAULT_GRAPH_VIEW: GraphViewMode = "3d";
export const DEFAULT_GRAPH_FOCUS: GraphFocusState = "all";

/**
 * The full current filter-param vocabulary (baseline audit §8's
 * client-side `FILTER_KEYS` inventory, `GraphView.tsx:74`), carried
 * verbatim as this package's own new-state filter key names — deliberately
 * IDENTICAL names to the legacy ones so `legacyGraphUrl.ts`'s "translate
 * losslessly to the new filter state" requirement is a direct passthrough
 * with nothing lost or renamed, not a remapping that could silently drop a
 * value.
 */
export const GRAPH_FILTER_KEYS = [
  "search",
  "state",
  "type",
  "authority",
  "provider",
  "relation",
  "credibilityBand",
  "associatedWork",
  "stage",
  "readerLevel",
  "conceptKind",
] as const;

export type GraphFilterKey = (typeof GRAPH_FILTER_KEYS)[number];

/** A filter is present-with-a-value or absent entirely — never present
 *  with `null`/`undefined` as an explicit "cleared" marker, matching how
 *  `URLSearchParams` itself has no concept of "key present but empty"
 *  distinct from "key absent" for our purposes (an empty string value IS a
 *  real, distinct, round-trippable state — see `urlStateCodec.ts`). */
export type GraphUrlFilters = Partial<Record<GraphFilterKey, string>>;

export function isGraphFilterKey(value: string): value is GraphFilterKey {
  return (GRAPH_FILTER_KEYS as readonly string[]).includes(value);
}

/**
 * The full restorable Knowledge Map URL state (charter §9). `activeLayers`
 * is the six-band `Layer` union from `layers.ts` — concrete, not generic,
 * since (unlike `DisplayKind`) `Layer` is charter §8's own fixed six-value
 * contract, not a canonical type this package must avoid duplicating.
 *
 * `expansionTrail` is an ORDERED list of `DisplayNodeId`s — the sequence
 * of explicit-expansion targets a user has opened, in the order they
 * opened them (charter: "Replay valid expansion IDs in order"). It is
 * capped to `EXPANSION_CAP` (`disclosure.ts`) — "the product's explicit
 * expansion limit" the charter refers to — enforced by
 * `urlStateCodec.ts`'s serializer and `reconstruct.ts`'s replay, not by
 * this type itself (a type cannot enforce a runtime array-length cap).
 */
export interface GraphUrlState {
  context: GraphUrlContext;
  view: GraphViewMode;
  selectedId: DisplayNodeId | null;
  activeLayers: Layer[];
  filters: GraphUrlFilters;
  expansionTrail: DisplayNodeId[];
  focus: GraphFocusState;
}
