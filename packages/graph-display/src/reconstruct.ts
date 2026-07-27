/**
 * URL-state RECONSTRUCTION rules (charter §9, verbatim):
 *
 *   - Rebuild the base context deterministically.
 *   - Replay valid expansion IDs in order.
 *   - Recreate aggregate summaries from their current basis rather than
 *     trusting stale counts.
 *   - Ignore unauthorized, deleted, or no-longer-valid IDs, announce the
 *     omission non-disruptively, and preserve the rest of the state.
 *   - Back/Forward must reconstruct the same context, expansion trail,
 *     focus state, selection, layers, and filters.
 *
 * Every function here is pure: a caller supplies `ValidityCheck` callbacks
 * (this package has no DB access and no notion of "authorized" on its
 * own — see the package README's "no wiring into apps/web" section) and
 * gets back a reconstructed state plus a typed `omitted` list, never a
 * thrown error and never a silently-dropped-without-explanation id.
 */

import { buildAggregateNodes, EXPANSION_CAP, type AggregationOptions, type AggregationResult } from "./disclosure";
import type { DisplayNodeId } from "./ids";
import type { CanonicalNodeTypeMirror } from "./kinds";
import type { OmittedEntry, ValidityCheck } from "./omission";
import type { DisplayNode } from "./types";
import type { GraphUrlContext, GraphUrlFilters, GraphFocusState, GraphUrlState } from "./urlState";
import type { Layer } from "./layers";

/**
 * "Rebuild the base context deterministically." A context is either still
 * valid (same kind/id, re-checked against the current, live authorization
 * state — never trusted just because it round-tripped through the URL) or
 * it is not, in which case there is no safe default context to fall back
 * to (unlike a filter or a focus state, a context is *the thing everything
 * else is relative to*) — the caller (a page/router) is expected to route
 * to a context chooser when `contextValid` is `false`, exactly the
 * behavior `legacyGraphUrl.ts` already implements for the equivalent
 * legacy case.
 */
export interface RebuiltContext {
  context: GraphUrlContext;
  contextValid: boolean;
  omitted: OmittedEntry[];
}

export function rebuildContext(context: GraphUrlContext, checkContext: ValidityCheck<GraphUrlContext>): RebuiltContext {
  const reason = checkContext(context);
  if (reason === null) {
    return { context, contextValid: true, omitted: [] };
  }
  return {
    context,
    contextValid: false,
    omitted: [{ value: context.id, reason, source: "context" }],
  };
}

/**
 * "Replay valid expansion IDs in order." Preserves the original order of
 * everything that survives; drops (with a reason) anything the caller's
 * validity check rejects, and anything beyond `EXPANSION_CAP` regardless
 * of validity (an over-long trail is itself a "no longer valid" state —
 * the product's own expansion limit was violated somewhere upstream of
 * this call, most plausibly a hand-edited or very old URL).
 */
export interface ReplayedExpansion {
  expansionTrail: DisplayNodeId[];
  omitted: OmittedEntry[];
}

export function replayExpansionTrail(
  trail: readonly DisplayNodeId[],
  checkExpansionId: ValidityCheck<DisplayNodeId>,
): ReplayedExpansion {
  const expansionTrail: DisplayNodeId[] = [];
  const omitted: OmittedEntry[] = [];

  for (const id of trail) {
    if (expansionTrail.length >= EXPANSION_CAP) {
      omitted.push({ value: String(id), reason: "over_cap", source: "expansionTrail" });
      continue;
    }
    const reason = checkExpansionId(id);
    if (reason === null) {
      expansionTrail.push(id);
    } else {
      omitted.push({ value: String(id), reason, source: "expansionTrail" });
    }
  }

  return { expansionTrail, omitted };
}

/** "Restore selection if authorized and visible; otherwise announce why it
 *  was omitted" (the same rule the legacy `selected` param gets — this is
 *  its new-URL-state equivalent). */
export interface ReconciledSelection {
  selectedId: DisplayNodeId | null;
  omitted: OmittedEntry[];
}

export function reconcileSelectedId(
  selectedId: DisplayNodeId | null,
  checkSelectedId: ValidityCheck<DisplayNodeId>,
): ReconciledSelection {
  if (selectedId === null) return { selectedId: null, omitted: [] };
  const reason = checkSelectedId(selectedId);
  if (reason === null) return { selectedId, omitted: [] };
  return { selectedId: null, omitted: [{ value: String(selectedId), reason, source: "selected" }] };
}

/**
 * "Recreate aggregate summaries from their current basis rather than
 * trusting stale counts." `GraphUrlState` never stores an aggregate count
 * or label at all (see `urlState.ts` — no such field exists), so there is
 * nothing to "trust" here even by omission; this function's signature
 * itself enforces the rule by construction — it accepts only a *current*
 * hidden-node basis (never a previous count/summary), so calling it with
 * stale data is not an option the type system allows. A thin, intentional
 * wrapper over `disclosure.ts`'s `buildAggregateNodes`, kept as its own
 * named export so the reconstruction rule this package README/charter
 * calls out explicitly has its own visible, testable entry point rather
 * than being an implicit consequence a reader has to infer.
 */
export function recreateAggregatesFromBasis<TCanonicalKind extends string = CanonicalNodeTypeMirror>(
  currentHidden: readonly DisplayNode<TCanonicalKind>[],
  options: AggregationOptions,
): AggregationResult<TCanonicalKind> {
  return buildAggregateNodes(currentHidden, options);
}

/**
 * Full reconstruction over one parsed `GraphUrlState` (charter's "Back/
 * Forward must reconstruct the same context, expansion trail, focus
 * state, selection, layers, and filters"). `activeLayers` and `filters`
 * pass through unchanged — neither carries an id a validity check could
 * reject (a `Layer` is a closed six-value enum this package already
 * totally validates on parse; a filter is caller-defined free text with no
 * authorization concept of its own) — so only `context`, `expansionTrail`,
 * and `selectedId` can produce omissions.
 */
export interface ReconstructionValidators {
  checkContext: ValidityCheck<GraphUrlContext>;
  checkExpansionId: ValidityCheck<DisplayNodeId>;
  checkSelectedId: ValidityCheck<DisplayNodeId>;
}

export interface ReconstructedGraphUrlState {
  context: GraphUrlContext;
  contextValid: boolean;
  view: GraphUrlState["view"];
  selectedId: DisplayNodeId | null;
  activeLayers: Layer[];
  filters: GraphUrlFilters;
  expansionTrail: DisplayNodeId[];
  focus: GraphFocusState;
  omitted: OmittedEntry[];
}

export function reconstructGraphUrlState(
  state: GraphUrlState,
  validators: ReconstructionValidators,
): ReconstructedGraphUrlState {
  const rebuiltContext = rebuildContext(state.context, validators.checkContext);
  const replayed = replayExpansionTrail(state.expansionTrail, validators.checkExpansionId);
  const reconciledSelection = reconcileSelectedId(state.selectedId, validators.checkSelectedId);

  return {
    context: rebuiltContext.context,
    contextValid: rebuiltContext.contextValid,
    view: state.view,
    selectedId: reconciledSelection.selectedId,
    activeLayers: state.activeLayers,
    filters: state.filters,
    expansionTrail: replayed.expansionTrail,
    focus: state.focus,
    omitted: [...rebuiltContext.omitted, ...replayed.omitted, ...reconciledSelection.omitted],
  };
}
