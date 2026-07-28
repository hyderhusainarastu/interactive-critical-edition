"use client";

/**
 * The Knowledge Map composition root (charter §10/§15 Stage 3, spec
 * §1.1's `KnowledgeMapWorkspace.tsx` row). Owns `useGraphUrlState`,
 * mounts `ContextChooser` when no context is established, or the full
 * Toolbar + FilterRail + Scene + InspectorDrawer + ContextTray workspace
 * once one is.
 *
 * ## Scope note for this step ("workspace-chooser-url")
 *
 * This is a real, working implementation of the URL/context/toolbar/rail/
 * inspector/tray/disclosure machinery, but it is honest about three
 * things this step does NOT cover, rather than silently pretending they
 * work:
 *
 * 1. Only a "work" context has real, fully-expanded graph data (via the
 *    existing `/api/works/[workId]/graph` endpoint + `./adapter.ts`).
 *    "passage"/"question"/"claim"/"debate" contexts resolve to a real,
 *    correctly-labeled ROOT node (`./resolveContextRoot.ts`) with zero
 *    synthesized neighbors — spec §2.2's full context-scoped neighborhood
 *    synthesis (a claim's judged relationships, a debate's member claims,
 *    etc.) is out of this step's scope, and the workspace says so in the
 *    empty state rather than showing a misleadingly bare canvas.
 * 2. `2d`/`list` views are not built in this step (spec §1.1's
 *    `KnowledgeMap2DView.tsx`/`KnowledgeMapListView.tsx` rows) — the
 *    toolbar's view switch is real and round-trips through the URL, but
 *    selecting `2D`/`List` shows an honest placeholder rather than an
 *    unbuilt view.
 * 3. The inspector's full §3 scholarly-action map (verify/dispute/edit/
 *    etc.) is not wired — see `InspectorDrawer.tsx`'s own scope note.
 *    The charter §14 WebGL-unavailable/context-loss fallback boundary
 *    (`KnowledgeMapFallbackBoundary.tsx`) is also not built here; a
 *    minimal React error boundary wraps the scene mount instead so a
 *    scene-mount crash doesn't take the whole workspace down with it.
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toDisplayNodeId, type DeviceClass, type GraphUrlContext, type ReconstructionValidators } from "@ice/graph-display";
import { adaptGraphPayload, type KnowledgeMapDisplayNode } from "./adapter";
import { computeDisclosure } from "./disclosurePipeline";
import { computeVisibleNodeIds } from "./attributeVisibility";
import { graphFiltersFromUrlFilters, urlFiltersFromGraphFilters } from "./graphFiltersUrlAdapter";
import { PERMISSIVE_RECONSTRUCTION_VALIDATORS, useGraphUrlState } from "./useGraphUrlState";
import { useLegacyGraphUrlRedirect } from "./useLegacyGraphUrlRedirect";
import { browserStorage, recordRecentContext, readRecentContexts, type RecentContextEntry } from "./recentContexts";
import { resetLayout as resetArrangeLayout } from "./arrangeStore";
import { claimRoot, debateRoot, passageRoot, questionRoot } from "./resolveContextRoot";
import { topmostTransientUiKind } from "./escapeStack";
import { useDialogEscape } from "@/components/primitives/useDialogEscape";
import { KnowledgeMapToolbar } from "./KnowledgeMapToolbar";
import { FilterRail } from "./FilterRail";
import { InspectorDrawer } from "./InspectorDrawer";
import { ContextTray } from "./ContextTray";
import { ContextChooser } from "./ContextChooser";
import { KnowledgeMapScene, type KnowledgeMapSceneApi } from "./KnowledgeMapScene";
import type { CredibilityRingInput } from "./nodeVisuals";
import { CREDIBILITY_DIMENSIONS, type CredibilityDimension, type GraphNode, type GraphPayload } from "../graph/types";

const MOBILE_WIDTH_BREAKPOINT = 640;

/** A trail entry's aggregate node no longer exists once it's been
 *  successfully expanded (only currently-HIDDEN groups produce an
 *  aggregate) — so the breadcrumb can't just look the label up fresh
 *  every render. Aggregate ids are always the deterministic
 *  `aggregate:<rule>:<kind>` shape `buildAggregateNodes` mints, so the
 *  kind is recovered from the id itself as a readable fallback rather
 *  than showing the raw id string. */
function fallbackExpansionStepLabel(rawId: string): string {
  const parts = rawId.split(":");
  const kind = parts.length >= 3 ? parts.slice(2).join(":") : rawId;
  return `${kind.replace(/_/g, " ")} (expanded)`;
}

function useViewport(): { width: number; height: number; device: DeviceClass } {
  const [state, setState] = useState(() => ({
    width: typeof window === "undefined" ? 1024 : window.innerWidth,
    height: typeof window === "undefined" ? 768 : window.innerHeight,
  }));
  useEffect(() => {
    function onResize() {
      setState({ width: window.innerWidth, height: window.innerHeight });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { ...state, device: state.width < MOBILE_WIDTH_BREAKPOINT ? "mobile" : "desktop" };
}

interface SceneErrorBoundaryProps {
  children: ReactNode;
}
interface SceneErrorBoundaryState {
  hasError: boolean;
}

/** Minimal safety net — see this file's own scope note on why the full
 *  charter §14 fallback boundary isn't built in this step. Real React
 *  error boundaries must be classes (no hooks-only equivalent). */
class SceneErrorBoundary extends Component<SceneErrorBoundaryProps, SceneErrorBoundaryState> {
  state: SceneErrorBoundaryState = { hasError: false };
  static getDerivedStateFromError(): SceneErrorBoundaryState {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--color-text-muted)]">
          The 3D view hit an unexpected error. Reload the page to try again.
        </div>
      );
    }
    return this.props.children;
  }
}

type LoadStatus = "loading" | "loaded" | "not-found" | "error";

interface ContextData {
  rootId: string;
  label: string;
  breadcrumb: string;
  nodes: KnowledgeMapDisplayNode[];
  links: ReturnType<typeof adaptGraphPayload>["links"];
  canonicalNodeById: Map<string, GraphNode>;
  structuralIssueCount: number;
  adapterIssueCount: number;
}

async function loadWorkContext(workId: string): Promise<ContextData | "not-found" | "error"> {
  const res = await fetch(`/api/works/${encodeURIComponent(workId)}/graph`);
  if (res.status === 404) return "not-found";
  if (!res.ok) return "error";
  const data: GraphPayload & { title: string } = await res.json();
  const adapted = adaptGraphPayload(data);
  const canonicalNodeById = new Map(data.nodes.map((n) => [n.id, n] as const));
  return {
    rootId: `work:${workId}`,
    label: data.title,
    breadcrumb: "Work",
    nodes: adapted.nodes,
    links: adapted.links,
    canonicalNodeById,
    structuralIssueCount: adapted.structuralDiagnostics.length,
    adapterIssueCount: adapted.adapterDiagnostics.length,
  };
}

async function loadSingleRootContext(context: GraphUrlContext): Promise<ContextData | "not-found" | "error"> {
  let resolved: { node: KnowledgeMapDisplayNode; label: string; breadcrumb: string } | null = null;

  if (context.kind === "passage") {
    const res = await fetch(`/api/passages/recent?id=${encodeURIComponent(context.id)}`);
    if (res.status === 404) return "not-found";
    if (!res.ok) return "error";
    const { passage } = await res.json();
    resolved = passageRoot(passage);
  } else if (context.kind === "question") {
    const res = await fetch(`/api/research/projects/${encodeURIComponent(context.id)}`);
    if (res.status === 404) return "not-found";
    if (!res.ok) return "error";
    const { project } = await res.json();
    resolved = questionRoot(project);
  } else if (context.kind === "claim") {
    const res = await fetch(`/api/research/claims/${encodeURIComponent(context.id)}`);
    if (res.status === 404) return "not-found";
    if (!res.ok) return "error";
    const { claim } = await res.json();
    resolved = claimRoot(claim);
  } else if (context.kind === "debate") {
    const res = await fetch(`/api/research/debates?id=${encodeURIComponent(context.id)}`);
    if (res.status === 404) return "not-found";
    if (!res.ok) return "error";
    const { cluster } = await res.json();
    resolved = debateRoot(cluster);
  }

  if (!resolved) return "error";
  return {
    rootId: String(resolved.node.id),
    label: resolved.label,
    breadcrumb: resolved.breadcrumb,
    nodes: [resolved.node],
    links: [],
    canonicalNodeById: new Map(),
    structuralIssueCount: 0,
    adapterIssueCount: 0,
  };
}

export interface KnowledgeMapWorkspaceProps {
  userId: string;
  /** Pre-selects this context on first load (no explicit `ctxKind` in the
   *  URL and no legacy markers either) — the work-scoped route
   *  (`/works/[workId]/graph`) passes its own work id here so it never
   *  shows the generic 5-tab chooser for a route that is inherently
   *  already scoped to one work. Applied exactly once per mount (a ref
   *  guard), so explicitly opening the chooser afterward (to switch to a
   *  different context) is never immediately overridden back to this. */
  initialContext?: GraphUrlContext;
}

export function KnowledgeMapWorkspace({ userId, initialContext }: KnowledgeMapWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const viewport = useViewport();

  const [ownedWorkIds, setOwnedWorkIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/works")
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: { workId: string }[]) => {
        if (!cancelled) setOwnedWorkIds(new Set(rows.map((r) => r.workId)));
      })
      .catch(() => {
        if (!cancelled) setOwnedWorkIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const legacyValidators = useMemo(
    () => ({
      checkWorkId: (id: string) => (ownedWorkIds === null || ownedWorkIds.has(id) ? null : ("not_found" as const)),
      checkSelectedId: () => null,
    }),
    [ownedWorkIds],
  );
  const legacy = useLegacyGraphUrlRedirect(legacyValidators);

  const reconstructionValidators: ReconstructionValidators = useMemo(
    () => ({
      checkContext: (ctx) => {
        if (ctx.kind === "work" && ownedWorkIds !== null && !ownedWorkIds.has(ctx.id)) return "not_found";
        return null;
      },
      checkExpansionId: () => null, // validated per-entry by computeDisclosure() itself, not here
      checkSelectedId: () => null, // reconciled once real node data loads — see the effect below
    }),
    [ownedWorkIds],
  );
  const urlApi = useGraphUrlState({ validators: ownedWorkIds === null ? PERMISSIVE_RECONSTRUCTION_VALIDATORS : reconstructionValidators });

  // Auto-open `initialContext` exactly once, only for a genuinely bare URL
  // (no ctxKind, and the legacy translator found nothing to anchor either —
  // `chooserFor === "context"` with no notice is its "nothing here" case).
  const hasAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (hasAutoOpenedRef.current) return;
    if (!initialContext) return;
    if (urlApi.raw !== null) return;
    if (legacy && !(legacy.kind === "chooser" && legacy.chooserFor === "context" && legacy.notice === null)) return;
    hasAutoOpenedRef.current = true;
    urlApi.openContext(initialContext, {}, { push: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContext, urlApi.raw, legacy]);

  const context = urlApi.reconstructed;

  // --- Recent contexts (client-only) — a lazy useState initializer, not
  // an effect+setState pair, since the very first render already knows
  // `userId` (a stable prop). Later writes (below) happen inside the data-
  // load effect's own `.then`, which is fine — see that effect's comment. ---
  const [recent, setRecent] = useState<RecentContextEntry[]>(() => {
    const storage = browserStorage();
    return storage ? readRecentContexts(userId, storage) : [];
  });

  // --- Context data load. `contextData` is tagged with the context it was
  // loaded FOR (`forKind`/`forId`) and only ever written from inside the
  // fetch's `.then` — an external-system callback, not the effect body
  // itself — so this effect never calls setState synchronously in its own
  // body. `effectiveContextData` below (not `contextData` directly) is
  // what the rest of this component reads, so a context that's become
  // invalid or has switched to a new id never keeps rendering the PREVIOUS
  // context's stale data while the new one loads. ---
  const [contextData, setContextData] = useState<(ContextData & { forKind: string; forId: string }) | null>(null);
  // Terminal (not-found/error) outcomes only — "loading" vs. "loaded" is
  // DERIVED below (`loadStatus`) from whether `effectiveContextData`
  // matches the current context, rather than tracked as its own piece of
  // state — the only remaining way to represent "loading" as real state
  // would be an explicit `setLoadStatus("loading")` call sitting directly
  // in this effect's body, which is exactly the synchronous-setState-in-
  // effect pattern being avoided throughout this file.
  const [loadOutcome, setLoadOutcome] = useState<{ forKind: string; forId: string; status: "not-found" | "error" } | null>(null);

  useEffect(() => {
    if (!context || !context.contextValid) return;
    let cancelled = false;
    const { kind, id } = context.context;
    const loader = kind === "work" ? loadWorkContext(id) : loadSingleRootContext(context.context);
    loader.then((result) => {
      if (cancelled) return;
      if (result === "not-found" || result === "error") {
        setLoadOutcome({ forKind: kind, forId: id, status: result });
        return;
      }
      setContextData({ ...result, forKind: kind, forId: id });
      setLoadOutcome(null);
      const storage = browserStorage();
      if (storage) {
        setRecent(recordRecentContext(userId, { kind, id, label: result.label, subtitle: result.breadcrumb }, storage));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context?.context.kind, context?.context.id, context?.contextValid]);

  const effectiveContextData = useMemo(() => {
    if (!context || !contextData) return null;
    return contextData.forKind === context.context.kind && contextData.forId === context.context.id ? contextData : null;
  }, [context, contextData]);

  const loadStatus: LoadStatus = useMemo(() => {
    if (!context) return "loading";
    if (loadOutcome && loadOutcome.forKind === context.context.kind && loadOutcome.forId === context.context.id) return loadOutcome.status;
    if (effectiveContextData) return "loaded";
    return "loading";
  }, [context, loadOutcome, effectiveContextData]);

  // --- Selection reconciliation: an id the loaded data doesn't have is
  // cleared rather than left pointing at nothing (charter §9's omission
  // rule, applied once real node data — not just the URL — is known). ---
  useEffect(() => {
    if (!context || !effectiveContextData) return;
    if (context.selectedId && !effectiveContextData.nodes.some((n) => String(n.id) === context.selectedId)) {
      urlApi.setState({ selectedId: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, effectiveContextData]);

  // --- Disclosure (topology) ---
  const disclosure = useMemo(() => {
    if (!effectiveContextData) return null;
    const root = effectiveContextData.nodes.find((n) => String(n.id) === effectiveContextData.rootId) ?? effectiveContextData.nodes[0] ?? null;
    if (!root) return null;
    return computeDisclosure(root, effectiveContextData.nodes, effectiveContextData.links, context?.expansionTrail.map(String) ?? [], viewport.device);
  }, [effectiveContextData, context, viewport.device]);

  const topologyNodes = useMemo(() => {
    if (!effectiveContextData || !disclosure) return [];
    const byId = new Map(effectiveContextData.nodes.map((n) => [String(n.id), n] as const));
    const real = [...disclosure.visibleIds].map((id) => byId.get(id)).filter((n): n is KnowledgeMapDisplayNode => Boolean(n));
    return [...real, ...disclosure.aggregates];
  }, [effectiveContextData, disclosure]);

  const topologyLinks = useMemo(() => {
    if (!effectiveContextData || !disclosure) return [];
    return effectiveContextData.links.filter((l) => disclosure.visibleIds.has(l.source) && disclosure.visibleIds.has(l.target));
  }, [effectiveContextData, disclosure]);

  const filters = useMemo(() => graphFiltersFromUrlFilters(context?.filters ?? {}), [context?.filters]);
  const activeLayers = useMemo(() => context?.activeLayers ?? [], [context?.activeLayers]);

  const attributeVisibleIds = useMemo(() => {
    if (!effectiveContextData) return new Set<string>();
    const withAggregates = computeVisibleNodeIds(topologyNodes, effectiveContextData.canonicalNodeById, effectiveContextData.rootId, filters, activeLayers);
    // Aggregate summary nodes always stay visible regardless of attribute
    // filters — they represent "everything else," not a single attribute
    // value a search/type/state filter could meaningfully match.
    for (const n of disclosure?.aggregates ?? []) withAggregates.add(String(n.id));
    return withAggregates;
  }, [topologyNodes, effectiveContextData, filters, activeLayers, disclosure]);

  const readingNodeIds = useMemo(() => {
    if (!effectiveContextData) return new Set<string>();
    const ids = new Set<string>();
    for (const [id, n] of effectiveContextData.canonicalNodeById) if (n.state === "reading") ids.add(id);
    return ids;
  }, [effectiveContextData]);

  const credibilityByNodeId = useMemo(() => {
    if (!effectiveContextData) return new Map<string, CredibilityRingInput>();
    const map = new Map<string, CredibilityRingInput>();
    for (const [id, n] of effectiveContextData.canonicalNodeById) {
      if (!n.credibility) continue;
      const entry = {} as CredibilityRingInput;
      for (const dim of CREDIBILITY_DIMENSIONS as readonly CredibilityDimension[]) entry[dim] = n.credibility[dim] ?? null;
      map.set(id, entry);
    }
    return map;
  }, [effectiveContextData]);

  const selectedNode = useMemo(() => {
    if (!context?.selectedId) return null;
    return topologyNodes.find((n) => String(n.id) === context.selectedId) ?? null;
  }, [context, topologyNodes]);
  const canonicalSelected = selectedNode ? (effectiveContextData?.canonicalNodeById.get(String(selectedNode.id)) ?? null) : null;

  const { incomingCount, outgoingCount } = useMemo(() => {
    if (!selectedNode) return { incomingCount: 0, outgoingCount: 0 };
    const id = String(selectedNode.id);
    let incoming = 0;
    let outgoing = 0;
    for (const l of topologyLinks) {
      if (l.target === id) incoming += 1;
      if (l.source === id) outgoing += 1;
    }
    return { incomingCount: incoming, outgoingCount: outgoing };
  }, [selectedNode, topologyLinks]);

  // --- Scene imperative API + selection screen-position (inspector side).
  // The screen position comes from the scene's own live imperative ref
  // (`sceneApiRef`), not React state/props — reading it is an "external
  // system" read, so the actual `setAnchorScreenX` call is deferred into a
  // rAF callback rather than called synchronously in the effect body
  // itself (the scene needs a frame to have painted the just-changed
  // selection before `getNodeScreenPosition` has anything meaningful to
  // report, which a rAF also happens to wait for correctly). ---
  const sceneApiRef = useRef<KnowledgeMapSceneApi | null>(null);
  const [anchorScreenX, setAnchorScreenX] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (cancelled) return;
      if (!context?.selectedId || context.view !== "3d") {
        setAnchorScreenX(null);
        return;
      }
      const pos = sceneApiRef.current?.getNodeScreenPosition(context.selectedId) ?? null;
      setAnchorScreenX(pos?.x ?? null);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [context, topologyNodes]);

  const handleSelect = useCallback(
    (nodeId: string | null) => {
      urlApi.setState({ selectedId: nodeId === null ? null : toDisplayNodeId(nodeId) });
    },
    [urlApi],
  );

  const handleExpandAggregate = useCallback(
    (aggregateNodeId: string) => {
      if (!context) return;
      urlApi.setState({ expansionTrail: [...context.expansionTrail, toDisplayNodeId(aggregateNodeId)] });
    },
    [context, urlApi],
  );

  const handleTruncateTrail = useCallback(
    (index: number) => {
      if (!context) return;
      urlApi.setState({ expansionTrail: context.expansionTrail.slice(0, index + 1) });
    },
    [context, urlApi],
  );

  // --- Transient UI (filters rail / help / secondary Arrange state) ---
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [arrangeMode, setArrangeMode] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);

  const openChooser = useCallback(() => {
    router.replace(pathname);
  }, [router, pathname]);

  const handleEscape = useCallback(() => {
    const kind = topmostTransientUiKind({ filtersOpen, helpOpen, inspectorOpen: Boolean(context?.selectedId) });
    if (kind === "filters") {
      setFiltersOpen(false);
      setClearArmed(false);
      return;
    }
    if (kind === "help") {
      setHelpOpen(false);
      setClearArmed(false);
      return;
    }
    if (kind === "inspector") {
      handleSelect(null);
      setClearArmed(false);
      return;
    }
    if (clearArmed) {
      setClearArmed(false);
      openChooser();
    } else {
      setClearArmed(true);
    }
  }, [filtersOpen, helpOpen, context?.selectedId, clearArmed, handleSelect, openChooser]);
  useDialogEscape(true, handleEscape);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.search) n += 1;
    if (filters.state !== "all") n += 1;
    if (filters.type !== "all") n += 1;
    if (filters.authority !== "all") n += 1;
    if (filters.provider !== "all") n += 1;
    if (filters.relation !== "all") n += 1;
    if (filters.credibilityBand !== "all") n += 1;
    if (filters.associatedWork !== "all") n += 1;
    if (activeLayers.length > 0) n += 1;
    return n;
  }, [filters, activeLayers]);

  if (!context) {
    return (
      <ContextChooser
        userId={userId}
        notice={legacy && legacy.kind === "chooser" ? legacy.notice : null}
        candidateWorkIds={legacy && legacy.kind === "chooser" ? legacy.candidateRoots : undefined}
        onSelect={(picked) => urlApi.openContext(picked)}
      />
    );
  }

  if (!context.contextValid) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--color-text-muted)]">
        <p>This context is no longer available to you.</p>
        <button type="button" onClick={openChooser} className="app-control rounded border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text)]">
          Choose a different context
        </button>
      </div>
    );
  }

  return (
    <div className="knowledge-map-workspace flex flex-col" data-testid="knowledge-map-workspace">
      <KnowledgeMapToolbar
        contextLabel={effectiveContextData?.label ?? "Loading…"}
        breadcrumb={effectiveContextData?.breadcrumb}
        onOpenContextChooser={openChooser}
        searchValue={filters.search}
        onSearchChange={(value) => urlApi.setState({ filters: urlFiltersFromGraphFilters({ ...filters, search: value }) })}
        view={context.view}
        onViewChange={(view) => urlApi.setState({ view })}
        onFocus={() => {
          if (context.selectedId) sceneApiRef.current?.focusOnNode(context.selectedId);
        }}
        focusDisabled={!context.selectedId || context.view !== "3d"}
        onFit={() => sceneApiRef.current?.fit()}
        fitDisabled={context.view !== "3d"}
        onHome={() => sceneApiRef.current?.home()}
        homeDisabled={context.view !== "3d"}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        activeFilterCount={activeFilterCount}
        onOpenHelp={() => setHelpOpen(true)}
        arrangeMode={arrangeMode}
        onToggleArrangeMode={() => setArrangeMode((v) => !v)}
        onResetLayout={() => resetArrangeLayout(userId, context.context.kind, context.context.id, browserStorage() ?? { getItem: () => null, setItem: () => {}, removeItem: () => {} })}
        onOrientationPreset={(preset) => sceneApiRef.current?.applyOrientationPreset(preset)}
        diagnostics={{
          structuralIssueCount: effectiveContextData?.structuralIssueCount ?? 0,
          adapterIssueCount: effectiveContextData?.adapterIssueCount ?? 0,
          omitted: [...context.omitted, ...(disclosure?.omittedExpansionIds ?? [])],
        }}
      />

      <div className="relative flex min-h-0 flex-1">
        <FilterRail
          collapsed={!filtersOpen}
          onToggleCollapsed={() => setFiltersOpen((v) => !v)}
          activeLayers={activeLayers}
          onToggleLayer={(layer) => {
            const next = activeLayers.includes(layer) ? activeLayers.filter((l) => l !== layer) : [...activeLayers, layer];
            urlApi.setState({ activeLayers: next });
          }}
          filters={filters}
          onFilterChange={(patch) => urlApi.setState({ filters: urlFiltersFromGraphFilters({ ...filters, ...patch }) })}
          onClearFilters={() => urlApi.setState({ filters: {}, activeLayers: [] })}
          aggregates={(disclosure?.aggregates ?? []).map((node) => ({ node, count: node.projection?.basisIds.length ?? 0 }))}
          onExpandAggregate={handleExpandAggregate}
        />

        <div className="relative min-h-0 min-w-0 flex-1">
          {loadStatus === "loading" && <div className="app-shimmer app-skeleton h-full w-full" role="status" aria-label="Loading context" />}

          {loadStatus === "not-found" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--color-text-muted)]">
              <p>This item couldn&rsquo;t be found, or isn&rsquo;t yours to open.</p>
              <button type="button" onClick={openChooser} className="app-control rounded border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-text)]">
                Choose a different context
              </button>
            </div>
          )}

          {loadStatus === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-[var(--color-text-muted)]">
              <p>Something went wrong loading this context.</p>
            </div>
          )}

          {loadStatus === "loaded" && effectiveContextData && (
            <>
              {effectiveContextData.nodes.length === 1 && (
                <p className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded bg-[var(--color-background)] px-3 py-1 text-xs text-[var(--color-text-muted)] shadow">
                  {effectiveContextData.rootId.startsWith("work:")
                    ? "No connections found yet for this work."
                    : "This context isn't expanded into a full neighborhood yet — showing the item itself."}
                </p>
              )}

              {context.view === "3d" ? (
                <SceneErrorBoundary>
                  <KnowledgeMapScene
                    nodes={topologyNodes}
                    links={topologyLinks}
                    visibleNodeIds={attributeVisibleIds}
                    rootNodeId={effectiveContextData.rootId}
                    selectedId={context.selectedId}
                    readingNodeIds={readingNodeIds}
                    credibilityByNodeId={credibilityByNodeId}
                    onSelect={handleSelect}
                    onFocus={handleSelect}
                    apiRef={sceneApiRef}
                  />
                </SceneErrorBoundary>
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[var(--color-text-muted)]">
                  {context.view === "2d" ? "2D view" : "List view"} isn&rsquo;t built in this workspace yet — switch back to 3D.
                </div>
              )}

              <InspectorDrawer
                displayNode={selectedNode}
                canonicalNode={canonicalSelected}
                canonicalState={canonicalSelected?.state ?? null}
                incomingCount={incomingCount}
                outgoingCount={outgoingCount}
                anchorScreenX={anchorScreenX}
                viewportWidth={viewport.width}
                onClose={() => handleSelect(null)}
              />
            </>
          )}

          {helpOpen && (
            <div
              role="dialog"
              aria-label="Knowledge Map help"
              className="app-reveal absolute inset-4 z-40 flex flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] p-4 text-sm shadow-xl md:inset-auto md:right-4 md:top-4 md:w-96"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[var(--color-text)]">Knowledge Map</h2>
                <button type="button" onClick={() => setHelpOpen(false)} className="app-control rounded px-2 py-1 text-xs" aria-label="Close help">
                  Close
                </button>
              </div>
              <p className="text-[var(--color-text-muted)]">
                The Knowledge Map opens one context at a time — a work, passage, research question, claim, or debate — and grows outward as
                you explore. Depth (front-to-back) is meaningful: evidence sits closest, then intellectual context, claims, debates, learning,
                and research. Left-to-right position and spacing are layout aids only, not a similarity measurement.
              </p>
              <p className="text-[var(--color-text-muted)]">
                &ldquo;N more…&rdquo; nodes summarize connections not shown yet — use the filter rail&rsquo;s Expand action to reveal them.
              </p>
            </div>
          )}
        </div>
      </div>

      <ContextTray
        contextLabel={effectiveContextData?.label ?? "…"}
        expansionTrail={(disclosure ? context.expansionTrail.filter((id) => !disclosure.omittedExpansionIds.some((o) => o.value === String(id))) : []).map((id) => {
          const agg = disclosure?.aggregates.find((a) => String(a.id) === String(id));
          return { id: String(id), label: agg?.label ?? fallbackExpansionStepLabel(String(id)) };
        })}
        onTruncateTrail={handleTruncateTrail}
        recentContexts={recent}
        currentContext={context.context}
        onSelectRecent={(picked) => urlApi.openContext(picked)}
      />
    </div>
  );
}
