/**
 * Legacy `/graph` URL compatibility (charter §9 "Legacy graph URL
 * compatibility" table, baseline audit §8's full param inventory).
 * `translateLegacyGraphUrl` is the single entry point: given the OLD
 * `GraphView.tsx`/`roadmapGraph.ts` query-param vocabulary, produce
 * exactly one of three outcomes — a redirect to a different page, a
 * ready-to-use `GraphUrlState`, or a chooser the caller must render — and
 * NEVER throw, however malformed or hostile the input (charter, verbatim:
 * "Return a discriminated union (redirect | state | chooser+notice), never
 * throw on malformed input").
 *
 * ## Interpretive decision: what "context-first Knowledge Map" means for
 * a bare `layout=explore`
 *
 * The compat table's first row says `layout=explore` should "Open the
 * context-first Knowledge Map with `view=3d`." Legacy Explore mode had no
 * notion of a single anchored context (it rendered every owned work's
 * graph flattened together); the redesigned Knowledge Map's `GraphUrlState`
 * (`urlState.ts`) always requires exactly one `context`. Those two facts
 * don't fully reconcile on their own, so this module resolves the gap
 * explicitly rather than silently picking one: `layout=explore` sets a
 * PREFERRED view of `"3d"` that carries through to whichever context
 * outcome this function ultimately reaches — if a `roadmapRoot`/
 * `pinnedWork` is also present, the resulting `state`/`redirect` uses that
 * anchor with `view=3d`; if nothing anchors a context at all, the result
 * is the new context chooser (see "bare `/graph`" below) with a preferred
 * `view=3d` so the chooser's own eventual context pick opens in 3D. This
 * is a documented judgment call, not a literal charter instruction — see
 * `legacyGraphUrl.test.ts`'s `layout=explore` cases for the exact
 * behavior this resolves to.
 *
 * ## Interpretive decision: bare `/graph` (no legacy markers at all)
 *
 * Charter §9, immediately after the compat table: "A bare new `/graph`
 * intentionally opens the context chooser; that target behavior
 * supersedes the old implicit Roadmap default." A URL carrying none of
 * `layout`/`roadmapRoot`/`pinnedWork`/`readingThread`/`focusMode`/
 * `selected` therefore returns `{ kind: "chooser", chooserFor: "context" }`
 * with `notice: null` (this is the new INTENDED default, not an error
 * condition worth alarming a user about) rather than reproducing the old
 * implicit-Roadmap-mode default. The same "context" chooser outcome is
 * also reached whenever `focusMode`/`selected`/filter params are present
 * but nothing anchors a specific context — under-specification, not
 * malformed input, needs the same graceful chooser landing.
 */

import { toDisplayNodeId, type DisplayNodeId } from "./ids";
import type { Layer } from "./layers";
import type { OmittedEntry, OmittedReason, ValidityCheck } from "./omission";
import { extractGraphUrlFilters } from "./urlStateCodec";
import {
  DEFAULT_GRAPH_FOCUS,
  DEFAULT_GRAPH_VIEW,
  type GraphFocusState,
  type GraphUrlFilters,
  type GraphUrlState,
  type GraphViewMode,
} from "./urlState";

/** Baseline audit §8: "`WORK_PREFIX = "work:"` (`:89`), used inside
 *  `pinnedWork`/`roadmapRoot` values." */
const WORK_PREFIX = "work:";

function stripWorkPrefix(raw: string): string {
  return raw.startsWith(WORK_PREFIX) ? raw.slice(WORK_PREFIX.length) : raw;
}

export interface LegacyTranslationValidators {
  /** Checks a raw (prefix-already-stripped) work id from `roadmapRoot`/
   *  `pinnedWork`. `null` = valid. */
  checkWorkId: ValidityCheck<string>;
  checkSelectedId: ValidityCheck<DisplayNodeId>;
}

export interface LegacyChooserPartialState {
  filters: GraphUrlFilters;
  focus: GraphFocusState;
  selectedId: DisplayNodeId | null;
  activeLayers: Layer[];
  /** The view the eventual context, once chosen, should open in — carries
   *  `layout=explore`'s `view=3d` preference through even when no single
   *  context could be resolved from this URL alone (see module doc
   *  comment). Not meaningful for a `"roadmapRoots"` chooser, which lands
   *  on the separate 2D Roadmap surface, not the Knowledge Map. */
  view: GraphViewMode;
}

export interface LegacyRedirectResult {
  kind: "redirect";
  to: string;
  omitted: OmittedEntry[];
}

export interface LegacyStateResult {
  kind: "state";
  state: GraphUrlState;
  omitted: OmittedEntry[];
}

export interface LegacyChooserResult {
  kind: "chooser";
  chooserFor: "roadmapRoots" | "pinnedWork" | "context";
  candidateRoots: string[];
  notice: string | null;
  partial: LegacyChooserPartialState;
  omitted: OmittedEntry[];
}

export type LegacyGraphUrlTranslation = LegacyRedirectResult | LegacyStateResult | LegacyChooserResult;

const INVALID_FOCUS_MODE_REASON: OmittedReason = "invalid";

function translateFocus(params: URLSearchParams, omitted: OmittedEntry[]): GraphFocusState {
  // `readingThread=1` (charter: "Restore the reading-path overlay/focus
  // state") takes precedence over `focusMode` when both are present — it
  // is the more specific, more recently-added legacy signal.
  if (params.get("readingThread") === "1") return "readingPath";

  const focusMode = params.get("focusMode");
  if (focusMode === null) return DEFAULT_GRAPH_FOCUS;

  switch (focusMode) {
    case "focus":
      return "neighborhood";
    case "expand":
      return "expand2";
    case "full":
      return "all";
    case "concepts":
      return "concepts";
    default:
      omitted.push({ value: focusMode, reason: INVALID_FOCUS_MODE_REASON, source: "focusMode" });
      return DEFAULT_GRAPH_FOCUS;
  }
}

function translateSelected(
  params: URLSearchParams,
  validators: LegacyTranslationValidators,
  omitted: OmittedEntry[],
): DisplayNodeId | null {
  const raw = params.get("selected");
  if (raw === null || raw === "") return null;
  const id = toDisplayNodeId(raw);
  const reason = validators.checkSelectedId(id);
  if (reason === null) return id;
  omitted.push({ value: raw, reason, source: "selected" });
  return null;
}

/** "Redirect/map to `/works/<id>/roadmap`, preserving applicable reader/
 *  stage/path state" — `readerLevel`/`stage` filters and a `readingPath`
 *  focus (as `readingThread=1`, the Roadmap page's own existing param
 *  name) are the "applicable reader/stage/path state" available to
 *  preserve from this module's inputs. */
function buildRoadmapRedirectPath(workId: string, filters: GraphUrlFilters, focus: GraphFocusState): string {
  const query = new URLSearchParams();
  if (filters.readerLevel !== undefined) query.set("readerLevel", filters.readerLevel);
  if (filters.stage !== undefined) query.set("stage", filters.stage);
  if (focus === "readingPath") query.set("readingThread", "1");
  const qs = query.toString();
  return `/works/${encodeURIComponent(workId)}/roadmap${qs ? `?${qs}` : ""}`;
}

const NO_VALID_ROADMAP_ROOT_NOTICE =
  "This saved reading-order link no longer points at a work you can open — choose a work to continue.";

export function translateLegacyGraphUrl(
  params: URLSearchParams,
  validators: LegacyTranslationValidators,
): LegacyGraphUrlTranslation {
  const omitted: OmittedEntry[] = [];
  const filters = extractGraphUrlFilters(params);
  const focus = translateFocus(params, omitted);
  const selectedId = translateSelected(params, validators, omitted);
  // No legacy param maps to semantic layers at all — this is a genuinely
  // new field the old URL vocabulary never had an equivalent of, so there
  // is nothing to "translate losslessly"; starting with none active is the
  // only honest default (see `urlState.ts` — the redesign shows all
  // layers by default at the *render* level; an empty `activeLayers` here
  // just means "the URL itself expressed no layer preference").
  const activeLayers: Layer[] = [];

  const layoutParam = params.get("layout");
  const preferredView: GraphViewMode = layoutParam === "explore" ? "3d" : DEFAULT_GRAPH_VIEW;

  const partial = (view: GraphViewMode = preferredView): LegacyChooserPartialState => ({
    filters,
    focus,
    selectedId,
    activeLayers,
    view,
  });

  // --- Explicit `layout=roadmap`, or `roadmapRoot` present under the old
  // implicit default (`layoutParam === null`) — mutually exclusive with
  // `layout=explore` by construction, since `layoutParam` can only hold
  // one value.
  const isExplicitRoadmap = layoutParam === "roadmap";
  const isImplicitRoadmapDefault = layoutParam === null;
  const rawRoadmapRoots = params.getAll("roadmapRoot");
  if (isExplicitRoadmap || (isImplicitRoadmapDefault && rawRoadmapRoots.length > 0)) {
    const validRoots: string[] = [];
    for (const raw of rawRoadmapRoots) {
      const id = stripWorkPrefix(raw);
      const reason = validators.checkWorkId(id);
      if (reason === null) validRoots.push(id);
      else omitted.push({ value: raw, reason, source: "roadmapRoot" });
    }

    if (validRoots.length === 1) {
      return { kind: "redirect", to: buildRoadmapRedirectPath(validRoots[0], filters, focus), omitted };
    }
    if (validRoots.length > 1) {
      return {
        kind: "chooser",
        chooserFor: "roadmapRoots",
        candidateRoots: validRoots,
        notice: null,
        partial: partial(),
        omitted,
      };
    }
    // Zero valid roots — either none were provided at all (an explicit
    // `layout=roadmap` with no `roadmapRoot`) or every provided value was
    // rejected: "Invalid or absent roadmap root in an explicit legacy
    // Roadmap URL -> Open the 2D Roadmap chooser with an explanatory
    // notice."
    return {
      kind: "chooser",
      chooserFor: "roadmapRoots",
      candidateRoots: [],
      notice: NO_VALID_ROADMAP_ROOT_NOTICE,
      partial: partial(),
      omitted,
    };
  }

  // --- Repeated `pinnedWork` (only reached when the roadmap branch above
  // didn't already claim this URL).
  const rawPinnedWork = params.getAll("pinnedWork");
  if (rawPinnedWork.length > 0) {
    const validPinned: string[] = [];
    for (const raw of rawPinnedWork) {
      const id = stripWorkPrefix(raw);
      const reason = validators.checkWorkId(id);
      if (reason === null) validPinned.push(id);
      else omitted.push({ value: raw, reason, source: "pinnedWork" });
    }

    if (validPinned.length === 1) {
      const state: GraphUrlState = {
        context: { kind: "work", id: validPinned[0] },
        view: preferredView,
        selectedId,
        activeLayers,
        filters,
        expansionTrail: [],
        focus,
      };
      return { kind: "state", state, omitted };
    }
    if (validPinned.length > 1) {
      return {
        kind: "chooser",
        chooserFor: "pinnedWork",
        candidateRoots: validPinned,
        notice: null,
        partial: partial(),
        omitted,
      };
    }
    // Every `pinnedWork` value was invalid — not a distinct compat-table
    // row, so this falls through to the general context-chooser landing
    // below with the omissions already recorded (same treatment as "no
    // anchor could be resolved at all").
  }

  // --- Nothing anchored a specific context: a genuinely bare `/graph`, or
  // a URL carrying only filters/focus/selection/an unresolvable
  // `pinnedWork` set. Charter: "A bare new `/graph` intentionally opens
  // the context chooser."
  return {
    kind: "chooser",
    chooserFor: "context",
    candidateRoots: [],
    notice: null,
    partial: partial(),
    omitted,
  };
}
