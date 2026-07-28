"use client";

/**
 * The Knowledge Map composition root (charter §10/§15 Stage 3, spec
 * §1.1's `KnowledgeMapWorkspace.tsx` row). Owns `useGraphUrlState`,
 * mounts `ContextChooser` when no context is established, or the full
 * Toolbar + FilterRail + Scene + InspectorDrawer + ContextTray workspace
 * once one is.
 *
 * ## Scope note for this step ("views-fallback")
 *
 * This is a real, working implementation of the URL/context/toolbar/rail/
 * inspector/tray/disclosure machinery, plus the 2D/List views and the
 * charter §14 WebGL-unavailable/context-loss fallback boundary. One thing
 * remains genuinely out of this step's scope, carried over honestly from
 * the prior step rather than silently pretended done:
 *
 * Only a "work" context has real, fully-expanded graph data (via the
 * existing `/api/works/[workId]/graph` endpoint + `./adapter.ts`).
 * "passage"/"question"/"claim"/"debate" contexts resolve to a real,
 * correctly-labeled ROOT node (`./resolveContextRoot.ts`) with zero
 * synthesized neighbors — spec §2.2's full context-scoped neighborhood
 * synthesis (a claim's judged relationships, a debate's member claims,
 * etc.) is out of this step's scope, and the workspace says so in the
 * empty state rather than showing a misleadingly bare canvas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { toDisplayNodeId, type DeviceClass, type GraphUrlContext, type ReconstructionValidators } from "@ice/graph-display";
import { adaptGraphPayload, type KnowledgeMapDisplayLink, type KnowledgeMapDisplayNode } from "./adapter";
import { computeDisclosure } from "./disclosurePipeline";
import { computeVisibleNodeIds } from "./attributeVisibility";
import { graphFiltersFromUrlFilters, urlFiltersFromGraphFilters } from "./graphFiltersUrlAdapter";
import { PERMISSIVE_RECONSTRUCTION_VALIDATORS, useGraphUrlState } from "./useGraphUrlState";
import { useLegacyGraphUrlRedirect } from "./useLegacyGraphUrlRedirect";
import { browserStorage, recordRecentContext, readRecentContexts, type RecentContextEntry } from "./recentContexts";
import { getPinnedPositions, pinPosition, resetLayout as resetArrangeLayout, unpinPosition, type PinnedPositionsByNode } from "./arrangeStore";
import { claimRoot, debateRoot, passageRoot, questionRoot } from "./resolveContextRoot";
import { topmostTransientUiKind } from "./escapeStack";
import { useDialogEscape } from "@/components/primitives/useDialogEscape";
import { KnowledgeMapToolbar } from "./KnowledgeMapToolbar";
import { FilterRail } from "./FilterRail";
import { InspectorDrawer } from "./InspectorDrawer";
import { ContextTray } from "./ContextTray";
import { ContextChooser } from "./ContextChooser";
import type { KnowledgeMapSceneApi, KnowledgeMapSceneProps } from "./KnowledgeMapScene";
import { KnowledgeMapFallbackBoundary, type FallbackState } from "./KnowledgeMapFallbackBoundary";
import { KnowledgeMapListView } from "./KnowledgeMapListView";
import { KnowledgeMap2DView } from "./KnowledgeMap2DView";
import type { CredibilityRingInput } from "./nodeVisuals";
import { CREDIBILITY_DIMENSIONS, type CredibilityDimension, type GraphNode, type GraphPayload } from "../graph/types";

// `react-force-graph-3d`/`three` read `window` at MODULE-EVALUATION time
// (not just render time), so importing `KnowledgeMapScene` as a plain
// static import — even one this file never actually renders on the server
// (e.g. because `KnowledgeMapFallbackBoundary` is showing the fallback) —
// still crashes Next's SSR pass, because ES module imports are evaluated
// eagerly at load time regardless of whether the component is ever
// rendered. `next/dynamic(..., { ssr: false })` is the one mechanism that
// defers the MODULE IMPORT itself to the client, not just the render —
// matching this project's own existing documented pattern ("3D graph via
// `react-force-graph-3d`, dynamically imported (`ssr: false`)", see
// `docs/PROJECT-LOG.md`'s Design Decisions), which this rebuild's scene
// mount had not yet been wired through until this step surfaced the SSR
// crash via the new fallback-boundary work.
const KnowledgeMapScene = dynamic<KnowledgeMapSceneProps>(() => import("./KnowledgeMapScene").then((m) => m.KnowledgeMapScene), { ssr: false });

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

  // Only a "work" context has a real owning work id (spec §2/§3's own
  // scoping rule for reading-status/mark-uncertain actions) — a passage/
  // question/claim/debate single-root context never guesses one.
  const rootWorkId = context?.context.kind === "work" ? context.context.id : null;

  const topologyNodeById = useMemo(() => new Map(topologyNodes.map((n) => [String(n.id), n] as const)), [topologyNodes]);

  const { incomingLinks, outgoingLinks } = useMemo(() => {
    if (!selectedNode) return { incomingLinks: [], outgoingLinks: [] };
    const id = String(selectedNode.id);
    const incoming: { link: KnowledgeMapDisplayLink; otherNode: KnowledgeMapDisplayNode | null }[] = [];
    const outgoing: { link: KnowledgeMapDisplayLink; otherNode: KnowledgeMapDisplayNode | null }[] = [];
    for (const l of topologyLinks) {
      if (l.target === id) incoming.push({ link: l, otherNode: topologyNodeById.get(l.source) ?? null });
      if (l.source === id) outgoing.push({ link: l, otherNode: topologyNodeById.get(l.target) ?? null });
    }
    return { incomingLinks: incoming, outgoingLinks: outgoing };
  }, [selectedNode, topologyLinks, topologyNodeById]);

  // --- Charter §14 fallback (spec §5): whether the 3D scene is actually
  // mounted right now, reported by `KnowledgeMapFallbackBoundary` — used
  // to disable the toolbar's camera-only controls (Focus/Fit/Home) while
  // showing the semantic view instead, so those controls never look
  // interactive while silently doing nothing. `lastNonThreeDView` tracks
  // which of 2D/List the user was last actually looking at (defaulting to
  // List, spec §5.1's "never silently forcing 2D over List or vice versa")
  // so the fallback banner shows whichever view they'd expect, even though
  // the URL's own `view` stays "3d" (the DESIRED view) throughout a
  // fallback episode.
  const [sceneActive, setSceneActive] = useState(true);
  const [lastNonThreeDView, setLastNonThreeDView] = useState<"2d" | "list">("list");
  useEffect(() => {
    if (context?.view === "2d" || context?.view === "list") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastNonThreeDView(context.view);
    }
  }, [context?.view]);

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
      if (!context?.selectedId || context.view !== "3d" || !sceneActive) {
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
  }, [context, topologyNodes, sceneActive]);

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

  // --- The one shared filtered selection (spec §2's data-flow diagram):
  // 2D view, List view, and the WebGL-fallback's own List/2D substitute
  // all receive EXACTLY this bundle — never a second, independently
  // filtered read of the same data. ---
  const sharedViewProps = useMemo(
    () => ({
      nodes: topologyNodes,
      links: topologyLinks,
      visibleNodeIds: attributeVisibleIds,
      rootNodeId: effectiveContextData?.rootId ?? null,
      selectedId: context?.selectedId ?? null,
      onSelect: handleSelect,
    }),
    [topologyNodes, topologyLinks, attributeVisibleIds, effectiveContextData, context?.selectedId, handleSelect],
  );

  // --- Transient UI (filters rail / help / secondary Arrange state) ---
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [arrangeMode, setArrangeMode] = useState(false);
  const [showLayerGuide, setShowLayerGuide] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);

  // --- Arrange mode's own pinned-position state (charter §11 "Arrange
  // mode" / spec §4.3). `arrangeStore.ts` is the durable (localStorage)
  // source of truth; this is the in-session mirror so the toolbar's
  // Pin/Unpin controls and the scene's initial layout both see the SAME
  // pins within one render without re-reading localStorage on every
  // keystroke. Reloaded from storage whenever the context itself changes
  // (a fresh `(userId, contextKind, contextId)` triple has its own,
  // independent pin set — arrangeStore.ts's own scoping). ---
  const [pinnedPositions, setPinnedPositions] = useState<PinnedPositionsByNode>({});
  useEffect(() => {
    if (!context) return;
    const storage = browserStorage();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPinnedPositions(storage ? getPinnedPositions(userId, context.context.kind, context.context.id, storage) : {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, context?.context.kind, context?.context.id]);
  const pinnedPositionsMap = useMemo(() => new Map(Object.entries(pinnedPositions)), [pinnedPositions]);

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

  // --- Arrange mode handlers (charter §11/spec §4.3). All three read/write
  // BOTH the durable store (`arrangeStore.ts`, so a pin survives a fresh
  // mount) and this session's live scene (`sceneApiRef`, so a pin/unpin
  // takes visible effect immediately without waiting for a remount) — the
  // two must never drift, so every handler below touches both in the same
  // call rather than relying on a later effect to reconcile them.
  //
  // `activeContext` re-captures `context` as a fresh `const` right after
  // the `!context.contextValid` early-return above — TypeScript's
  // control-flow narrowing of `context` (non-null, `contextValid`) does not
  // propagate into the separately-declared handler functions below, even
  // though they're recreated (and so re-close over the correctly-narrowed
  // value) every render; this is a closure-narrowing limitation, not a
  // real possible-null case. ---
  const activeContext = context;
  function withStorage(fn: (storage: import("./arrangeStore").StorageLike) => void) {
    const storage = browserStorage();
    if (storage) fn(storage);
  }

  function handleArrangeNodeDragEnd(nodeId: string, position: { x: number; y: number }) {
    withStorage((storage) => setPinnedPositions(pinPosition(userId, activeContext.context.kind, activeContext.context.id, nodeId, position, storage)));
  }

  function handlePinSelected() {
    const selectedId = activeContext.selectedId;
    if (!selectedId) return;
    const position = sceneApiRef.current?.getNodePosition(selectedId);
    if (!position) return;
    sceneApiRef.current?.pinNode(selectedId, position);
    withStorage((storage) => setPinnedPositions(pinPosition(userId, activeContext.context.kind, activeContext.context.id, selectedId, position, storage)));
  }

  function handleUnpinSelected() {
    const selectedId = activeContext.selectedId;
    if (!selectedId) return;
    sceneApiRef.current?.unpinNode(selectedId);
    withStorage((storage) => setPinnedPositions(unpinPosition(userId, activeContext.context.kind, activeContext.context.id, selectedId, storage)));
  }

  function handleResetLayout() {
    for (const nodeId of Object.keys(pinnedPositions)) sceneApiRef.current?.unpinNode(nodeId);
    withStorage((storage) => resetArrangeLayout(userId, activeContext.context.kind, activeContext.context.id, storage));
    setPinnedPositions({});
  }

  const isSelectedPinned = Boolean(context.selectedId && pinnedPositions[context.selectedId]);

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
        focusDisabled={!context.selectedId || context.view !== "3d" || !sceneActive}
        onFit={() => sceneApiRef.current?.fit()}
        fitDisabled={context.view !== "3d" || !sceneActive}
        onHome={() => sceneApiRef.current?.home()}
        homeDisabled={context.view !== "3d" || !sceneActive}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((v) => !v)}
        activeFilterCount={activeFilterCount}
        onOpenHelp={() => setHelpOpen(true)}
        arrangeMode={arrangeMode}
        onToggleArrangeMode={() => setArrangeMode((v) => !v)}
        onResetLayout={handleResetLayout}
        isSelectedPinned={isSelectedPinned}
        onPinSelected={handlePinSelected}
        onUnpinSelected={handleUnpinSelected}
        pinUnpinDisabled={!context.selectedId || context.view !== "3d" || !sceneActive}
        showLayerGuide={showLayerGuide}
        onToggleLayerGuide={() => setShowLayerGuide((v) => !v)}
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
                <KnowledgeMapFallbackBoundary
                  onActiveChange={setSceneActive}
                  renderFallback={(state) => (
                    <SceneFallback state={state} view={lastNonThreeDView} canonicalNodeById={effectiveContextData.canonicalNodeById} {...sharedViewProps} />
                  )}
                >
                  {(sceneHandlers) => (
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
                      onContextLost={sceneHandlers.onContextLost}
                      onContextRestored={sceneHandlers.onContextRestored}
                      onInteractive={sceneHandlers.onInteractive}
                      apiRef={sceneApiRef}
                      arrangeMode={arrangeMode}
                      pinnedPositions={pinnedPositionsMap}
                      onArrangeNodeDragEnd={handleArrangeNodeDragEnd}
                      showLayerGuide={showLayerGuide}
                    />
                  )}
                </KnowledgeMapFallbackBoundary>
              ) : context.view === "2d" ? (
                <KnowledgeMap2DView {...sharedViewProps} />
              ) : (
                <KnowledgeMapListView {...sharedViewProps} canonicalNodeById={effectiveContextData.canonicalNodeById} />
              )}

              <InspectorDrawer
                displayNode={selectedNode}
                canonicalNode={canonicalSelected}
                canonicalState={canonicalSelected?.state ?? null}
                canonicalNodeById={effectiveContextData.canonicalNodeById}
                incomingLinks={incomingLinks}
                outgoingLinks={outgoingLinks}
                rootWorkId={rootWorkId}
                anchorScreenX={anchorScreenX}
                viewportWidth={viewport.width}
                device={viewport.device}
                viewportHeight={viewport.height}
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
                you explore.
              </p>
              <div className="text-[var(--color-text-muted)]">
                <p className="font-medium text-[var(--color-text)]">Depth (front-to-back) is meaningful</p>
                <p>
                  Each of the six bands — Evidence, Intellectual, Claims, Debates, Learning, Research — has a fixed index (&minus;2 through 3).
                  A node&rsquo;s depth is that index multiplied by a fixed gap distance, not a literal, independently-measured world-unit
                  separation — the bands are evenly spaced by construction, not by how &ldquo;close&rdquo; any two items actually are.
                </p>
              </div>
              <div className="text-[var(--color-text-muted)]">
                <p className="font-medium text-[var(--color-text)]">Left-to-right position is a layout aid, not similarity</p>
                <p>
                  X/Y position and the spacing between nodes make the map readable — they are never a measurement of how alike or related two
                  items are. Two nodes drawn near each other are not thereby claimed to be similar.
                </p>
              </div>
              <div className="text-[var(--color-text-muted)]">
                <p className="font-medium text-[var(--color-text)]">This map does not offer algorithmic similarity clusters</p>
                <p>
                  &ldquo;N more…&rdquo; nodes summarize connections not shown yet (use the filter rail&rsquo;s Expand action to reveal them) —
                  they are plain counts of hidden connections, not a claim that the summarized items are alike. If a future version groups
                  nodes exploratively, that grouping will be labeled exploratory and will never be presented as scholarly classification.
                </p>
              </div>
              <p className="text-[var(--color-text-muted)]">
                The toolbar&rsquo;s &ldquo;More…&rdquo; menu has an optional, off-by-default &ldquo;Show layer guide&rdquo; toggle — restrained
                reference planes and a legend naming each band, to make the depth structure easier to read without adding any new data.
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

/**
 * What renders in place of the 3D scene whenever
 * `KnowledgeMapFallbackBoundary` isn't active (spec §5.1/§5.2): a real,
 * honest banner naming which of the three failure modes this is, plus the
 * user's own last-chosen non-3D view (List by default) rendered against
 * the EXACT same `sharedViewProps` bundle the toolbar's explicit 2D/List
 * switch uses — this is the direct fix for the baseline's total-failure
 * finding (charter §14 "the fallback cannot complete the same scholarly
 * task"): real node data, real filters, real selection, real inspector,
 * not an empty error screen.
 */
function SceneFallback({
  state,
  view,
  canonicalNodeById,
  ...viewProps
}: {
  state: FallbackState;
  view: "2d" | "list";
  canonicalNodeById: ReadonlyMap<string, GraphNode>;
} & Parameters<typeof KnowledgeMap2DView>[0]) {
  return (
    <div className="flex h-full flex-col">
      <div role="status" className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
        <span>{state.message}</span>
        {state.retryMeaningful && (
          <button type="button" onClick={state.retry} className="app-control ml-auto rounded border border-[var(--color-border)] px-2 py-1 font-medium text-[var(--color-text)]">
            Retry 3D
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {view === "list" ? <KnowledgeMapListView {...viewProps} canonicalNodeById={canonicalNodeById} /> : <KnowledgeMap2DView {...viewProps} />}
      </div>
    </div>
  );
}
