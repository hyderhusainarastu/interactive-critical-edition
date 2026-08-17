/**
 * Ask Library deep-link params (charter §9, last paragraph: "Also preserve
 * and test existing Ask Library deep-link state, including `mode`,
 * `claimId`, `clusterId`, and `workIdB`, while enforcing the
 * single-controller rule."). This requirement sits inside charter §9
 * ("Graph data contracts and display adapter") rather than §12 ("Ask
 * Library") or the shell/nav sections, so this package — §9's own home —
 * is where it lands, per this Stage 3 lane's brief ("put the parser where
 * the package README argues it belongs").
 *
 * Why this genuinely belongs here and isn't just a convenient place to
 * dump unrelated params: `GraphUrlContext`'s five kinds (`urlState.ts`)
 * already include `"question"`, `"claim"`, and `"debate"` — the exact
 * entities `claimId`/`clusterId` identify — and the charter's §9 "Context
 * kind and ID" line is what those Ask Library deep-link ids are conceptually
 * pointing at when Ask Library is opened *from* a Knowledge Map context
 * (a claim node, a debate cluster). Keeping the parser next to
 * `GraphUrlContext`/`GraphUrlState` means a future integration lane can
 * reuse the same `claimId`/`clusterId` values to also seed a graph
 * context, rather than maintaining two independent parses of the same
 * ids in two different packages.
 *
 * This module does NOT implement "the single-controller rule" itself
 * (charter §9/§12: exactly one mounted Ask Library conversation
 * controller at a time) — that is UI-mount-lifecycle behavior, explicitly
 * out of scope for a zero-React, zero-renderer pure package (see the
 * package README's "What this package does NOT do"). It only parses and
 * serializes the deep-link *state* a real controller would read.
 *
 * `mode`'s allowed values are NOT constrained to a fixed union here.
 * Section 3's route inventory names an `askResearchModes` feature flag and
 * §3's product text says "Existing ordinary and research modes," but no
 * source-of-truth document available to this lane spells out the exact
 * wire-format string(s) Ask Library's own UI currently writes for `mode`
 * (`docs/audits/ui-graph-redesign-baseline.md` does not include an Ask
 * Library param table the way it does for `/graph`). Rather than guess at
 * and hard-code unverified literal values, `mode` is preserved as an
 * opaque, tolerant string — "preserve deep-link state" losslessly, without
 * fabricating a vocabulary this package cannot verify.
 */

const MODE_PARAM = "mode";
const CLAIM_ID_PARAM = "claimId";
const CLUSTER_ID_PARAM = "clusterId";
const WORK_ID_B_PARAM = "workIdB";

export interface AskLibraryDeepLinkParams {
  mode: string | null;
  claimId: string | null;
  clusterId: string | null;
  workIdB: string | null;
}

export const EMPTY_ASK_LIBRARY_DEEP_LINK: AskLibraryDeepLinkParams = {
  mode: null,
  claimId: null,
  clusterId: null,
  workIdB: null,
};

/** Tolerant of any other params present (e.g. this package's own
 *  `GraphUrlState` keys, when Ask Library is opened alongside a graph
 *  context) — reads only its four known keys, ignores everything else. */
export function parseAskLibraryDeepLink(params: URLSearchParams): AskLibraryDeepLinkParams {
  return {
    mode: params.get(MODE_PARAM),
    claimId: params.get(CLAIM_ID_PARAM),
    clusterId: params.get(CLUSTER_ID_PARAM),
    workIdB: params.get(WORK_ID_B_PARAM),
  };
}

/**
 * Serialize into a NEW `URLSearchParams` (never mutates one passed by a
 * caller — matching this package's pure/no-mutation convention
 * elsewhere, e.g. `disclosure.ts`'s functions never mutate their inputs).
 * A caller that wants to merge these onto an existing param set does so
 * itself, e.g. `new URLSearchParams([...existing, ...serializeAskLibraryDeepLink(state)])`.
 */
export function serializeAskLibraryDeepLink(state: AskLibraryDeepLinkParams): URLSearchParams {
  const params = new URLSearchParams();
  if (state.mode !== null) params.set(MODE_PARAM, state.mode);
  if (state.claimId !== null) params.set(CLAIM_ID_PARAM, state.claimId);
  if (state.clusterId !== null) params.set(CLUSTER_ID_PARAM, state.clusterId);
  if (state.workIdB !== null) params.set(WORK_ID_B_PARAM, state.workIdB);
  return params;
}
