"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/app/PageHeader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STAGE_LABEL, STAGE_ORDER, type CurriculumStage } from "@ice/curriculum";
import { READER_LEVELS, TIER_LABEL, type ReaderLevelFilter } from "@ice/roadmap";
import { GraphAccessibleFallback } from "./GraphAccessibleFallback";
import { CATEGORY_META, categoryMetaFor, confidenceLabel } from "../shared/annotationMeta";
import { RelationBadge } from "../shared/annotationPrimitives";
import {
  CREDIBILITY_BAND_META,
  DEFAULT_GRAPH_FILTERS,
  EDGE_FAMILY_META,
  EDGE_FAMILY_ORDER,
  STATE_META,
  STATE_ORDER,
  TYPE_LABEL,
  credibilityBandFor,
  edgeFamilyFor,
  edgeTypeLabel,
  filterGraphData,
  isDefaultFilters,
  roadmapSubset,
  type GraphData,
  type GraphFilters,
  type GraphLink,
  type GraphNode,
  type NodeType,
  type RoadmapAnnotation,
} from "./types";
import {
  computeFocusEmphasis,
  connectedNodeIds,
  DEFAULT_FOCUS_MODE,
  EMPTY_FOCUS_EMPHASIS,
  FOCUS_MODE_LABEL,
  FOCUS_MODES,
  type FocusMode,
} from "./graphFocus";
import { nextUp, progressByStage } from "./roadmapLayout";

// WebGL + three.js — client only, so pull it in dynamically with SSR off.
const KnowledgeGraph3D = dynamic(() => import("./KnowledgeGraph3D").then((m) => m.KnowledgeGraph3D), {
  ssr: false,
  loading: () => <p className="py-10 text-center text-[var(--color-text-muted)]">Loading 3D view…</p>,
});

const FILTER_KEYS = ["search", "state", "type", "authority", "provider", "relation", "credibilityBand", "associatedWork", "stage"] as const;
const PINNED_WORK_PARAM = "pinnedWork";
// Phase 22.8 (feature plan §2.3): the Roadmap layout mode is the DEFAULT for
// every Visualization page — its absence from the URL (like every other
// FILTER_KEYS default) IS "roadmap", and `?layout=explore` is the one
// non-default value ever written, matching `filtersFromParams`'s own
// "all" idiom rather than inventing a second convention.
const LAYOUT_PARAM = "layout";
const ROADMAP_ROOT_PARAM = "roadmapRoot";
const READER_LEVEL_PARAM = "readerLevel";
// 22.8 verifier finding: `KnowledgeGraph3D`'s `showReadingThread` prop (the
// static, reduced-motion-safe polyline through the reading sequence) was
// implemented but never wired to any control — permanently `false`. URL-synced
// the same way as `layout`/`roadmapRoot` above: off by default (absent from
// the URL), `?readingThread=1` is the one non-default value ever written.
const READING_THREAD_PARAM = "readingThread";
const WORK_PREFIX = "work:";
type LayoutMode = "roadmap" | "explore";

function layoutModeFromParams(params: URLSearchParams): LayoutMode {
  return params.get(LAYOUT_PARAM) === "explore" ? "explore" : "roadmap";
}

function readerLevelFromParams(params: URLSearchParams): ReaderLevelFilter {
  const raw = params.get(READER_LEVEL_PARAM);
  return raw && ((READER_LEVELS as readonly string[]).includes(raw) || raw === "all") ? (raw as ReaderLevelFilter) : "all";
}

const READER_LEVEL_LABEL: Record<ReaderLevelFilter, string> = {
  beginner: "Beginner",
  undergraduate: "Undergraduate",
  advanced: "Advanced",
  research: "Research",
  all: "Show all levels",
};

/**
 * Display-language override for the inspector's roadmap disclosure (feature
 * plan §2.4): the stored `relationship_category` enum value never changes —
 * `ai_inferred` keeps meaning exactly what it always has everywhere else in
 * the app (annotations, roadmap list) — only the STRING shown here, in this
 * one disclosure, is friendlier and carries no "AI" wording (owner
 * directive). Every other category reuses the shared `CATEGORY_META` label
 * so the two surfaces can't drift on wording for the other nine values.
 */
function roadmapCategoryDisplay(category: RoadmapAnnotation["category"]): string {
  if (category === "ai_inferred") return "Inferred connection — uncertain until you verify it by reading";
  return CATEGORY_META[category]?.label ?? category.replace(/_/g, " ");
}

/**
 * Mechanically assembles the inspector's "why this, here" basis line from
 * fields the contract actually carries (feature plan §2.4) — category,
 * confidence, and which selected root(s) reached this node — never a model
 * call and never a fabricated field (no run/date is recorded on
 * `RoadmapAnnotation`, so none is invented here; see `remainingWork`).
 */
function roadmapBasisLine(annotation: RoadmapAnnotation, allNodes: readonly GraphNode[]): string {
  const rootLabels = annotation.rootWorkIds
    .map((id) => allNodes.find((node) => node.id === id)?.label)
    .filter((label): label is string => Boolean(label));
  const rootPart = rootLabels.length > 0 ? ` — found via ${rootLabels.join(", ")}` : "";
  return `Basis: ${roadmapCategoryDisplay(annotation.category)}${rootPart} · confidence ${Math.round(annotation.confidence * 100)}%`;
}
// Phase 21.6 (D-21-2): selection and focus-mode round-trip through the URL
// like the filters above, but are deliberately NOT part of `FILTER_KEYS` —
// "Clear all filters" narrows/widens which nodes exist, selection/focus-mode
// only change how the ALREADY-shown set is emphasized, so clearing filters
// must never also drop a focused selection (mirrors why `pinnedWork` is its
// own param rather than a filter field).
const SELECTED_PARAM = "selected";
const FOCUS_MODE_PARAM = "focusMode";

function filtersFromParams(params: URLSearchParams): GraphFilters {
  const next = { ...DEFAULT_GRAPH_FILTERS };
  for (const key of FILTER_KEYS) {
    const v = params.get(key);
    if (v) next[key] = v as never;
  }
  return next;
}

/**
 * Orchestrates the visualization tab: fetches the per-user graph, offers
 * a persistent 3D scene plus accessible table (plan §36 11.9), a state
 * legend, summary counts, and a click-to-detail panel. The table is never
 * hidden behind WebGL: both panes consume the same filtered data at once.
 *
 * Phase 9.7 (plan §34.4): filters live HERE, not inside either view, and
 * are synced to the URL — so the table and the 3D scene are always showing
 * the exact same filtered node/edge set (one `filterGraphData` call feeds
 * both), and a filtered link is shareable/reloadable.
 */
export function GraphView({ endpoint, backHref, backLabel, enableExpansion = false }: { endpoint: string; backHref: string; backLabel: string; enableExpansion?: boolean }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLink, setSelectedLink] = useState<GraphLink | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<GraphFilters>(() => filtersFromParams(searchParams));
  const [pinnedWorkIds, setPinnedWorkIds] = useState<string[]>(() => searchParams.getAll(PINNED_WORK_PARAM).filter((id) => id.startsWith("work:")));
  // Phase 21.6 (D-21-2): `selectedId` (not a node object) is the real state,
  // initialized synchronously from the URL exactly like `filters`/
  // `pinnedWorkIds` above — no restoring effect is needed, `selected` below
  // is simply derived once `data` arrives. `navAnchorId`/`navIndex` back the
  // prev/next-connected-node keyboard walk (`stepConnectedNode` below): the
  // anchor stays fixed across repeated steps so cycling through one node's
  // connections is stable, and resets to the newly selected id whenever
  // selection changes for any OTHER reason (click, table row, URL restore).
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get(SELECTED_PARAM));
  const [navAnchorId, setNavAnchorId] = useState<string | null>(() => searchParams.get(SELECTED_PARAM));
  const [navIndex, setNavIndex] = useState(-1);
  const [focusMode, setFocusModeState] = useState<FocusMode>(() => {
    const raw = searchParams.get(FOCUS_MODE_PARAM);
    return raw && (FOCUS_MODES as readonly string[]).includes(raw) ? (raw as FocusMode) : DEFAULT_FOCUS_MODE;
  });
  // Phase 22.8: layout mode, the "Roadmap for" root-work selection, and the
  // reader-level narrowing all URL-sync exactly like the state above —
  // initialized synchronously from the URL, never restored via an effect.
  const [layoutMode, setLayoutModeState] = useState<LayoutMode>(() => layoutModeFromParams(searchParams));
  const [roadmapRootIds, setRoadmapRootIds] = useState<string[]>(() =>
    searchParams.getAll(ROADMAP_ROOT_PARAM).filter((id) => id.startsWith(WORK_PREFIX)),
  );
  const [readerLevel, setReaderLevelState] = useState<ReaderLevelFilter>(() => readerLevelFromParams(searchParams));
  const [showReadingThread, setShowReadingThreadState] = useState<boolean>(
    () => searchParams.get(READING_THREAD_PARAM) === "1",
  );
  const graphWorkspaceRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);

  // The internal fetch URL is the one place `layout`/`roadmapRoot`/
  // `readerLevel` actually reach the server — the browser's own address bar
  // only ever shows the non-default values (see `setLayoutMode` etc. below),
  // matching how `filters`'s "all" defaults are never written to the URL
  // either. Explore mode sends no roadmap params at all, so its request is
  // byte-identical to every pre-existing caller of this endpoint.
  const fetchUrl = useMemo(() => {
    if (layoutMode !== "roadmap") return endpoint;
    const params = new URLSearchParams();
    params.set(LAYOUT_PARAM, "roadmap");
    for (const id of roadmapRootIds) params.append(ROADMAP_ROOT_PARAM, id.startsWith(WORK_PREFIX) ? id.slice(WORK_PREFIX.length) : id);
    if (readerLevel !== "all") params.set(READER_LEVEL_PARAM, readerLevel);
    return `${endpoint}?${params.toString()}`;
  }, [endpoint, layoutMode, roadmapRootIds, readerLevel]);

  useEffect(() => {
    let ignore = false;
    fetch(fetchUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load graph");
        return res.json();
      })
      .then((d: GraphData) => {
        if (!ignore) setData(d);
      })
      .catch((e) => {
        if (!ignore) setError(e instanceof Error ? e.message : "Failed to load graph");
      });
    return () => {
      ignore = true;
    };
  }, [fetchUrl]);

  const updateFilter = useCallback(
    (key: keyof GraphFilters, value: string) => {
      const next = { ...filters, [key]: value } as GraphFilters;
      setFilters(next);
      const params = new URLSearchParams(searchParams.toString());
      for (const k of FILTER_KEYS) {
        if (next[k] === "all" || next[k] === "") params.delete(k);
        else params.set(k, next[k]);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filters, pathname, router, searchParams],
  );

  // Phase 21.3: a single control that resets every filter field at once and
  // stays URL-synced, same round-trip pattern as `updateFilter` above.
  // Deliberately does not touch `pinnedWork` — pinning anchors a work in
  // place, it is not itself one of the `FILTER_KEYS` fields being cleared.
  const clearAllFilters = useCallback(() => {
    setFilters(DEFAULT_GRAPH_FILTERS);
    const params = new URLSearchParams(searchParams.toString());
    for (const k of FILTER_KEYS) params.delete(k);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  // Phase 21.6 (D-21-2): the ONE place selection changes for an explicit
  // reason (a click on a node — 3D scene, table row, or the inspector's own
  // "Direct connections" list). Resets the nav anchor/index so a fresh
  // keyboard walk always starts from whatever was just explicitly picked,
  // and round-trips the selection through the URL the same way
  // `updateFilter`/`togglePinnedWork` already do (`selected=<nodeId>`).
  // `node: null` is how focus is cleared (see `clearFocus` below).
  const selectNode = useCallback(
    (node: GraphNode | null) => {
      setSelectedId(node?.id ?? null);
      setSelectedLink(null);
      setNavAnchorId(node?.id ?? null);
      setNavIndex(-1);
      const params = new URLSearchParams(searchParams.toString());
      if (node) params.set(SELECTED_PARAM, node.id);
      else params.delete(SELECTED_PARAM);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const onNodeClick = useCallback((node: GraphNode) => selectNode(node), [selectNode]);

  // A clear route to reset (requirement 1's "clear reset"): both Escape
  // (wired below) and a persistently visible "Clear focus" control call
  // this. Clears the LINK selection too — Escape/the button are a single
  // "stop focusing on anything" action, not two separate ones a user would
  // need to trigger independently.
  const clearFocus = useCallback(() => selectNode(null), [selectNode]);

  const setFocusMode = useCallback(
    (mode: FocusMode) => {
      setFocusModeState(mode);
      const params = new URLSearchParams(searchParams.toString());
      if (mode === DEFAULT_FOCUS_MODE) params.delete(FOCUS_MODE_PARAM);
      else params.set(FOCUS_MODE_PARAM, mode);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement === graphWorkspaceRef.current;
      setIsFullscreen(active);
      if (!active) window.setTimeout(() => fullscreenButtonRef.current?.focus(), 0);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const togglePinnedWork = useCallback((workId: string, checked: boolean) => {
    const next = checked ? [...new Set([...pinnedWorkIds, workId])] : pinnedWorkIds.filter((id) => id !== workId);
    setPinnedWorkIds(next);
    const params = new URLSearchParams(searchParams.toString());
    params.delete(PINNED_WORK_PARAM);
    for (const id of next) params.append(PINNED_WORK_PARAM, id);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, pinnedWorkIds, router, searchParams]);

  // Phase 22.8: the layout-mode toggle. Roadmap is the default (never
  // written to the URL); `?layout=explore` is the one non-default value.
  // Switching AWAY from roadmap also clears the `stage` filter — it has no
  // meaning against an explore-mode payload (no node ever carries a
  // `roadmap` annotation there), and leaving it set would silently hide
  // every non-anchor node the instant explore mode loaded.
  const setLayoutMode = useCallback(
    (mode: LayoutMode) => {
      setLayoutModeState(mode);
      const params = new URLSearchParams(searchParams.toString());
      if (mode === "roadmap") params.delete(LAYOUT_PARAM);
      else params.set(LAYOUT_PARAM, mode);
      if (mode === "explore") {
        params.delete("stage");
        setFilters((prev) => (prev.stage === "all" ? prev : { ...prev, stage: "all" }));
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Phase 22.8: "Roadmap for" root-work selection (feature plan §2.3/§2.4).
  // An EMPTY array is the honest "no override" state — the server already
  // supplies the correct default (work-scoped: that work; global: every
  // uploaded work) when no `roadmapRoot` param is sent at all, so the empty
  // state is never written back as an explicit list of every work id.
  const defaultRoadmapRootIds = useMemo(
    () => (data ? data.nodes.filter((n) => n.type === "work").map((n) => n.id) : []),
    [data],
  );
  const checkedRoadmapRootIds = roadmapRootIds.length > 0 ? roadmapRootIds : defaultRoadmapRootIds;
  const toggleRoadmapRoot = useCallback(
    (workId: string, checked: boolean) => {
      const base = roadmapRootIds.length > 0 ? roadmapRootIds : defaultRoadmapRootIds;
      const next = checked ? [...new Set([...base, workId])] : base.filter((id) => id !== workId);
      setRoadmapRootIds(next);
      const params = new URLSearchParams(searchParams.toString());
      params.delete(ROADMAP_ROOT_PARAM);
      for (const id of next) params.append(ROADMAP_ROOT_PARAM, id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [defaultRoadmapRootIds, pathname, roadmapRootIds, router, searchParams],
  );
  const selectWholeLibrary = useCallback(() => {
    setRoadmapRootIds([]);
    const params = new URLSearchParams(searchParams.toString());
    params.delete(ROADMAP_ROOT_PARAM);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const setReaderLevel = useCallback(
    (level: ReaderLevelFilter) => {
      setReaderLevelState(level);
      const params = new URLSearchParams(searchParams.toString());
      if (level === "all") params.delete(READER_LEVEL_PARAM);
      else params.set(READER_LEVEL_PARAM, level);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Off-by-default reading-thread toggle (22.8 verifier finding): same
  // URL-sync pattern as `setReaderLevel`/`setLayoutMode` above — only the
  // non-default (`true`) state is ever written to the URL.
  const setShowReadingThread = useCallback(
    (value: boolean) => {
      setShowReadingThreadState(value);
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(READING_THREAD_PARAM, "1");
      else params.delete(READING_THREAD_PARAM);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  function toggleFullscreen() {
    const target = graphWorkspaceRef.current;
    if (!target) return;
    if (document.fullscreenElement === target) void document.exitFullscreen();
    else void target.requestFullscreen();
  }

  function exportPng() {
    const canvas = graphWorkspaceRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "palimnote-cross-library-graph.png";
    link.click();
  }

  const filtered = useMemo(() => (data ? filterGraphData(data, filters, pinnedWorkIds) : null), [data, filters, pinnedWorkIds]);

  // Phase 22.8: the ONE shared derivation both views actually render from.
  // In explore mode this is byte-identical to `filtered` (no subsetting) —
  // in roadmap mode it further narrows to annotated nodes plus uploaded-work
  // anchors (feature plan §2.2's `roadmapSubset`), so the 3D scene and the
  // accessible table can never disagree about the roadmap-mode node set
  // either, the same guarantee `filterGraphData` already gives for filters.
  const displayed = useMemo(() => (filtered && layoutMode === "roadmap" ? roadmapSubset(filtered) : filtered), [filtered, layoutMode]);

  // Derived, not stored — `selectedId` (a plain string, URL-synced above) is
  // the real state; `selected` just looks it up in the CURRENTLY displayed
  // set each render, so a filter/mode that scopes the selected node out of
  // view makes `selected` naturally become `null` with no extra bookkeeping.
  const selected = useMemo(
    () => (displayed && selectedId ? displayed.nodes.find((node) => node.id === selectedId) ?? null : null),
    [displayed, selectedId],
  );

  // Phase 21.6 (D-21-2): computed ONCE here, from the shared displayed
  // `GraphData` + `selectedId` + `focusMode` — never inside either child —
  // so the 3D scene and the accessible table can never disagree about which
  // nodes are in focus (`KnowledgeGraph3D` additionally unions this with its
  // own local hover state before rendering; the table has no hover concept
  // and uses this value directly for its `data-emphasis` attribute).
  const focusEmphasis = useMemo(
    () => (displayed ? computeFocusEmphasis(displayed, selectedId, focusMode) : EMPTY_FOCUS_EMPHASIS),
    [displayed, selectedId, focusMode],
  );

  // Prev/next-connected-node keyboard walk: steps through `navAnchorId`'s
  // own one-hop neighbors in the deterministic order `connectedNodeIds`
  // defines, wrapping in either direction. The anchor itself never changes
  // here (only `selectNode` changes it) — repeated presses keep cycling the
  // SAME neighbor list rather than wandering deeper into the graph one hop
  // at a time, which would make "previous" undoing a "next" impossible to
  // reason about. A no-op when the anchor has no connections at all.
  const stepConnectedNode = useCallback(
    (direction: 1 | -1) => {
      if (!displayed || !navAnchorId) return;
      const neighbors = connectedNodeIds(displayed, navAnchorId);
      if (neighbors.length === 0) return;
      const nextIndex = navIndex === -1 ? (direction === 1 ? 0 : neighbors.length - 1) : (navIndex + direction + neighbors.length) % neighbors.length;
      const nextId = neighbors[nextIndex];
      const node = displayed.nodes.find((n) => n.id === nextId);
      if (!node) return;
      setNavIndex(nextIndex);
      setSelectedId(node.id);
      setSelectedLink(null);
      const params = new URLSearchParams(searchParams.toString());
      params.set(SELECTED_PARAM, node.id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [displayed, navAnchorId, navIndex, pathname, router, searchParams],
  );

  // Phase 22.8 (feature plan §2.3/§2.4): reading-sequence stepping, progress
  // strip, and next-up — pure over the same `displayed` dataset the scene
  // and table already share, so these can never disagree with what's
  // actually rendered either. Only meaningful in roadmap mode; all three are
  // simply empty/null in explore mode (no node ever carries `.roadmap`).
  const sequenceOrderedNodes = useMemo(
    () => (displayed ? [...displayed.nodes].filter((n) => n.roadmap != null).sort((a, b) => a.roadmap!.sequence - b.roadmap!.sequence) : []),
    [displayed],
  );
  const stageProgress = useMemo(() => (displayed ? progressByStage(displayed.nodes) : []), [displayed]);
  const nextUpNode = useMemo(() => (displayed ? nextUp(displayed.nodes) : null), [displayed]);
  const currentStage = stageProgress.find((s) => s.total > s.known)?.stage ?? null;
  // "Essential" is a priority TIER (`@ice/roadmap`'s `CATEGORY_TIER`), not a
  // curriculum stage — a prerequisite reader-level chip like "X of Y
  // essential works read" has to count by tier, not by stage column.
  const essentialNodes = useMemo(() => displayed?.nodes.filter((n) => n.roadmap?.tier === "essential") ?? [], [displayed]);
  const essentialTotal = essentialNodes.length;
  const essentialKnown = essentialNodes.filter((n) => n.roadmap!.known).length;

  const stepSequence = useCallback(
    (direction: 1 | -1) => {
      if (sequenceOrderedNodes.length === 0) return;
      const currentIndex = selectedId ? sequenceOrderedNodes.findIndex((n) => n.id === selectedId) : -1;
      const nextIndex =
        currentIndex === -1
          ? (direction === 1 ? 0 : sequenceOrderedNodes.length - 1)
          : (currentIndex + direction + sequenceOrderedNodes.length) % sequenceOrderedNodes.length;
      selectNode(sequenceOrderedNodes[nextIndex]);
    },
    [sequenceOrderedNodes, selectedId, selectNode],
  );

  // Escape clears focus (requirement 1's "clear reset") from anywhere on
  // the page — except while genuinely fullscreen, where Escape is already
  // the browser's own native "exit fullscreen" key and the two behaviors
  // must not race for the same keypress. Focus is never moved to a
  // transient overlay by selection in the first place (the inspector is
  // always-present chrome, not a dialog), so clearing naturally leaves
  // keyboard focus exactly where it already was — nothing to "restore" that
  // was ever taken away.
  // Also skipped while a text input/textarea/select has focus (e.g. the
  // Search filter box): Escape there belongs to the field's own semantics
  // (browsers already let it discard an in-progress edit / a `<select>`
  // close its open dropdown), and this page-level handler must not steal
  // that keypress to clear an unrelated graph selection.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (!selectedId && !selectedLink) return;
      if (document.fullscreenElement) return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const tag = active.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || active.isContentEditable) return;
      }
      clearFocus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selectedId, selectedLink, clearFocus]);

  // Filter option lists come from the FULL data, not the filtered set, so
  // choosing one filter never hides the options for another.
  const relations = useMemo(() => (data ? [...new Set(data.links.map((l) => l.edgeType))].sort() : []), [data]);
  const authorities = useMemo(
    () => (data ? [...new Set(data.nodes.map((n) => n.authority).filter(Boolean) as string[])].sort() : []),
    [data],
  );
  const providers = useMemo(
    () => (data ? [...new Set(data.nodes.flatMap((n) => n.providers?.length ? n.providers : n.provider ? [n.provider] : []))].sort() : []),
    [data],
  );
  const types = useMemo(() => (data ? [...new Set(data.nodes.map((n) => n.type))] : []), [data]);
  const workNodes = useMemo(() => (data ? data.nodes.filter((n) => n.type === "work") : []), [data]);
  const credibilityBands = useMemo(
    () => (data ? [...new Set(data.nodes.map((n) => credibilityBandFor(n.credibilityScore)))].sort() : []),
    [data],
  );
  const directConnections = useMemo(() => {
    if (!displayed || !selected) return [] as { node: GraphNode; link: GraphLink }[];
    const nodesById = new Map(displayed.nodes.map((node) => [node.id, node]));
    return displayed.links.flatMap((link) => {
      const source = typeof link.source === "string" ? link.source : (link.source as { id: string }).id;
      const target = typeof link.target === "string" ? link.target : (link.target as { id: string }).id;
      const otherId = source === selected.id ? target : target === selected.id ? source : null;
      const node = otherId ? nodesById.get(otherId) : null;
      return node ? [{ node, link }] : [];
    });
  }, [displayed, selected]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-1 text-sm text-[var(--color-text-muted)]">
        <Link href={backHref} className="underline">
          ← {backLabel}
        </Link>
      </div>
      <div className="mb-4"><PageHeader title="Visualization" description={`${data?.title ?? "Your library"} · works, sources, concepts, people, and (per-work) the text’s own outline.`} /></div>

      {error && <p className="text-[var(--color-accent-burgundy)]">{error}</p>}
      {!data && !error && <p className="text-[var(--color-text-muted)]">Loading graph…</p>}

      {data && data.nodes.length === 0 && (
        <p className="text-[var(--color-text-muted)]">
          Nothing to graph yet — upload and analyze a work so its references and connections appear here.
        </p>
      )}

      {data && displayed && data.nodes.length > 0 && (
        <>
          {/* Phase 22.8: layout mode toggle — Roadmap is the default view on
              every Visualization page; `?layout=explore` returns to the
              force-directed map (feature plan §2.1/§2.3). */}
          {/* `data-dense-controls`: Phase 23.2 touch-target-audit test hook
              (accessibility-sweep.spec.ts) — this layout-mode/roadmap-scope
              row is compact secondary chrome, not a primary reading/nav
              control; see that spec's docblock for the full rationale. */}
          <div data-dense-controls="graph-layout-toolbar" className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <div role="group" aria-label="Layout" className="flex gap-1">
              <button
                type="button"
                onClick={() => setLayoutMode("roadmap")}
                aria-pressed={layoutMode === "roadmap"}
                className={`app-control rounded border border-[var(--color-border)] px-2 py-1 ${layoutMode === "roadmap" ? "bg-[var(--color-surface)] font-medium" : ""}`}
              >
                Roadmap
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode("explore")}
                aria-pressed={layoutMode === "explore"}
                className={`app-control rounded border border-[var(--color-border)] px-2 py-1 ${layoutMode === "explore" ? "bg-[var(--color-surface)] font-medium" : ""}`}
              >
                Explore
              </button>
            </div>
            {layoutMode === "roadmap" && workNodes.length > 0 && (
              <RoadmapForPopover
                workNodes={workNodes}
                checkedIds={checkedRoadmapRootIds}
                onToggle={toggleRoadmapRoot}
                onWholeLibrary={selectWholeLibrary}
                isWholeLibrary={roadmapRootIds.length === 0}
              />
            )}
            {layoutMode === "roadmap" && (
              <label className="flex items-center gap-1">
                <span className="text-[var(--color-text-muted)]">Reader level</span>
                <select
                  value={readerLevel}
                  onChange={(e) => setReaderLevel(e.target.value as ReaderLevelFilter)}
                  className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                >
                  {(["all", ...READER_LEVELS] as ReaderLevelFilter[]).map((level) => (
                    <option key={level} value={level}>
                      {READER_LEVEL_LABEL[level]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {layoutMode === "roadmap" && (
              <button
                type="button"
                onClick={() => setShowReadingThread(!showReadingThread)}
                aria-pressed={showReadingThread}
                className={`app-control rounded border border-[var(--color-border)] px-2 py-1 ${showReadingThread ? "bg-[var(--color-surface)] font-medium" : ""}`}
              >
                Reading thread
              </button>
            )}
          </div>

          {layoutMode === "roadmap" && stageProgress.some((s) => s.total > 0) && (
            <RoadmapProgressStrip
              stageProgress={stageProgress}
              currentStage={currentStage}
              essentialTotal={essentialTotal}
              essentialKnown={essentialKnown}
              nextUpNode={nextUpNode}
              activeStage={filters.stage}
              onSelectStage={(stage) => updateFilter("stage", stage)}
              onFocusNextUp={() => nextUpNode && selectNode(nextUpNode)}
            />
          )}

          {/* Legend + stats */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {STATE_ORDER.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${STATE_META[s].colorVar})` }} />
                {STATE_META[s].label}
              </span>
            ))}
            <span className="ml-auto text-[var(--color-text-muted)]">
              {data.stats.works} works · {data.stats.references} references · {data.stats.sources} sources · {data.stats.concepts} concepts · {data.stats.people} people ·{" "}
              {data.stats.missing} missing · {data.stats.read} read
            </span>
          </div>
          {/* D-21-11: this landmark's aria-label used to be "Relationship
              color legend", which substring-collided with the "Relation"
              select label, the "3D relationship graph" scene region, and
              the "Accessible relationship browser" disclosure (getByLabel
              matched all four for the single string "Relation"). Renamed
              here and at the two other sites below so every accessible
              name on this page is unambiguous. */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" aria-label="Edge color legend">
            {[...new Set(data.links.map((link) => edgeFamilyFor(link.edgeType, link.category)))]
              .sort((a, b) => EDGE_FAMILY_ORDER.indexOf(a) - EDGE_FAMILY_ORDER.indexOf(b))
              .map((family) => (
                <span key={family} className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
                  <span
                    aria-hidden
                    className="inline-block h-0.5 w-5 rounded-full"
                    style={{ background: `var(${EDGE_FAMILY_META[family].colorVar})` }}
                  />
                  {EDGE_FAMILY_META[family].label}
                </span>
              ))}
          </div>

          {/* Filters — the single source both views render from (plan §34.4 9.7). */}
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-[var(--color-text-muted)]">Search</span>
              <input
                value={filters.search}
                onChange={(event) => updateFilter("search", event.target.value)}
                placeholder="Works, concepts, sources"
                className="w-48 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-1">
              {/* D-21-11: was the bare, ambiguous "Filter" — that substring
                  also matches the new "Clear all filters" button's
                  accessible name below, so this control gets its own
                  specific name (it filters by NodeState/reading status,
                  not by relation, kind, or anything else on this page). */}
              <span className="text-[var(--color-text-muted)]">Reading status</span>
              <select
                value={filters.state}
                onChange={(e) => updateFilter("state", e.target.value)}
                className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
              >
                <option value="all">All ({data.nodes.length})</option>
                {STATE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATE_META[s].label}
                  </option>
                ))}
              </select>
            </label>

            {types.length > 1 && (
              <label className="flex items-center gap-1">
                <span className="text-[var(--color-text-muted)]">Kind</span>
                <select
                  value={filters.type}
                  onChange={(e) => updateFilter("type", e.target.value)}
                  className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                >
                  <option value="all">All</option>
                  {(types as NodeType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {relations.length > 0 && (
              <label className="flex items-center gap-1">
                <span className="text-[var(--color-text-muted)]">Relation</span>
                <select
                  value={filters.relation}
                  onChange={(e) => updateFilter("relation", e.target.value)}
                  className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                >
                  <option value="all">All</option>
                  {relations.map((r) => (
                    <option key={r} value={r}>
                      {r.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {authorities.length > 0 && (
              <label className="flex items-center gap-1">
                <span className="text-[var(--color-text-muted)]">Authority</span>
                <select
                  value={filters.authority}
                  onChange={(e) => updateFilter("authority", e.target.value)}
                  className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                >
                  <option value="all">All</option>
                  {authorities.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {providers.length > 0 && (
              <label className="flex items-center gap-1">
                <span className="text-[var(--color-text-muted)]">Provider</span>
                <select
                  value={filters.provider}
                  onChange={(e) => updateFilter("provider", e.target.value)}
                  className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                >
                  <option value="all">All</option>
                  {providers.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {credibilityBands.length > 0 && (
              <label className="flex items-center gap-1">
                <span className="text-[var(--color-text-muted)]">Credibility</span>
                <select
                  value={filters.credibilityBand}
                  onChange={(e) => updateFilter("credibilityBand", e.target.value)}
                  className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                >
                  <option value="all">All</option>
                  {credibilityBands.map((band) => (
                    <option key={band} value={band}>
                      {CREDIBILITY_BAND_META[band].label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {layoutMode === "roadmap" && (
              <label className="flex items-center gap-1">
                <span className="text-[var(--color-text-muted)]">Stage</span>
                <select
                  value={filters.stage}
                  onChange={(e) => updateFilter("stage", e.target.value)}
                  className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                >
                  <option value="all">All</option>
                  {STAGE_ORDER.map((stage) => (
                    <option key={stage} value={stage}>
                      {STAGE_LABEL[stage]}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {workNodes.length > 1 && (
              <label className="flex items-center gap-1">
                <span className="text-[var(--color-text-muted)]">Associated work</span>
                <select
                  value={filters.associatedWork}
                  onChange={(e) => updateFilter("associatedWork", e.target.value)}
                  className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
                >
                  <option value="all">All</option>
                  {workNodes.map((work) => (
                    <option key={work.id} value={work.id}>
                      {work.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button
              type="button"
              onClick={clearAllFilters}
              disabled={isDefaultFilters(filters)}
              aria-label="Clear all filters"
              className="app-control rounded border border-[var(--color-border)] px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear all filters
            </button>

            <span className="ml-auto text-xs text-[var(--color-text-muted)]">
              {displayed.nodes.length} of {data.nodes.length} shown
            </span>
          </div>

          {workNodes.length > 0 && (
            <fieldset className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" aria-label="Pinned uploaded works">
              <legend className="px-1 text-xs font-medium text-[var(--color-text-muted)]">Pinned uploaded works</legend>
              <p className="mb-2 text-xs text-[var(--color-text-muted)]">Select one or more works to keep them anchored in the graph and table while you filter their surrounding research web.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {workNodes.map((work) => (
                  <label key={work.id} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={pinnedWorkIds.includes(work.id)} onChange={(event) => togglePinnedWork(work.id, event.target.checked)} />
                    <span>{work.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {enableExpansion && <GraphExpansionControls workNodes={workNodes} />}

          {displayed.nodes.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">No nodes match this filter.</p>
          ) : (
            <div className="space-y-4">
              <section
                ref={graphWorkspaceRef}
                className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 ${isFullscreen ? "h-screen w-screen overflow-hidden rounded-none p-4" : ""}`}
                aria-label="3D graph canvas"
                data-graph-stage
                data-reading-thread={showReadingThread ? "on" : "off"}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <p className="text-[var(--color-text-muted)]">Select a labeled node to focus it; drag to orbit and scroll to zoom.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Phase 21.6 (D-21-2): a render-level emphasis mode over
                        the SAME filtered data both views already share —
                        never a second data derivation. "Focus selected" is
                        the default (one-hop neighbors full emphasis, the
                        rest fade); "Expand one hop" widens the emphasized
                        set by one more hop; "Full graph" turns fading off
                        entirely regardless of selection. */}
                    <div role="group" aria-label="Focus mode" className="flex gap-1">
                      {FOCUS_MODES.map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setFocusMode(mode)}
                          aria-pressed={focusMode === mode}
                          className={`app-control rounded border border-[var(--color-border)] px-2 py-1 ${focusMode === mode ? "bg-[var(--color-surface)] font-medium" : ""}`}
                        >
                          {FOCUS_MODE_LABEL[mode]}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={clearFocus}
                      disabled={!selected && !selectedLink}
                      className="app-control rounded border border-[var(--color-border)] px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear focus
                    </button>
                    <button type="button" onClick={() => setResetSignal((value) => value + 1)} className="app-control rounded border border-[var(--color-border)] px-2 py-1">Reset view</button>
                    <button ref={fullscreenButtonRef} type="button" onClick={toggleFullscreen} aria-pressed={isFullscreen} className="app-control rounded border border-[var(--color-border)] px-2 py-1">{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</button>
                    <button type="button" onClick={exportPng} className="app-control rounded border border-[var(--color-border)] px-2 py-1">Export PNG</button>
                  </div>
                </div>
                {layoutMode === "roadmap" && sequenceOrderedNodes.length > 0 && (
                  <div className="mb-2 flex items-center gap-2 text-xs" role="group" aria-label="Reading sequence">
                    <span className="text-[var(--color-text-muted)]">Reading order</span>
                    <button type="button" onClick={() => stepSequence(-1)} className="app-control rounded border border-[var(--color-border)] px-2 py-1">
                      ← Previous
                    </button>
                    <button type="button" onClick={() => stepSequence(1)} className="app-control rounded border border-[var(--color-border)] px-2 py-1">
                      Next →
                    </button>
                  </div>
                )}
                <div className={`${isFullscreen ? "grid h-[calc(100vh-4.5rem)] min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]" : "grid gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]"}`}>
                  <KnowledgeGraph3D
                    data={displayed}
                    onNodeClick={onNodeClick}
                    onLinkClick={setSelectedLink}
                    pinnedWorkIds={pinnedWorkIds}
                    selectedNodeId={selected?.id}
                    emphasis={focusEmphasis}
                    resetSignal={resetSignal}
                    isFullscreen={isFullscreen}
                    layoutMode={layoutMode}
                    nextUpNodeId={nextUpNode?.id ?? null}
                    onStageHeaderClick={(stage) => updateFilter("stage", filters.stage === stage ? "all" : stage)}
                    showReadingThread={showReadingThread}
                  />
                  <GraphInspector selected={selected} selectedLink={selectedLink} connections={directConnections} onSelectNode={onNodeClick} onCloseNode={clearFocus} onCloseLink={() => setSelectedLink(null)} allNodes={data.nodes} />
                </div>
              </section>
              <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3" aria-label="Accessible graph browser">
                <summary className="cursor-pointer text-sm font-medium">Accessible node browser</summary>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">Keyboard-operable table of the same filtered graph data. It is available as an alternative browser without dominating the visual workspace. Use the arrow keys on a focused row to move to its previous/next connected node; Escape clears the current focus.</p>
                <div className="mt-2 overflow-x-auto">
                  <GraphAccessibleFallback
                    data={displayed}
                    selectedNodeId={selected?.id}
                    onNodeClick={onNodeClick}
                    emphasis={focusEmphasis}
                    onNextConnected={() => stepConnectedNode(1)}
                    onPreviousConnected={() => stepConnectedNode(-1)}
                    onClearFocus={clearFocus}
                  />
                </div>
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EvidenceAnchors({ evidence }: { evidence: unknown }) {
  const record = evidence && typeof evidence === "object" ? evidence as { sourceClaims?: { claim?: string; excerpt?: string }[]; targetClaims?: { claim?: string; excerpt?: string }[] } : null;
  if (!record) return null;
  const anchors = [...(record.sourceClaims ?? []), ...(record.targetClaims ?? [])].slice(0, 6);
  if (!anchors.length) return null;
  return <ul className="mt-3 space-y-2 border-l-2 border-[var(--color-border)] pl-3 text-xs text-[var(--color-text-muted)]" aria-label="Grounded claim evidence">
    {anchors.map((anchor, index) => <li key={index}><span className="font-medium text-[var(--color-text)]">{anchor.claim}</span>{anchor.excerpt ? <span> — “{anchor.excerpt}”</span> : null}</li>)}
  </ul>;
}

function GraphInspector({
  selected,
  selectedLink,
  connections,
  onSelectNode,
  onCloseNode,
  onCloseLink,
  allNodes = [],
}: {
  selected: GraphNode | null;
  selectedLink: GraphLink | null;
  connections: { node: GraphNode; link: GraphLink }[];
  onSelectNode: (node: GraphNode) => void;
  onCloseNode: () => void;
  onCloseLink: () => void;
  /** The FULL, unfiltered node set — used only to resolve a roadmap
   *  annotation's `rootWorkIds` back to human-readable work titles for the
   *  "why this, here" basis line (feature plan §2.4); never used to change
   *  which node is selected. */
  allNodes?: readonly GraphNode[];
}) {
  return (
    <aside className="max-h-[520px] overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3" aria-label="Graph inspector" data-graph-inspector>
      {!selected && !selectedLink && <p className="text-sm text-[var(--color-text-muted)]">Select a graph node or a table row to inspect its source, access, and provenance. Select a link for relationship evidence.</p>}
      {selected && (
        <div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-[var(--color-text)]">{selected.label}</p>
              {selected.authors && <p className="text-sm text-[var(--color-text-muted)]">{selected.authors}</p>}
            </div>
            <button type="button" className="app-control text-xs underline" onClick={onCloseNode}>Close</button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            {TYPE_LABEL[selected.type]} · {STATE_META[selected.state].label}{selected.year ? ` · ${selected.year}` : ""}
          </p>
          {selected.authority && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Authority {selected.authority}{selected.credibilityScore != null ? ` · credibility ${Math.round(selected.credibilityScore * 100)}%` : ""}</p>}
          {selected.supplementary && <p className="mt-2 rounded border border-[var(--color-credibility-warning)] px-2 py-1 text-xs text-[var(--color-text-muted)]">Supplementary public material — useful context, not stand-alone factual support.</p>}
          {(selected.providers?.length ?? 0) > 1 && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Providers: {selected.providers!.join(", ")}</p>}
          {selected.sourceTextStatus && (
            <div className="mt-3 rounded border border-[var(--color-border)] p-2 text-xs">
              <p className="font-medium text-[var(--color-text)]">Source access</p>
              <p className="mt-1 text-[var(--color-text-muted)]">{sourceTextLabel(selected.sourceTextStatus, selected.accessStatus)}</p>
              {selected.license && <p className="mt-1 text-[var(--color-text-muted)]">License evidence: {selected.license}</p>}
              {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block underline">open licensed source ↗</a>}
            </div>
          )}
          {(selected.provenances?.length ?? 0) > 0 && <div className="mt-3 text-xs text-[var(--color-text-muted)]"><p className="font-medium text-[var(--color-text)]">Provenance</p><ul className="mt-1 space-y-1">{selected.provenances!.map((provenance) => <li key={`${provenance.runId}:${provenance.provider}`}>{provenance.provider} · inspection depth {provenance.inspectionDepth}{provenance.inspectedAt ? ` · ${new Date(provenance.inspectedAt).toLocaleDateString()}` : ""}</li>)}</ul></div>}
          {selected.destination && (
            <p className="mt-3">
              <Link href={selected.destination} className="text-sm underline">
                {selected.type === "work" ? "Open work" : "View Library entry"}
              </Link>
            </p>
          )}
          {selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm underline">open source record ↗</a>}
          {selected.roadmap && (
            <details className="mt-3 rounded border border-[var(--color-border)] p-2 text-xs" data-graph-roadmap-disclosure>
              <summary className="cursor-pointer font-medium text-[var(--color-text)]">Why this, here</summary>
              <p className="mt-2 text-[var(--color-text-muted)]">
                {selected.roadmap.reason} <span className="text-[var(--color-text-muted)]">({TIER_LABEL[selected.roadmap.tier]})</span>
              </p>
              <p className="mt-2 text-[var(--color-text-muted)]">{roadmapBasisLine(selected.roadmap, allNodes)}</p>
              <p className="mt-2 italic text-[var(--color-text-muted)]">{selected.roadmap.checkpoint}</p>
              {selected.roadmap.estimatedMinutes > 0 && (
                <p className="mt-2 text-[var(--color-text-muted)]">Estimated reading time: {Math.round(selected.roadmap.estimatedMinutes / 60) || 1}h</p>
              )}
            </details>
          )}
          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            <p className="text-xs font-medium text-[var(--color-text)]">Direct connections</p>
            {connections.length === 0 ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">No visible direct connections under the current filters.</p> : <ul className="mt-2 space-y-1.5">{connections.map(({ node, link }) => <li key={`${node.id}:${link.edgeType}`}><button type="button" onClick={() => onSelectNode(node)} className="app-control text-left text-xs underline underline-offset-2"><span className="font-medium">{node.label}</span> · {categoryMetaFor(link.category)?.label ?? edgeTypeLabel(link.edgeType)}</button></li>)}</ul>}
          </div>
        </div>
      )}
      {selectedLink && (() => {
        // D-21-8/D-21-9 fix: an edge that carries a relationship_category
        // (the classification/citation/resource-role/passage-annotation
        // edges D-21-9 populates `category` for) is presented with the
        // SAME glyph + label + qualitative confidence band the annotation
        // sidebars use for that category (`CATEGORY_META`/`confidenceLabel`,
        // via `RelationBadge` — the shared presentation primitive both
        // surfaces now draw from), never a second, diverging label for the
        // same underlying concept. An edge with no category (source-relation,
        // discovery, and structural edges genuinely carry none) keeps the
        // honest, undecorated edge-type-string fallback instead of a
        // fabricated category.
        const meta = categoryMetaFor(selectedLink.category);
        return (
          <div className={selected ? "mt-5 border-t border-[var(--color-border)] pt-4" : ""} data-graph-evidence>
            <div className="flex items-start justify-between gap-2">
              {meta ? (
                <RelationBadge colorVar={meta.colorVar} glyph={meta.glyph} label={meta.label} />
              ) : (
                <p className="font-medium text-[var(--color-text)]">{edgeTypeLabel(selectedLink.edgeType)}</p>
              )}
              <button type="button" className="app-control text-xs underline" onClick={onCloseLink}>Close</button>
            </div>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{selectedLink.explanation ?? "Relationship evidence is recorded with the source relation."}</p>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]" data-graph-link-confidence>
              {meta ? `${confidenceLabel(selectedLink.confidence)} · ${Math.round(selectedLink.confidence * 100)}%` : `Confidence ${Math.round(selectedLink.confidence * 100)}%`}
              {" · "}{selectedLink.directed === false ? "bidirectional" : "directed"}{selectedLink.provenance ? ` · provenance depth ${selectedLink.provenance.depth}` : ""}
            </p>
            {Boolean(selectedLink.evidence) && <EvidenceAnchors evidence={selectedLink.evidence} />}
            {(selectedLink.provenances?.length ?? 0) > 1 && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Merged from {selectedLink.provenances!.length} evidence/provenance records.</p>}
          </div>
        );
      })()}
    </aside>
  );
}

/**
 * "Roadmap for" root-work selection (feature plan §2.3/§2.4): a checkbox
 * popover following the same `.app-control` style and progressive-disclosure
 * precedent as the "Pinned uploaded works" fieldset above, plus a "Whole
 * library" shortcut that clears the explicit selection back to the server's
 * own default (every uploaded work).
 */
function RoadmapForPopover({
  workNodes,
  checkedIds,
  onToggle,
  onWholeLibrary,
  isWholeLibrary,
}: {
  workNodes: GraphNode[];
  checkedIds: readonly string[];
  onToggle: (workId: string, checked: boolean) => void;
  onWholeLibrary: () => void;
  isWholeLibrary: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // D-23-x: brought to the same Escape-to-close + trigger-focus-restoration
  // standard as every other reader-shell/graph disclosure (D-19-18/19/20,
  // WorkPicker's split-view chooser) — this popover previously had
  // aria-expanded/aria-controls but no keyboard dismissal at all.
  function closePopover() {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          closePopover();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="roadmap-for-popover"
        className="app-control rounded border border-[var(--color-border)] px-2 py-1 text-sm"
      >
        Roadmap for {isWholeLibrary ? "whole library" : `${checkedIds.length} work${checkedIds.length === 1 ? "" : "s"}`}
      </button>
      {open && (
        <fieldset
          id="roadmap-for-popover"
          aria-label="Roadmap for"
          className="app-panel-enter absolute z-10 mt-1 w-64 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm shadow-md"
        >
          <legend className="px-1 text-xs font-medium text-[var(--color-text-muted)]">Roadmap for</legend>
          <button type="button" onClick={onWholeLibrary} disabled={isWholeLibrary} className="app-control mb-2 text-xs underline disabled:cursor-not-allowed disabled:opacity-50">
            Whole library
          </button>
          <div className="flex flex-col gap-1.5">
            {workNodes.map((work) => (
              <label key={work.id} className="flex items-center gap-1.5">
                <input type="checkbox" checked={checkedIds.includes(work.id)} onChange={(event) => onToggle(work.id, event.target.checked)} />
                <span>{work.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}

/**
 * The progress strip (feature plan §2.4): per-stage read counts, "X of Y
 * essential works read", "You're in: <stage>", and a "Next up" chip that
 * selects/frames the first not-yet-known item in reading sequence. Pure
 * presentation over values `GraphView` already computed from the one shared
 * displayed dataset — this component derives nothing of its own.
 */
function RoadmapProgressStrip({
  stageProgress,
  currentStage,
  essentialTotal,
  essentialKnown,
  nextUpNode,
  activeStage,
  onSelectStage,
  onFocusNextUp,
}: {
  stageProgress: { stage: CurriculumStage; total: number; known: number }[];
  currentStage: CurriculumStage | null;
  essentialTotal: number;
  essentialKnown: number;
  nextUpNode: GraphNode | null;
  activeStage: CurriculumStage | "all";
  onSelectStage: (stage: CurriculumStage | "all") => void;
  onFocusNextUp: () => void;
}) {
  return (
    <div className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-xs" data-graph-roadmap-progress>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-medium text-[var(--color-text)]">
          {essentialKnown} of {essentialTotal} essential works read
        </span>
        {currentStage && <span className="text-[var(--color-text-muted)]">You&rsquo;re in: {STAGE_LABEL[currentStage]}</span>}
        {nextUpNode && (
          <button type="button" onClick={onFocusNextUp} className="app-control rounded border border-[var(--color-accent-ink)] px-2 py-1 text-[var(--color-accent-ink)]">
            Next up: {nextUpNode.label}
          </button>
        )}
      </div>
      {/* Clickable stage headers (feature plan §2.4): the DOM-accessible
          equivalent of the 3D scene's own floating column headers — both
          drive the SAME `stage` filter, so clicking a header narrows the
          scene, the table, and this strip identically. Clicking the
          already-active stage clears the filter back to "all". */}
      {/* D-21-11 precedent: named without the "Stage" substring so it never
          collides with `getByLabel("Stage")`, which must resolve uniquely
          to the Stage select above. */}
      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Column progress">
        {stageProgress.map(({ stage, total, known }) => (
          <button
            key={stage}
            type="button"
            onClick={() => onSelectStage(activeStage === stage ? "all" : stage)}
            aria-pressed={activeStage === stage}
            disabled={total === 0}
            className={`app-control rounded border border-[var(--color-border)] px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40 ${activeStage === stage ? "bg-[var(--color-background)] font-medium" : ""}`}
          >
            {STAGE_LABEL[stage]} {known}/{total}
          </button>
        ))}
      </div>
    </div>
  );
}

function sourceTextLabel(status: string, accessStatus?: string | null) {
  if (status === "open_access_indexed") return "Open-access source text indexed from license-evidenced metadata.";
  if (status === "open_access_available") return "Open-access source confirmed; its text was not automatically indexed.";
  if (status === "retrieval_failed") return "Open-access source confirmed; automatic retrieval failed, so it remains metadata-only.";
  return accessStatus === "open" ? "Open source record; no eligible source text has been indexed." : "Metadata only — Palimnote did not retrieve source text without license evidence.";
}

interface ExpansionPreview {
  availableCandidates: number;
  hasGroundedClaims: boolean;
  manual: { candidateCount: number; estimatedCostUsd: number; requiresConfirmation: boolean; hardCapUsd: number };
}

function GraphExpansionControls({ workNodes }: { workNodes: GraphNode[] }) {
  const [workId, setWorkId] = useState(workNodes[0]?.id.replace(/^work:/, "") ?? "");
  const [candidates, setCandidates] = useState(20);
  const [preview, setPreview] = useState<ExpansionPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!workId) return;
    let ignore = false;
    fetch(`/api/graph/expansion/preview?workId=${encodeURIComponent(workId)}&candidates=${candidates}`)
      .then(async (response) => response.ok ? response.json() as Promise<ExpansionPreview> : null)
      .then((next) => { if (!ignore) setPreview(next); })
      .catch(() => { if (!ignore) setPreview(null); });
    return () => { ignore = true; };
  }, [workId, candidates]);

  async function expand(confirmEstimatedCost: boolean) {
    const response = await fetch("/api/graph/expansion", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ workId, candidates, confirmEstimatedCost }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body.preview?.manual?.requiresConfirmation) {
      setMessage(`Estimated ${formatUsd(body.preview.manual.estimatedCostUsd)}. Confirm to queue this paid expansion.`);
      return;
    }
    setMessage(response.ok ? "Expansion queued. Grounded relationships appear when the job completes." : (body.error ?? "Could not queue expansion."));
  }

  if (!workId) return null;
  return (
    <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm" data-graph-expansion>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-text-muted)]">Expand from work</span>
          <select value={workId} onChange={(event) => setWorkId(event.target.value)} className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
            {workNodes.map((work) => <option key={work.id} value={work.id.replace(/^work:/, "")}>{work.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-text-muted)]">New candidates</span>
          <input type="number" min={1} max={100} value={candidates} onChange={(event) => setCandidates(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} className="app-control w-24 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1" />
        </label>
        <button type="button" disabled={!preview?.hasGroundedClaims || !preview?.manual.candidateCount} onClick={() => expand(false)} className="app-control rounded bg-[var(--color-accent-ink)] px-3 py-1.5 text-[var(--color-background)] disabled:opacity-50">Queue expansion</button>
        {preview?.manual.requiresConfirmation && <button type="button" onClick={() => expand(true)} className="app-control rounded border border-[var(--color-credibility-warning)] px-3 py-1.5">Confirm {formatUsd(preview.manual.estimatedCostUsd)}</button>}
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        {preview
          ? `${preview.manual.candidateCount} of ${preview.availableCandidates} grounded candidates · estimate ${formatUsd(preview.manual.estimatedCostUsd)} · hard cap ${formatUsd(preview.manual.hardCapUsd)}${preview.manual.requiresConfirmation ? " · confirmation required above $1" : ""}`
          : "Calculating a read-only estimate…"}
      </p>
      {message && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{message}</p>}
    </section>
  );
}

function formatUsd(value: number) {
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}
