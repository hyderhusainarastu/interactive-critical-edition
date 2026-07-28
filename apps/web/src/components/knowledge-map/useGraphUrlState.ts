/**
 * React/Next-router binding for `GraphUrlState` (charter §9 "Make the
 * following URL state restorable", spec §1.1's `useGraphUrlState.ts` row).
 * Reads/writes `URLSearchParams` via `useSearchParams`/`router.replace`/
 * `router.push`, calling straight into `@ice/graph-display`'s
 * `parseGraphUrlState`/`serializeGraphUrlState`/`reconstructGraphUrlState`
 * — this file owns NO URL-schema or reconstruction logic of its own, so
 * the pure package stays the single source of truth and this hook cannot
 * silently drift from it.
 *
 * Split the same way `useKnowledgeMapCamera.ts` already is (spec §4.1's own
 * precedent):
 *   1. `mergeGraphUrlStatePatch`/`buildGraphUrlHref`/`defaultOpenContextState`
 *      — pure functions of plain data, directly unit-testable
 *      (`useGraphUrlState.test.ts`) without React/DOM/next/navigation.
 *   2. `useGraphUrlState` itself — the thin `useSearchParams`/`useRouter`
 *      binding layer around layer 1. Per `useKnowledgeMapCamera.ts`'s own
 *      documented precedent, this layer is NOT covered by this step's unit
 *      tests (it needs a real Next.js router context, which this repo's
 *      established `.test.ts`-via-`tsx` convention doesn't provide); real
 *      coverage is the charter §16 Playwright suite (`knowledge-map.spec.ts`),
 *      a later step's deliverable — recorded here rather than silently
 *      assumed covered.
 */
"use client";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  DEFAULT_GRAPH_FOCUS,
  DEFAULT_GRAPH_VIEW,
  GraphUrlStateParseError,
  parseGraphUrlState,
  reconstructGraphUrlState,
  serializeGraphUrlState,
  type GraphUrlContext,
  type GraphUrlState,
  type ReconstructedGraphUrlState,
  type ReconstructionValidators,
} from "@ice/graph-display";

// --- Pure helpers (layer 1) -------------------------------------------

/** Builds a full navigable href for a `GraphUrlState` against `pathname` —
 *  no trailing `?` when the state serializes to zero params (never happens
 *  in practice, since `context`/`view`/`focus` are always written, but kept
 *  honest rather than assumed). */
export function buildGraphUrlHref(pathname: string, state: GraphUrlState): string {
  const qs = serializeGraphUrlState(state).toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Shallow-merges `patch` onto `current` — a plain object merge, but named
 *  and exported so callers never hand-roll `{ ...current, ...patch }`
 *  inline and risk forgetting a field `GraphUrlState` adds later. */
export function mergeGraphUrlStatePatch(current: GraphUrlState, patch: Partial<GraphUrlState>): GraphUrlState {
  return { ...current, ...patch };
}

/** The full `GraphUrlState` a fresh context opens to when the caller
 *  supplies no `overrides` — `view`/`focus` default per
 *  `@ice/graph-display`'s own constants (never re-declared here), and every
 *  other field starts empty. */
export function defaultOpenContextState(context: GraphUrlContext, overrides: Partial<Omit<GraphUrlState, "context">> = {}): GraphUrlState {
  return {
    context,
    view: DEFAULT_GRAPH_VIEW,
    selectedId: null,
    activeLayers: [],
    filters: {},
    expansionTrail: [],
    focus: DEFAULT_GRAPH_FOCUS,
    ...overrides,
  };
}

/** Parses `params` into a `GraphUrlState`, or `null` when no `ctxKind`/
 *  `ctxId` is present (a bare `/graph`, or a legacy-format URL the caller
 *  is expected to have already run through `translateLegacyGraphUrl`
 *  before ever reaching this parser — see `useLegacyGraphUrlRedirect.ts`).
 *  Never throws: `GraphUrlStateParseError` (the only error
 *  `parseGraphUrlState` raises) is caught and treated the same as "no
 *  context yet", since both mean the same thing to a caller — there is no
 *  valid state to work with — and a hand-typed/stale URL missing/mangling
 *  the context params is exactly the "recoverable" case this degrades to
 *  rather than crashing the page. */
export function parseGraphUrlStateOrNull(params: URLSearchParams): GraphUrlState | null {
  try {
    return parseGraphUrlState(params);
  } catch (err) {
    if (err instanceof GraphUrlStateParseError) return null;
    throw err;
  }
}

/** Validators that accept everything — the safe default when the caller
 *  (the workspace) has not yet loaded enough real data to validate
 *  ids for real (e.g. before the context's owned-entity list has
 *  resolved). Never used to claim something IS valid in a way that skips a
 *  real check once the workspace can perform one — see this hook's
 *  `validators` option below. */
export const PERMISSIVE_RECONSTRUCTION_VALIDATORS: ReconstructionValidators = {
  checkContext: () => null,
  checkExpansionId: () => null,
  checkSelectedId: () => null,
};

// --- React binding (layer 2) --------------------------------------------

export interface GraphUrlStateApi {
  /** The raw parsed state, or `null` when the current URL carries no
   *  `ctxKind`/`ctxId` at all. */
  raw: GraphUrlState | null;
  /** `raw` run through `reconstructGraphUrlState` — identical to `raw`
   *  (aside from the `contextValid`/`omitted` fields, always present) when
   *  the supplied `validators` accept everything (the default). `null` iff
   *  `raw` is `null`. */
  reconstructed: ReconstructedGraphUrlState | null;
  /** Merges `patch` onto the CURRENT parsed state and writes the result to
   *  the URL. A no-op (does nothing, does not throw) when `raw` is `null`
   *  — there is no state to patch onto; the caller should use
   *  `openContext` to establish one. `push` defaults to `false`
   *  (`router.replace`, no new history entry) — the right default for
   *  ordinary in-context changes (filters, selection, view, layers, focus,
   *  expansion) per charter §9's own framing of these as state WITHIN one
   *  navigable context, not each its own back-button stop; a documented
   *  judgment call, not a literal charter instruction. */
  setState(patch: Partial<GraphUrlState>, options?: { push?: boolean }): void;
  /** Establishes a brand-new context (`defaultOpenContextState` plus any
   *  `overrides`) and writes it to the URL. `push` defaults to `true` —
   *  opening a different context IS a real "go somewhere new" navigation
   *  worth a Back-button stop, unlike the in-context patches `setState`
   *  handles. */
  openContext(context: GraphUrlContext, overrides?: Partial<Omit<GraphUrlState, "context">>, options?: { push?: boolean }): void;
}

export interface UseGraphUrlStateOptions {
  /** Supplied once the workspace has real data to validate ids against
   *  (e.g. the currently-loaded `DisplayNode` set). Defaults to
   *  `PERMISSIVE_RECONSTRUCTION_VALIDATORS` — see that constant's own doc
   *  comment for why "accept everything" is the correct, honest default
   *  before real data exists, not a shortcut that silently skips
   *  validation forever. */
  validators?: ReconstructionValidators;
}

export function useGraphUrlState(options: UseGraphUrlStateOptions = {}): GraphUrlStateApi {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const validators = options.validators ?? PERMISSIVE_RECONSTRUCTION_VALIDATORS;

  const raw = useMemo(() => parseGraphUrlStateOrNull(searchParams), [searchParams]);

  const reconstructed = useMemo(() => {
    if (raw === null) return null;
    return reconstructGraphUrlState(raw, validators);
    // `validators` is an object the caller may recreate every render; this
    // hook intentionally does NOT try to deep-compare it (out of scope for
    // a thin binding layer) — a caller that wants stable reconciliation
    // across renders should memoize its own `validators` object, the same
    // discipline any other `useMemo` dependency requires.
  }, [raw, validators]);

  const navigate = useCallback(
    (state: GraphUrlState, push: boolean) => {
      const href = buildGraphUrlHref(pathname, state);
      if (push) router.push(href);
      else router.replace(href);
    },
    [pathname, router],
  );

  const setState = useCallback(
    (patch: Partial<GraphUrlState>, opts: { push?: boolean } = {}) => {
      if (raw === null) return;
      navigate(mergeGraphUrlStatePatch(raw, patch), opts.push ?? false);
    },
    [raw, navigate],
  );

  const openContext = useCallback(
    (context: GraphUrlContext, overrides: Partial<Omit<GraphUrlState, "context">> = {}, opts: { push?: boolean } = {}) => {
      navigate(defaultOpenContextState(context, overrides), opts.push ?? true);
    },
    [navigate],
  );

  return useMemo(() => ({ raw, reconstructed, setState, openContext }), [raw, reconstructed, setState, openContext]);
}
