"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { STAGE_LABEL } from "@ice/curriculum";
import { TIER_LABEL } from "@ice/roadmap";
import { edgeTypeLabel, STATE_META, TYPE_LABEL, type GraphData, type GraphNode } from "./types";
import { EMPTY_FOCUS_EMPHASIS, emphasisStateForNode, type FocusEmphasis, type NodeEmphasisState } from "./graphFocus";

/**
 * The mandatory non-3D fallback (plan §20): the identical node/edge data
 * as a sortable, fully keyboard- and screen-reader-operable table. Filters
 * live in `GraphView` (plan §34.4 9.7 — the table and the 3D scene must
 * show identical filtered data, so filtering happens once, above both,
 * not independently in each); `data` here is already filtered. Sorting
 * stays local since it's a display concern the 3D scene has no equivalent
 * of, not something the two views need to agree on.
 *
 * Phase 21.6 (D-21-2): `emphasis` is the SAME `FocusEmphasis` value
 * `GraphView` computed once and handed to the 3D scene — this component has
 * no hover concept at all, so its `data-emphasis` attribute is a pure,
 * WebGL-independent proxy for the selection-focus behavior (the 3D canvas's
 * own fade is WebGL material state, not DOM-assertable). Also carries the
 * selection-parity keyboard controls: a focused row's arrow keys walk to
 * its previous/next connected node (`onPreviousConnected`/`onNextConnected`,
 * driven by `GraphView`'s `stepConnectedNode`), and Escape clears focus —
 * matching the same key bindings `GraphView`'s own document-level listener
 * uses, so the behavior is identical whether focus starts inside this table
 * or anywhere else on the page.
 *
 * Phase 22.8 (feature plan §2.3): when ANY node in `data` carries a
 * `roadmap` annotation, the table gains Stage/Priority/Order/Known columns
 * plus a short "Why" summary, and its default sort switches to reading
 * sequence — a display-shape decision, not a data one (still the exact same
 * shared `data` prop, sorted differently). Detected from the data itself
 * (never a separate prop) so this table and `GraphView`'s own `layoutMode`
 * state can never disagree about which shape to render.
 */
type SortKey = "label" | "state" | "type" | "connections" | "sequence";

export function GraphAccessibleFallback({
  data,
  selectedNodeId,
  onNodeClick,
  emphasis = EMPTY_FOCUS_EMPHASIS,
  onNextConnected,
  onPreviousConnected,
  onClearFocus,
}: {
  data: GraphData;
  selectedNodeId?: string | null;
  onNodeClick?: (node: GraphNode) => void;
  emphasis?: FocusEmphasis;
  onNextConnected?: () => void;
  onPreviousConnected?: () => void;
  onClearFocus?: () => void;
}) {
  // Roving-focus support for keyboard nav: when `selectedNodeId` changes
  // WHILE focus is already inside this table (i.e. the change came from a
  // prev/next keypress, or from clicking a different row), move DOM focus
  // to the newly selected row's own button so cycling stays continuous
  // instead of leaving focus behind on a row that's no longer selected.
  // Never steals focus if it changed for a reason unrelated to this table
  // (a 3D-scene click, say) while focus was elsewhere on the page.
  const rowButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!selectedNodeId) return;
    const active = document.activeElement;
    const isRowButtonFocused = active instanceof HTMLButtonElement && [...rowButtonRefs.current.values()].includes(active);
    if (!isRowButtonFocused) return;
    rowButtonRefs.current.get(selectedNodeId)?.focus();
  }, [selectedNodeId]);
  // Phase 22.8: "sequence" is the default sort in roadmap mode, "state" the
  // pre-existing explore-mode default — detected from the data itself (see
  // the module doc comment above) so it can never disagree with `GraphView`.
  const hasRoadmap = useMemo(() => data.nodes.some((n) => n.roadmap != null), [data.nodes]);
  const [sortKey, setSortKey] = useState<SortKey>(() => (hasRoadmap ? "sequence" : "state"));
  const [asc, setAsc] = useState(true);
  // Resets the DEFAULT sort only when the roadmap/explore MODE itself
  // changes (an external layout switch this table has no other way to
  // observe from its own props) — not on every within-mode data refresh,
  // matching the sidebar tab-sync precedent (plan's Design Decisions:
  // "the sidebar's tab-switch-on-marker-click is the one place... that
  // genuinely needs an effect-driven external-prop sync").
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSortKey(hasRoadmap ? "sequence" : "state");
    setAsc(true);
  }, [hasRoadmap]);

  // Connections per node (degree) and a readable "connected to" summary.
  const connections = useMemo(() => {
    const byNode = new Map<string, string[]>();
    const labelById = new Map(data.nodes.map((n) => [n.id, n.label]));
    for (const l of data.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as { id: string }).id;
      const t = typeof l.target === "string" ? l.target : (l.target as { id: string }).id;
      const evidence = l.explanation ? ` — ${l.explanation}` : "";
      // The contract's explicit `directed` flag (plan §21.1): symmetric
      // relations read as "↔ with", never implying a direction they lack.
      if (l.directed === false) {
        byNode.set(s, [...(byNode.get(s) ?? []), `${edgeTypeLabel(l.edgeType)} ↔ ${labelById.get(t) ?? t}${evidence}`]);
        byNode.set(t, [...(byNode.get(t) ?? []), `${edgeTypeLabel(l.edgeType)} ↔ ${labelById.get(s) ?? s}${evidence}`]);
      } else {
        byNode.set(s, [...(byNode.get(s) ?? []), `${edgeTypeLabel(l.edgeType)} → ${labelById.get(t) ?? t}${evidence}`]);
        byNode.set(t, [...(byNode.get(t) ?? []), `← ${edgeTypeLabel(l.edgeType)} from ${labelById.get(s) ?? s}${evidence}`]);
      }
    }
    return byNode;
  }, [data]);

  const rows = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...data.nodes].sort((a, b) => {
      if (sortKey === "connections") {
        return dir * ((connections.get(a.id)?.length ?? 0) - (connections.get(b.id)?.length ?? 0));
      }
      if (sortKey === "sequence") {
        // Un-annotated nodes (uploaded-work anchors in roadmap mode) sort
        // after every annotated one, then by label — there is no reading
        // order for a node the roadmap pipeline never reached.
        const av = a.roadmap?.sequence;
        const bv = b.roadmap?.sequence;
        if (av == null && bv == null) return dir * a.label.localeCompare(b.label);
        if (av == null) return 1;
        if (bv == null) return -1;
        return dir * (av - bv);
      }
      return dir * String(a[sortKey]).localeCompare(String(b[sortKey]));
    });
  }, [data.nodes, sortKey, asc, connections]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(true);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Visualization as a table: each work, reference, concept, or section, its status, and what it connects to.
        </caption>
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left">
            <SortHeader label="Title" active={sortKey === "label"} asc={asc} onClick={() => toggleSort("label")} />
            <SortHeader label="Kind" active={sortKey === "type"} asc={asc} onClick={() => toggleSort("type")} />
            <SortHeader label="Status" active={sortKey === "state"} asc={asc} onClick={() => toggleSort("state")} />
            {hasRoadmap && <th scope="col" className="py-2 pr-4 font-medium">Stage</th>}
            {hasRoadmap && <th scope="col" className="py-2 pr-4 font-medium">Priority</th>}
            {hasRoadmap && (
              <SortHeader label="Order" active={sortKey === "sequence"} asc={asc} onClick={() => toggleSort("sequence")} />
            )}
            {hasRoadmap && <th scope="col" className="py-2 pr-4 font-medium">Known</th>}
            <SortHeader
              label="Connections"
              active={sortKey === "connections"}
              asc={asc}
              onClick={() => toggleSort("connections")}
            />
            {hasRoadmap && <th scope="col" className="py-2 pr-4 font-medium">Why</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <NodeRow
              key={n.id}
              hasRoadmap={hasRoadmap}
              node={n}
              connections={connections.get(n.id) ?? []}
              selected={selectedNodeId === n.id}
              emphasisState={emphasisStateForNode(n.id, selectedNodeId, emphasis)}
              onNodeClick={onNodeClick}
              onNextConnected={onNextConnected}
              onPreviousConnected={onPreviousConnected}
              onClearFocus={onClearFocus}
              buttonRef={(el) => {
                if (el) rowButtonRefs.current.set(n.id, el);
                else rowButtonRefs.current.delete(n.id);
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortHeader({
  label,
  active,
  asc,
  onClick,
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
}) {
  return (
    <th scope="col" className="py-2 pr-4 font-medium" aria-sort={active ? (asc ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={onClick} className="flex items-center gap-1">
        {label}
        <span aria-hidden className="text-[var(--color-text-muted)]">
          {active ? (asc ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

function NodeRow({
  node,
  connections,
  selected,
  emphasisState,
  onNodeClick,
  onNextConnected,
  onPreviousConnected,
  onClearFocus,
  buttonRef,
  hasRoadmap = false,
}: {
  node: GraphData["nodes"][number];
  connections: string[];
  selected: boolean;
  emphasisState: NodeEmphasisState;
  onNodeClick?: (node: GraphNode) => void;
  onNextConnected?: () => void;
  onPreviousConnected?: () => void;
  onClearFocus?: () => void;
  buttonRef?: (element: HTMLButtonElement | null) => void;
  /** Whether the TABLE (not just this row) is showing roadmap columns —
   *  every row must agree, so a node without its own `.roadmap` still
   *  renders the (empty) cells rather than shifting columns out of line. */
  hasRoadmap?: boolean;
}) {
  const meta = STATE_META[node.state];
  // Phase 21.6 keyboard parity: ArrowRight/ArrowDown step to the next
  // connected node, ArrowLeft/ArrowUp to the previous, Escape clears focus
  // entirely — the same three actions available via the visible controls
  // above the table, bound here so a keyboard user never has to leave the
  // row they're already on to reach them.
  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      if (!onNextConnected) return;
      event.preventDefault();
      onNextConnected();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      if (!onPreviousConnected) return;
      event.preventDefault();
      onPreviousConnected();
    } else if (event.key === "Escape") {
      if (!onClearFocus) return;
      event.preventDefault();
      onClearFocus();
    }
  }
  return (
    <tr
      data-graph-node={node.id}
      data-selected={selected ? "true" : "false"}
      data-emphasis={emphasisState}
      aria-current={selected ? "true" : undefined}
      onClick={() => onNodeClick?.(node)}
      className={`cursor-pointer border-b border-[var(--color-border)] align-top transition-colors hover:bg-[var(--color-surface)] ${selected ? "bg-[var(--color-surface)]" : ""} ${emphasisState === "dimmed" ? "opacity-50" : ""}`}
    >
      <td className="py-2 pr-4">
        <button
          ref={buttonRef}
          type="button"
          onClick={(event) => { event.stopPropagation(); onNodeClick?.(node); }}
          onKeyDown={handleKeyDown}
          className="font-medium text-[var(--color-text)] underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-ink)]"
        >
          {node.label}
          {node.year ? <span className="text-[var(--color-text-muted)]"> ({node.year})</span> : null}
        </button>
        {node.authors && <div className="text-xs text-[var(--color-text-muted)]">{node.authors}</div>}
        <div className="flex gap-3">
          {node.destination && node.type !== "work" && (
            <Link href={node.destination} className="text-xs underline" onClick={(event) => event.stopPropagation()}>
              Library entry
            </Link>
          )}
          {node.destination && node.type === "work" && (
            <Link href={node.destination} className="text-xs underline" onClick={(event) => event.stopPropagation()}>
              Open work
            </Link>
          )}
          {node.url && <a href={node.url} target="_blank" rel="noopener noreferrer" className="text-xs underline" onClick={(event) => event.stopPropagation()}>open source ↗</a>}
        </div>
      </td>
      <td className="py-2 pr-4 text-[var(--color-text-muted)]">{TYPE_LABEL[node.type]}</td>
      <td className="py-2 pr-4">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${meta.colorVar})` }} />
          {meta.label}
        </span>
      </td>
      {hasRoadmap && <td className="py-2 pr-4 text-[var(--color-text-muted)]">{node.roadmap ? STAGE_LABEL[node.roadmap.stage] : "—"}</td>}
      {hasRoadmap && <td className="py-2 pr-4 text-[var(--color-text-muted)]">{node.roadmap ? TIER_LABEL[node.roadmap.tier] : "—"}</td>}
      {hasRoadmap && <td className="py-2 pr-4 text-[var(--color-text-muted)]">{node.roadmap?.sequence ?? "—"}</td>}
      {hasRoadmap && (
        <td className="py-2 pr-4 text-[var(--color-text-muted)]">
          {node.roadmap ? (node.roadmap.known ? "✓ Yes" : "No") : "—"}
        </td>
      )}
      <td className="py-2 pr-4 text-xs text-[var(--color-text-muted)]">
        {connections.length === 0 ? "—" : <ul className="flex flex-col gap-0.5">{connections.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      </td>
      {hasRoadmap && <td className="py-2 pr-4 text-xs text-[var(--color-text-muted)]">{node.roadmap?.reason ?? "—"}</td>}
    </tr>
  );
}
