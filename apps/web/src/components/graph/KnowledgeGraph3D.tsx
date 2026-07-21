"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { type ForceGraphMethods } from "react-force-graph-3d";
import {
  EDGE_FAMILY_META,
  STATE_META,
  TYPE_META,
  edgeFamilyFor,
  type EdgeFamily,
  type GraphData,
  type GraphLink,
  type GraphNode,
  type NodeState,
  type NodeType,
} from "./types";

// Relative node size by kind — work is the anchor, concepts next, then
// references, with sections (a per-work outline, often numerous) smallest.
const NODE_SIZE: Record<NodeType, number> = {
  work: 6,
  reference: 3,
  peer_reviewed_source: 4.5,
  online_source: 3.5,
  concept: 4,
  person: 4,
  section: 2,
};

/** react-force-graph-3d mutates link.source/target from a string id into the
 *  actual node object once the simulation runs — normalize both shapes to a
 *  plain id, matching the same pattern `filterGraphData`/the accessible
 *  table already use for this exact reason. */
function endpointId(end: GraphLink["source"] | GraphLink["target"]): string {
  return typeof end === "string" ? end : (end as { id: string }).id;
}

/**
 * The 3D force-directed knowledge graph (plan §16/§19). Built with
 * react-force-graph-3d, deliberately restrained per the design rules: no
 * forced auto-rotation, damped default controls, node/link colors drawn
 * from the same warm palette tokens as the rest of the app (resolved to
 * concrete values from CSS custom properties so WebGL can use them, and
 * re-resolved when the theme changes). This is an enhancement over the
 * accessible table, never the only way to read the data.
 */
export function KnowledgeGraph3D({
  data,
  onNodeClick,
  onLinkClick,
  pinnedWorkIds = [],
  selectedNodeId,
}: {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  onLinkClick?: (link: GraphLink) => void;
  pinnedWorkIds?: readonly string[];
  selectedNodeId?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Typed loosely: the library's own generic ref shape (wrapping NodeType in
  // NodeObject<...>/LinkObject<...>) doesn't line up cleanly with our plain
  // GraphNode/GraphLink types when passed through JSX inference — cast at
  // the two call sites below instead of fighting the generics here.
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [colors, setColors] = useState<Record<NodeState, string>>();
  const [typeColors, setTypeColors] = useState<Record<NodeType, string>>();
  const [linkColors, setLinkColors] = useState<Record<EdgeFamily, string>>();
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);
  const [motionAllowed, setMotionAllowed] = useState(true);

  // Measure the container so the canvas fills it (react-force-graph-3d
  // otherwise defaults to the full window and overflows the layout).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Resolve palette CSS vars to concrete color strings for WebGL, and
  // re-resolve when the theme toggle flips data-theme.
  useEffect(() => {
    const resolve = () => {
      const cs = getComputedStyle(document.documentElement);
      const next = {} as Record<NodeState, string>;
      for (const state of Object.keys(STATE_META) as NodeState[]) {
        next[state] = cs.getPropertyValue(STATE_META[state].colorVar).trim() || "#888";
      }
      const nextTypes = {} as Record<NodeType, string>;
      for (const type of Object.keys(TYPE_META) as NodeType[]) {
        nextTypes[type] = cs.getPropertyValue(TYPE_META[type].colorVar).trim() || "#888";
      }
      const nextLinks = {} as Record<EdgeFamily, string>;
      for (const family of Object.keys(EDGE_FAMILY_META) as EdgeFamily[]) {
        nextLinks[family] = cs.getPropertyValue(EDGE_FAMILY_META[family].colorVar).trim() || "#888";
      }
      setColors(next);
      setTypeColors(nextTypes);
      setLinkColors(nextLinks);
    };
    resolve();
    const obs = new MutationObserver(resolve);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Decorative motion is an enhancement only: stop particles/camera animation
  // for reduced-motion users, hidden browser tabs, and graphs large enough to
  // make animation compete with reading the relationship data.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionAllowed(!media.matches && document.visibilityState === "visible");
    update();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  // Clone so the library can annotate nodes with x/y/z without mutating props.
  const graphData = useMemo(() => {
    const pinned = data.nodes.filter((node) => pinnedWorkIds.includes(node.id));
    const pinIndex = new Map(pinned.map((node, index) => [node.id, index]));
    return {
      nodes: data.nodes.map((node) => {
        const index = pinIndex.get(node.id);
        // Fixed anchors make a selected uploaded work stay in place as filters
        // change, while the remaining sources form a force-directed web around
        // it. A small ring keeps multi-selection legible rather than stacking.
        if (index == null) return { ...node };
        const angle = (index / Math.max(pinned.length, 1)) * Math.PI * 2;
        return { ...node, fx: Math.cos(angle) * 55, fy: Math.sin(angle) * 55, fz: 0 };
      }),
      links: data.links.map((link) => ({ ...link })),
    };
  }, [data, pinnedWorkIds]);

  // Neighbor adjacency for the hover highlight, built once per data change
  // rather than per hover event.
  const neighborsByNode = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const l of data.links) {
      const s = endpointId(l.source);
      const t = endpointId(l.target);
      (map.get(s) ?? map.set(s, new Set()).get(s)!).add(t);
      (map.get(t) ?? map.set(t, new Set()).get(t)!).add(s);
    }
    return map;
  }, [data.links]);

  const highlightNodeIds = useMemo(() => {
    if (!hoverNode) return null;
    return new Set([hoverNode.id, ...(neighborsByNode.get(hoverNode.id) ?? [])]);
  }, [hoverNode, neighborsByNode]);
  const effectsEnabled = motionAllowed && data.nodes.length <= 140;

  return (
    <div ref={containerRef} className="h-[520px] w-full overflow-hidden rounded-lg border border-[var(--color-border)]" data-graph-canvas data-graph-effects={effectsEnabled ? "active" : "paused"}>
      {colors && typeColors && linkColors && (
        <ForceGraph3D
          ref={fgRef as never}
          graphData={graphData}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          nodeColor={(n: object) => {
            const node = n as GraphNode;
            const base = typeColors[node.type];
            // nodeOpacity is a fixed number, not a per-node accessor, so the
            // hover dim/highlight effect is folded into the color itself —
            // dim non-neighbors toward the background instead.
            if (highlightNodeIds && !highlightNodeIds.has(node.id)) return "rgba(140,130,115,0.25)";
            return base;
          }}
          nodeLabel={(n: object) => {
            const node = n as GraphNode;
            return `${node.label} — ${node.type.replace(/_/g, " ")} · ${STATE_META[node.state].label}`;
          }}
          nodeVal={(n: object) => {
            const node = n as GraphNode;
            return NODE_SIZE[node.type] + (pinnedWorkIds.includes(node.id) ? 2 : 0) + (selectedNodeId === node.id ? 1 : 0);
          }}
          nodeOpacity={0.9}
          linkColor={(l: object) => {
            const link = l as GraphLink;
            const family = edgeFamilyFor(link.edgeType, link.category);
            if (!hoverNode) return linkColors[family];
            const connected = endpointId(link.source) === hoverNode.id || endpointId(link.target) === hoverNode.id;
            return connected ? linkColors[family] : "rgba(120,110,90,0.08)";
          }}
          linkWidth={(l: object) => {
            const link = l as GraphLink;
            if (!hoverNode) return 0.5;
            const connected = endpointId(link.source) === hoverNode.id || endpointId(link.target) === hoverNode.id;
            return connected ? 1.6 : 0.5;
          }}
          linkDirectionalParticles={effectsEnabled ? 2 : 0}
          linkDirectionalParticleWidth={1.2}
          linkDirectionalParticleSpeed={0.004}
          linkDirectionalParticleColor={(l: object) => {
            const link = l as GraphLink;
            return linkColors[edgeFamilyFor(link.edgeType, link.category)];
          }}
          enableNodeDrag={false}
          cooldownTicks={data.nodes.length > 140 ? 35 : 80}
          showNavInfo={false}
          showPointerCursor={() => true}
          onNodeHover={(n: object | null) => setHoverNode(n as GraphNode | null)}
          onNodeClick={(n: object) => {
            const node = n as GraphNode & { x?: number; y?: number; z?: number };
            // Fly the camera toward the clicked node rather than snapping to
            // it, still restrained (a single damped transition, no forced
            // auto-rotation, no repeated motion — plan §19/§35.2).
            const distance = 120;
            const nx = node.x ?? 0;
            const ny = node.y ?? 0;
            const nz = node.z ?? 0;
            const ratio = nz === 0 && nx === 0 && ny === 0 ? 1 : 1 + distance / Math.hypot(nx, ny, nz || 1);
            (fgRef.current as ForceGraphMethods | undefined)?.cameraPosition(
              { x: nx * ratio, y: ny * ratio, z: nz * ratio },
              { x: nx, y: ny, z: nz },
              effectsEnabled ? 700 : 0,
            );
            onNodeClick(node);
          }}
          onLinkClick={(link: object) => onLinkClick?.(link as GraphLink)}
        />
      )}
    </div>
  );
}
