"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TIER_LABEL,
  TIER_ORDER,
  type PriorityTier,
  type RelationshipCategory,
  type RoadmapItem,
} from "@ice/roadmap";
import { TIER_COLOR } from "@/components/shared/roadmapPrimitives";
import { CATEGORY_META } from "@/components/shared/annotationMeta";

/**
 * A small, restrained companion visualization for the Reading Roadmap
 * (feature spec §4). Adapts the landing page's hand-rolled 2D-canvas
 * projection (`components/site/InteractiveGraph.tsx`: yaw/pitch/zoom
 * pointer+wheel+keyboard control, radius-based hit-testing, a
 * click-to-inspect detail pane) to real roadmap data — the exact same
 * `RoadmapItem[]` the tier-grouped card list below already renders, so the
 * map and the list can never disagree.
 *
 * This is deliberately NOT the Visualization page's WebGL "Roadmap" layout
 * mode (`components/graph/GraphView.tsx`/`KnowledgeGraph3D.tsx`, Phase
 * 22.8) — that shows the whole cross-library research web; this shows one
 * work's own roadmap, one ring per priority tier, with no physics engine
 * and no per-frame animation loop. See feature spec §4.1 for the full
 * rationale for keeping these two separate.
 *
 * The always-visible, never-collapsed accessible view of the roadmap
 * remains the tier `<ol>` list in `RoadmapView.tsx` — nothing here replaces
 * or gates that. This component's own "Map"/"Table" toggle (§4.7 item 2)
 * only concerns this component's own content.
 */

const NODE_RADIUS: Record<PriorityTier, number> = {
  essential: 7,
  high: 7,
  strongly_recommended: 6,
  interpretive_aid: 6,
  contextual: 5,
  comparative: 5,
  optional: 4,
};
const ROOT_RADIUS = 10;

function ringRadius(tier: PriorityTier): number {
  return 70 + TIER_ORDER.indexOf(tier) * 55;
}

// A small deterministic angular offset per ring so items in different tiers
// don't line up radially into "spokes" — decorative only, never affects
// which ring an item is placed on.
function tierAngleStagger(tier: PriorityTier): number {
  return TIER_ORDER.indexOf(tier) * 0.35;
}

// Deterministic depth hash from bibId, mapped to [-40, 40] — decorative
// depth only (§4.4), never affects ring radius or hit-testing radius.
function hashDepth(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return -40 + ((h % 1000) / 1000) * 80;
}

function formatMinutes(minutes: number): string {
  const hours = Math.round(minutes / 60);
  return hours > 0 ? `~${hours}h` : `~${minutes}m`;
}

interface LayoutNode {
  id: string;
  item: RoadmapItem | null; // null for the root ("this work") node
  x: number;
  y: number;
  z: number;
}

interface ResolvedColors {
  tier: Record<PriorityTier, string>;
  category: Record<RelationshipCategory, string>;
  root: string;
  border: string;
  missing: string;
  text: string;
  textMuted: string;
  labelBg: string;
  labelFg: string;
}

function drawArrowhead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number; r: number },
  color: string,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const tipX = to.x - ux * (to.r + 3);
  const tipY = to.y - uy * (to.r + 3);
  const size = 5;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - ux * size + -uy * size * 0.5, tipY - uy * size + ux * size * 0.5);
  ctx.lineTo(tipX - ux * size - -uy * size * 0.5, tipY - uy * size - ux * size * 0.5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export function RoadmapConstellation({ rootTitle, items }: { rootTitle: string; items: RoadmapItem[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const viewRef = useRef({ yaw: -0.35, pitch: 0.18, zoom: 1.05 });
  const dragRef = useRef({ down: false, moved: false, x: 0, y: 0 });
  const pointsRef = useRef<Array<{ node: LayoutNode; x: number; y: number; r: number }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "table">("map");
  const [colors, setColors] = useState<ResolvedColors | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const layout = useMemo<LayoutNode[]>(() => {
    const byTier = new Map<PriorityTier, RoadmapItem[]>();
    for (const item of items) {
      const list = byTier.get(item.tier) ?? [];
      list.push(item);
      byTier.set(item.tier, list);
    }
    const nodes: LayoutNode[] = [{ id: "root", item: null, x: 0, y: 0, z: 0 }];
    for (const tier of TIER_ORDER) {
      const tierItems = byTier.get(tier);
      if (!tierItems || tierItems.length === 0) continue;
      const radius = ringRadius(tier);
      const stagger = tierAngleStagger(tier);
      tierItems.forEach((item, index) => {
        const angle = (index / tierItems.length) * Math.PI * 2 + stagger;
        nodes.push({
          id: item.bibId,
          item,
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
          z: hashDepth(item.bibId),
        });
      });
    }
    return nodes;
  }, [items]);

  const byId = useMemo(() => new Map(layout.map((n) => [n.id, n])), [layout]);
  const selectedItem = selected && selected !== "root" ? (byId.get(selected)?.item ?? null) : null;
  const isRootSelected = selected === "root";

  // Resolve palette CSS vars to concrete color strings for the 2D canvas
  // context, and re-resolve when the theme toggle flips data-theme — the
  // same runtime-resolution pattern `KnowledgeGraph3D.tsx` already
  // established for the Visualization page's WebGL scene.
  useEffect(() => {
    const resolve = () => {
      const cs = getComputedStyle(document.documentElement);
      const get = (name: string) => cs.getPropertyValue(name).trim() || "#888";
      const tier = {} as Record<PriorityTier, string>;
      for (const t of TIER_ORDER) tier[t] = get(TIER_COLOR[t]);
      const category = {} as Record<RelationshipCategory, string>;
      for (const cat of Object.keys(CATEGORY_META) as RelationshipCategory[]) {
        category[cat] = get(CATEGORY_META[cat].colorVar);
      }
      setColors({
        tier,
        category,
        root: get("--color-accent-ink"),
        border: get("--color-border"),
        missing: get("--color-accent-burgundy"),
        text: get("--color-text"),
        textMuted: get("--color-text-muted"),
        labelBg: get("--color-surface-strong"),
        labelFg: get("--color-surface-strong-fg"),
      });
    };
    resolve();
    const obs = new MutationObserver(resolve);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // §4.6: there is no continuous animation here at all (no particles, no
  // auto-rotate, no force-simulation settling) — the only motion-sensitive
  // behavior is the "View in list below" scroll, gated below. Checked
  // independently of `KnowledgeGraph3D.tsx`'s own `motionAllowed` state,
  // since these are two separate components.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // §4.7: defaults open on desktop, collapsed on narrow viewports — set
  // imperatively post-mount (native `<details>` stays closed for both SSR
  // and the first client render either way) so there is no hydration
  // mismatch to guard against.
  useEffect(() => {
    if (detailsRef.current && window.matchMedia("(min-width: 1024px)").matches) {
      detailsRef.current.open = true;
    }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !colors) return;
    const width = Math.max(280, wrap.clientWidth);
    const height = Math.max(360, wrap.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const { yaw, pitch, zoom } = viewRef.current;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const projected = layout.map((node) => {
      const x1 = node.x * cy - node.z * sy;
      const z1 = node.x * sy + node.z * cy;
      const y1 = node.y * cp - z1 * sp;
      const z2 = node.y * sp + z1 * cp;
      const perspective = (520 / (520 + z2)) * zoom;
      const baseRadius = node.item ? NODE_RADIUS[node.item.tier] : ROOT_RADIUS;
      return {
        node,
        x: width / 2 + x1 * perspective,
        y: height / 2 + y1 * perspective,
        z: z2,
        r: baseRadius * Math.max(0.75, perspective),
      };
    });
    const byProjectedId = new Map(projected.map((p) => [p.node.id, p]));
    const root = byProjectedId.get("root");

    // Edges: one per item, root → item (§4.3).
    if (root) {
      for (const p of projected) {
        if (!p.node.item) continue;
        const color = colors.category[p.node.item.category];
        ctx.beginPath();
        ctx.moveTo(root.x, root.y);
        ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = `${color}70`;
        ctx.lineWidth = selected === p.node.id || selected === "root" ? 1.4 : 0.6;
        ctx.stroke();
        drawArrowhead(ctx, root, p, color);
      }
    }

    projected.sort((a, b) => a.z - b.z);
    for (const p of projected) {
      const isRoot = !p.node.item;
      const isSelected = p.node.id === selected;
      const known = p.node.item?.known ?? false;
      const inLibrary = p.node.item?.inLibrary ?? true;

      ctx.beginPath();
      ctx.arc(p.x, p.y, isSelected ? p.r + 4 : p.r, 0, Math.PI * 2);
      ctx.fillStyle = isRoot ? colors.root : colors.tier[p.node.item!.tier];
      // Known/review-only state: reduced fill opacity, never opacity alone —
      // every item also carries a "✓" prefix on its small sequence caption
      // below (§4.3).
      ctx.globalAlpha = known ? 0.45 : 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.lineWidth = isSelected ? 2 : 1;
      if (isRoot) {
        ctx.setLineDash([]);
        ctx.strokeStyle = colors.text;
      } else if (inLibrary) {
        ctx.setLineDash([]);
        ctx.strokeStyle = colors.border;
      } else {
        ctx.setLineDash([3, 2]);
        ctx.strokeStyle = colors.missing;
      }
      ctx.stroke();
      ctx.setLineDash([]);

      if (!isRoot) {
        const seqLabel = `${known ? "✓" : ""}${p.node.item!.sequence}`;
        ctx.font = "600 8px Inter, sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = colors.textMuted;
        ctx.fillText(seqLabel, p.x, p.y + p.r + 10);
      }

      if (isSelected || isRoot) {
        const label = isRoot ? rootTitle : p.node.item!.title;
        ctx.font = `${isSelected ? "700" : "600"} ${isSelected ? 12 : 10}px Inter, sans-serif`;
        ctx.textAlign = "left";
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = colors.labelBg;
        ctx.fillRect(p.x + p.r + 5, p.y - 10, textWidth + 10, 19);
        ctx.fillStyle = colors.labelFg;
        ctx.fillText(label, p.x + p.r + 10, p.y + 4);
      }
    }

    pointsRef.current = projected.map(({ node, x, y, r }) => ({ node, x, y, r: Math.max(r + 8, 14) }));
  }, [layout, colors, selected, rootTitle]);

  useEffect(() => {
    draw();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(draw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [draw]);

  // Drag = rotate, wheel = zoom — the same math the landing's
  // `InteractiveGraphRendering` already uses (§4.5): presentation logic,
  // not brand-specific, safe to port verbatim.
  function adjustView(yaw: number, pitch: number, zoom = 0) {
    viewRef.current.yaw += yaw;
    viewRef.current.pitch = Math.max(-1.15, Math.min(1.15, viewRef.current.pitch + pitch));
    viewRef.current.zoom = Math.max(0.55, Math.min(1.9, viewRef.current.zoom + zoom));
    draw();
  }

  function focusListItem(bibId: string) {
    const el = document.querySelector(`[data-roadmap-item="${bibId}"]`);
    el?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
  }

  return (
    <details
      ref={detailsRef}
      className="app-reveal mb-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      data-roadmap-constellation
    >
      <summary className="cursor-pointer text-sm font-medium text-[var(--color-text)]">
        Roadmap constellation
      </summary>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        A visual map of this roadmap by priority tier. Drag or use arrow keys to rotate, scroll or use plus and minus
        to zoom, and select any item for details. The table and the list below show the identical set.
      </p>

      <div className="mt-3 flex items-center gap-2">
        <div
          role="group"
          aria-label="Constellation view mode"
          className="flex gap-1 rounded border border-[var(--color-border)] p-0.5 text-xs"
        >
          <button
            type="button"
            aria-pressed={view === "map"}
            onClick={() => setView("map")}
            className={`rounded px-2 py-1 font-semibold uppercase tracking-wide ${
              view === "map"
                ? "bg-[var(--color-surface-strong)] text-[var(--color-surface-strong-fg)]"
                : "text-[var(--color-text-muted)]"
            }`}
          >
            Map
          </button>
          <button
            type="button"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
            className={`rounded px-2 py-1 font-semibold uppercase tracking-wide ${
              view === "table"
                ? "bg-[var(--color-surface-strong)] text-[var(--color-surface-strong-fg)]"
                : "text-[var(--color-text-muted)]"
            }`}
          >
            Table
          </button>
        </div>
      </div>

      {view === "map" ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div
            ref={wrapRef}
            data-roadmap-canvas
            className="relative h-[420px] w-full overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-background)]"
          >
            <canvas
              ref={canvasRef}
              tabIndex={0}
              aria-label="Reading roadmap constellation. Drag or use arrow keys to rotate, scroll or use plus and minus to zoom, and select an item for details."
              onPointerDown={(event) => {
                dragRef.current = { down: true, moved: false, x: event.clientX, y: event.clientY };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag.down) return;
                const dx = event.clientX - drag.x;
                const dy = event.clientY - drag.y;
                if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
                drag.x = event.clientX;
                drag.y = event.clientY;
                adjustView(dx * 0.008, dy * 0.008);
              }}
              onPointerUp={(event) => {
                const drag = dragRef.current;
                drag.down = false;
                if (drag.moved) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const x = event.clientX - rect.left;
                const y = event.clientY - rect.top;
                const hit = [...pointsRef.current].reverse().find((point) => Math.hypot(point.x - x, point.y - y) <= point.r);
                if (hit) setSelected(hit.node.id);
              }}
              onWheel={(event) => {
                event.preventDefault();
                adjustView(0, 0, event.deltaY > 0 ? -0.08 : 0.08);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") adjustView(-0.12, 0);
                else if (event.key === "ArrowRight") adjustView(0.12, 0);
                else if (event.key === "ArrowUp") adjustView(0, -0.12);
                else if (event.key === "ArrowDown") adjustView(0, 0.12);
                else if (event.key === "+" || event.key === "=") adjustView(0, 0, 0.1);
                else if (event.key === "-") adjustView(0, 0, -0.1);
                else if (event.key === "Escape") setSelected(null);
                else return;
                event.preventDefault();
              }}
            />
            <div className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-[var(--color-text-muted)]">
              Drag to rotate · Scroll to zoom · Select any item
            </div>
          </div>
          <aside
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm"
            aria-live="polite"
          >
            {!selected && <p className="text-[var(--color-text-muted)]">Select an item for details.</p>}
            {isRootSelected && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">This work</p>
                <p className="font-medium text-[var(--color-text)]">{rootTitle}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  The primary work at the center of this roadmap.
                </p>
              </>
            )}
            {selectedItem && (
              <>
                <p
                  className="text-xs font-semibold uppercase tracking-wide"
                  style={{ color: `var(${TIER_COLOR[selectedItem.tier]})` }}
                >
                  {TIER_LABEL[selectedItem.tier]}
                </p>
                <p className="font-medium text-[var(--color-text)]">
                  {selectedItem.title}
                  {selectedItem.year ? <span className="font-normal"> ({selectedItem.year})</span> : null}
                </p>
                {selectedItem.authors && <p className="text-xs text-[var(--color-text-muted)]">{selectedItem.authors}</p>}
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {CATEGORY_META[selectedItem.category].glyph} {CATEGORY_META[selectedItem.category].label} —{" "}
                  {CATEGORY_META[selectedItem.category].gloss}
                </p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">{selectedItem.reason}</p>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {Math.round(selectedItem.confidence * 100)}% confidence · {formatMinutes(selectedItem.estimatedMinutes)}
                </p>
                {selectedItem.workId ? (
                  <Link href={`/works/${selectedItem.workId}`} className="app-control mt-2 inline-block text-xs underline">
                    Open work
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="app-control mt-2 text-xs underline"
                    onClick={() => focusListItem(selectedItem.bibId)}
                  >
                    View in list below
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Reading roadmap constellation as a table.</caption>
            <thead>
              <tr className="bg-[var(--color-surface-strong)] text-left text-[var(--color-surface-strong-fg-soft)]">
                <th scope="col" className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide">
                  Sequence
                </th>
                <th scope="col" className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide">
                  Title
                </th>
                <th scope="col" className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide">
                  Tier
                </th>
                <th scope="col" className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide">
                  Relationship
                </th>
                <th scope="col" className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide">
                  Confidence
                </th>
                <th scope="col" className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide">
                  Est. time
                </th>
                <th scope="col" className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.bibId} className="border-b border-[var(--color-border)]">
                  <td className="px-2 py-1.5 text-[var(--color-text-muted)]">{item.sequence}</td>
                  <td className="px-2 py-1.5 text-[var(--color-text)]">
                    {item.title}
                    {item.year ? ` (${item.year})` : ""}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: `var(${TIER_COLOR[item.tier]})` }}>
                    {TIER_LABEL[item.tier]}
                  </td>
                  <td className="px-2 py-1.5 text-[var(--color-text-muted)]">{CATEGORY_META[item.category].label}</td>
                  <td className="px-2 py-1.5 text-[var(--color-text-muted)]">{Math.round(item.confidence * 100)}%</td>
                  <td className="px-2 py-1.5 text-[var(--color-text-muted)]">{formatMinutes(item.estimatedMinutes)}</td>
                  <td className="px-2 py-1.5 text-[var(--color-text-muted)]">
                    {item.known ? "Review only" : item.inLibrary ? (item.status ?? "In library") : "Not acquired"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
