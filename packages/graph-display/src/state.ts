/**
 * Canonical `NodeState` → `DisplayNode.unavailableReason` projection.
 *
 * The charter's `DisplayNode` shape (§9) carries no `state` field of its
 * own — reading/acquisition state is a canonical-payload concern a real
 * caller can always read straight off the linked `canonicalNodeId`. What
 * the display contract DOES need from state is a plain-language reason a
 * node has no real destination to open, which is exactly what
 * `unavailableReason` is for. `"missing"` is the one canonical state that
 * means "this node cannot be opened" (mirrors `STATE_META.missing`'s own
 * label, "Referenced, not acquired," in the canonical `types.ts`); every
 * other state describes an available (or simply non-openable-by-nature,
 * e.g. `structural`) node and carries no unavailability reason at all.
 *
 * Generic over the canonical state union for the same reason `kinds.ts`'s
 * `DisplayKind` is generic — `NodeState` lives in `apps/web`, not an
 * importable package. `DEFAULT_STATE_UNAVAILABLE_REASON` is this package's
 * own tested reference mapping for today's 6 known values (manual mirror,
 * `CanonicalNodeStateMirror`, from `kinds.ts`).
 */

import { CANONICAL_NODE_STATES, type CanonicalNodeStateMirror } from "./kinds";

export const DEFAULT_STATE_UNAVAILABLE_REASON: Record<CanonicalNodeStateMirror, string | null> = {
  primary: null,
  read: null,
  reading: null,
  unread: null,
  structural: null,
  missing: "Referenced, not acquired — not held in your library",
};

/**
 * Total function over any canonical state string a caller supplies,
 * defaulting to `DEFAULT_STATE_UNAVAILABLE_REASON` for today's 6 known
 * values. An unrecognized state (future canonical growth this package
 * hasn't been told about yet) degrades to `null` (available) rather than
 * inventing an unavailability claim — the same "never punish/misrepresent
 * missing data" posture the canonical codebase already uses throughout.
 */
export function unavailableReasonForState<TState extends string = CanonicalNodeStateMirror>(
  state: TState,
  reasons: Partial<Record<TState, string | null>> = DEFAULT_STATE_UNAVAILABLE_REASON as Partial<Record<TState, string | null>>,
): string | null {
  return reasons[state] ?? null;
}

export function isKnownCanonicalNodeState(state: string): state is CanonicalNodeStateMirror {
  return (CANONICAL_NODE_STATES as readonly string[]).includes(state);
}
