/**
 * `GraphUrlState` <-> `URLSearchParams` wire format (charter §9). Two pure
 * functions, `serializeGraphUrlState`/`parseGraphUrlState`, designed
 * specifically so `parseGraphUrlState(serializeGraphUrlState(state))`
 * round-trips to a value deep-equal to `state` for every well-formed
 * `GraphUrlState` — see `urlState.test.ts`'s property-based-style suite.
 *
 * Wire-format choices, and why:
 *  - Context is TWO params (`ctxKind`/`ctxId`), not one joined
 *    `"kind:id"` string — a context id is an opaque string from another
 *    system (work/passage/question/claim/debate) and could itself contain
 *    a colon; splitting into two params means no delimiter can ever
 *    collide with real id content.
 *  - `activeLayers` and `expansionTrail` are REPEATED params (`layer=`,
 *    `expand=`, read with `getAll`), not comma-joined — same reasoning:
 *    a display id is an opaque string this package does not control the
 *    character set of, so no delimiter is safe to join on. This mirrors
 *    the existing codebase's own convention for repeated values
 *    (`pinnedWork`/`roadmapRoot`, baseline audit §8).
 *  - A filter key is present-with-a-value or absent — including an empty
 *    string as a real, distinct, round-trippable value (`URLSearchParams`
 *    already treats `?search=` as "present, empty string" distinctly from
 *    "absent", and this codec preserves that distinction both ways).
 */

import { EXPANSION_CAP } from "./disclosure";
import { toDisplayNodeId, unwrapId, type DisplayNodeId } from "./ids";
import { isLayer, type Layer } from "./layers";
import {
  GRAPH_FILTER_KEYS,
  DEFAULT_GRAPH_FOCUS,
  DEFAULT_GRAPH_VIEW,
  isGraphContextKind,
  isGraphFocusState,
  isGraphViewMode,
  type GraphUrlContext,
  type GraphUrlFilters,
  type GraphUrlState,
} from "./urlState";

const CTX_KIND_PARAM = "ctxKind";
const CTX_ID_PARAM = "ctxId";
const VIEW_PARAM = "view";
const SELECTED_PARAM = "selected";
const LAYER_PARAM = "layer";
const EXPAND_PARAM = "expand";
const FOCUS_PARAM = "focus";

export class GraphUrlStateParseError extends Error {
  constructor(detail: string) {
    super(`Cannot parse GraphUrlState: ${detail}`);
    this.name = "GraphUrlStateParseError";
  }
}

/**
 * Read the `GRAPH_FILTER_KEYS` vocabulary straight off `params`. Exported
 * (not just an internal helper) because `legacyGraphUrl.ts` reuses this
 * EXACT function for its own "translate every filter param losslessly"
 * requirement — the new and legacy filter param names are identical by
 * design (`urlState.ts`'s `GRAPH_FILTER_KEYS` doc comment), so there is
 * only ever one filter-extraction implementation, never two that could
 * drift apart.
 */
export function extractGraphUrlFilters(params: URLSearchParams): GraphUrlFilters {
  const filters: GraphUrlFilters = {};
  for (const key of GRAPH_FILTER_KEYS) {
    if (params.has(key)) {
      filters[key] = params.get(key) ?? "";
    }
  }
  return filters;
}

function writeGraphUrlFilters(params: URLSearchParams, filters: GraphUrlFilters): void {
  for (const key of GRAPH_FILTER_KEYS) {
    const value = filters[key];
    if (value !== undefined) params.set(key, value);
  }
}

/**
 * Serialize a `GraphUrlState` to `URLSearchParams`. `expansionTrail` is
 * truncated to `EXPANSION_CAP` entries (keeping the earliest — the ones a
 * user actually opened first) if it somehow arrives longer than the
 * product's own expansion limit; a `GraphUrlState` built by this package's
 * own reconstruction/legacy paths never exceeds the cap, so this is a
 * defensive floor, not the primary enforcement point.
 */
export function serializeGraphUrlState(state: GraphUrlState): URLSearchParams {
  const params = new URLSearchParams();

  params.set(CTX_KIND_PARAM, state.context.kind);
  params.set(CTX_ID_PARAM, state.context.id);
  params.set(VIEW_PARAM, state.view);
  params.set(FOCUS_PARAM, state.focus);

  if (state.selectedId !== null) {
    params.set(SELECTED_PARAM, unwrapId(state.selectedId));
  }

  for (const layer of state.activeLayers) {
    params.append(LAYER_PARAM, layer);
  }

  for (const id of state.expansionTrail.slice(0, EXPANSION_CAP)) {
    params.append(EXPAND_PARAM, unwrapId(id));
  }

  writeGraphUrlFilters(params, state.filters);

  return params;
}

/**
 * Parse `URLSearchParams` back into a `GraphUrlState`. Tolerant of unknown
 * params (anything not one of this codec's known keys is silently
 * ignored — never a parse error). `view`/`focus` default rather than throw
 * when missing/invalid, since a hand-typed or partially-stale URL missing
 * one optional-feeling field is common and recoverable; `context` throws
 * `GraphUrlStateParseError` when missing or carrying an unrecognized kind,
 * since there is no safe default context to fall back to — a caller with
 * no reliable context should not be calling this parser at all (that is
 * exactly what `reconstruct.ts`/`legacyGraphUrl.ts` exist to handle
 * gracefully, each with its own documented never-throws contract).
 */
export function parseGraphUrlState(params: URLSearchParams): GraphUrlState {
  const ctxKind = params.get(CTX_KIND_PARAM);
  const ctxId = params.get(CTX_ID_PARAM);
  if (ctxKind === null || ctxId === null || ctxId === "") {
    throw new GraphUrlStateParseError(`missing "${CTX_KIND_PARAM}"/"${CTX_ID_PARAM}".`);
  }
  if (!isGraphContextKind(ctxKind)) {
    throw new GraphUrlStateParseError(`unrecognized context kind "${ctxKind}".`);
  }
  const context: GraphUrlContext = { kind: ctxKind, id: ctxId };

  const rawView = params.get(VIEW_PARAM);
  const view = rawView !== null && isGraphViewMode(rawView) ? rawView : DEFAULT_GRAPH_VIEW;

  const rawFocus = params.get(FOCUS_PARAM);
  const focus = rawFocus !== null && isGraphFocusState(rawFocus) ? rawFocus : DEFAULT_GRAPH_FOCUS;

  const rawSelected = params.get(SELECTED_PARAM);
  const selectedId: DisplayNodeId | null = rawSelected !== null ? toDisplayNodeId(rawSelected) : null;

  const activeLayers: Layer[] = params.getAll(LAYER_PARAM).filter(isLayer);

  const expansionTrail: DisplayNodeId[] = params
    .getAll(EXPAND_PARAM)
    .slice(0, EXPANSION_CAP)
    .map(toDisplayNodeId);

  const filters = extractGraphUrlFilters(params);

  return { context, view, selectedId, activeLayers, filters, expansionTrail, focus };
}
