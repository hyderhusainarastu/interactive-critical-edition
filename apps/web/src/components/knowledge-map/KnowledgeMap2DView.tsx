"use client";

/**
 * The layer-band 2D projection (charter §10 "2D and List", spec §1.1's
 * `KnowledgeMap2DView.tsx` row). Consumes the SAME filtered
 * `DisplayNode[]`/`DisplayLink[]` selection the 3D scene and List view do
 * — an SVG rendering of the identical six-band layer structure the 3D
 * scene's Z-depth uses (`twoDLayout.ts`), so switching between 3D/2D/List
 * never re-derives a second, disagreeing notion of "what's near/far."
 *
 * Deliberately simple relative to the 3D scene: no camera, no physics
 * simulation, no LOD — a WebGL-independent SVG that never depends on
 * anything WebGL can fail at, so it is a genuinely safe fallback surface
 * (and, per charter §14/spec §5, the List view is the one that actually
 * carries the "cannot fail" guarantee; this 2D view is the second,
 * spatially-oriented alternative the toolbar's 3D/2D/List switch offers,
 * not itself load-bearing for the fallback contract).
 */
import { useMemo, useState } from "react";
import { LAYER_ORDER } from "@ice/graph-display";
import { EDGE_VISUALS, KIND_VISUALS } from "./theme";
import { LAYER_LABEL } from "./listLayout";
import { computeLayerColumnPositions, computePositionExtent, type TwoDPosition } from "./twoDLayout";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";

export interface KnowledgeMap2DViewProps {
  nodes: KnowledgeMapDisplayNode[];
  links: KnowledgeMapDisplayLink[];
  visibleNodeIds?: ReadonlySet<string> | null;
  rootNodeId: string | null;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
}

const NODE_RADIUS = 9;
const ROOT_RADIUS = 13;

function endpointId(end: string): string {
  return end;
}

export function KnowledgeMap2DView({ nodes, links, visibleNodeIds, rootNodeId, selectedId, onSelect }: KnowledgeMap2DViewProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const visibleNodes = useMemo(() => (visibleNodeIds ? nodes.filter((n) => visibleNodeIds.has(String(n.id))) : nodes), [nodes, visibleNodeIds]);
  const visibleIdSet = useMemo(() => new Set(visibleNodes.map((n) => String(n.id))), [visibleNodes]);
  const visibleLinks = useMemo(() => links.filter((l) => visibleIdSet.has(endpointId(String(l.source))) && visibleIdSet.has(endpointId(String(l.target)))), [links, visibleIdSet]);

  const positions = useMemo(() => computeLayerColumnPositions(visibleNodes), [visibleNodes]);
  const extent = useMemo(() => computePositionExtent(positions), [positions]);

  return (
    <div data-testid="knowledge-map-2d-view" className="h-full w-full overflow-auto" onClick={() => onSelect(null)}>
      {visibleNodes.length === 0 ? (
        <p className="p-6 text-center text-sm text-[var(--color-text-muted)]">No nodes match the current filters.</p>
      ) : (
        <svg
          role="img"
          aria-label="Knowledge Map, two-dimensional layer view"
          width={extent.width}
          height={extent.height}
          viewBox={`0 0 ${extent.width} ${extent.height}`}
          className="block"
        >
          {/* Layer column headers */}
          {LAYER_ORDER.map((layer, index) => (
            <text key={layer} x={index * 220 + NODE_RADIUS} y={16} className="fill-[var(--color-text-muted)] text-[10px] uppercase tracking-wide">
              {LAYER_LABEL[layer]}
            </text>
          ))}

          {/* Edges */}
          <g>
            {visibleLinks.map((link) => {
              const sourcePos = positions.get(String(link.source));
              const targetPos = positions.get(String(link.target));
              if (!sourcePos || !targetPos) return null;
              const family = EDGE_VISUALS[link.displayFamily];
              const emphasized = selectedId != null && (String(link.source) === selectedId || String(link.target) === selectedId);
              const dimmed = selectedId != null && !emphasized;
              return (
                <line
                  key={String(link.id)}
                  x1={sourcePos.x + NODE_RADIUS}
                  y1={sourcePos.y}
                  x2={targetPos.x + NODE_RADIUS}
                  y2={targetPos.y}
                  stroke={family.color}
                  strokeWidth={family.widthPx}
                  strokeOpacity={dimmed ? 0.12 : link.aiInferred ? 0.5 : 0.7}
                  strokeDasharray={link.aiInferred ? "3 3" : undefined}
                />
              );
            })}
          </g>

          {/* Nodes */}
          <g>
            {visibleNodes.map((node) => {
              const pos: TwoDPosition = positions.get(String(node.id)) ?? { x: 0, y: 0 };
              const id = String(node.id);
              const isRoot = id === rootNodeId;
              const isSelected = id === selectedId;
              const isHovered = id === hoveredId;
              const visual = KIND_VISUALS[node.displayKind];
              const radius = isRoot ? ROOT_RADIUS : NODE_RADIUS;
              return (
                <g
                  key={id}
                  data-graph-node={id}
                  data-selected={isSelected ? "true" : "false"}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(id);
                  }}
                  onMouseEnter={() => setHoveredId(id)}
                  onMouseLeave={() => setHoveredId((current) => (current === id ? null : current))}
                  role="button"
                  tabIndex={0}
                  aria-label={node.label}
                  aria-pressed={isSelected}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(id);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    r={radius}
                    fill={visual.color}
                    fillOpacity={node.unavailableReason ? 0.35 : 0.9}
                    stroke={isSelected ? "var(--color-accent-ink)" : isHovered ? visual.color : "none"}
                    strokeWidth={isSelected ? 3 : 2}
                  />
                  <text x={radius + 4} y={4} className="fill-[var(--color-text)] text-[10px]">
                    {node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}
