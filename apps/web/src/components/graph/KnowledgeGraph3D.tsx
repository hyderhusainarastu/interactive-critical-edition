"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import { STATE_META, type GraphData, type GraphNode, type NodeState, type NodeType } from "./types";

// Relative node size by kind — work is the anchor, concepts next, then
// references, with sections (a per-work outline, often numerous) smallest.
const NODE_SIZE: Record<NodeType, number> = { work: 6, concept: 4, reference: 3, section: 2 };

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
}: {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [colors, setColors] = useState<Record<NodeState, string>>();

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
      setColors(next);
    };
    resolve();
    const obs = new MutationObserver(resolve);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // Clone so the library can annotate nodes with x/y/z without mutating props.
  const graphData = useMemo(
    () => ({ nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) }),
    [data],
  );

  return (
    <div ref={containerRef} className="h-[520px] w-full overflow-hidden rounded-lg border border-[var(--color-border)]">
      {colors && (
        <ForceGraph3D
          graphData={graphData}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          nodeColor={(n: object) => colors[(n as GraphNode).state]}
          nodeLabel={(n: object) => {
            const node = n as GraphNode;
            return `${node.label} — ${STATE_META[node.state].label}`;
          }}
          nodeVal={(n: object) => NODE_SIZE[(n as GraphNode).type]}
          nodeOpacity={0.9}
          linkColor={() => "rgba(120,110,90,0.35)"}
          linkWidth={0.5}
          linkDirectionalParticles={0}
          enableNodeDrag={false}
          showNavInfo={false}
          onNodeClick={(n: object) => onNodeClick(n as GraphNode)}
        />
      )}
    </div>
  );
}
