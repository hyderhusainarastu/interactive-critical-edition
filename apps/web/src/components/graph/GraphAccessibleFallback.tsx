"use client";

import { useMemo, useState } from "react";
import { edgeTypeLabel, STATE_META, type GraphData } from "./types";

/**
 * The mandatory non-3D fallback (plan §20): the identical node/edge data
 * as a sortable, fully keyboard- and screen-reader-operable table. Filters
 * live in `GraphView` (plan §34.4 9.7 — the table and the 3D scene must
 * show identical filtered data, so filtering happens once, above both,
 * not independently in each); `data` here is already filtered. Sorting
 * stays local since it's a display concern the 3D scene has no equivalent
 * of, not something the two views need to agree on.
 */
type SortKey = "label" | "state" | "type" | "connections";

export function GraphAccessibleFallback({ data }: { data: GraphData }) {
  const [sortKey, setSortKey] = useState<SortKey>("state");
  const [asc, setAsc] = useState(true);

  // Connections per node (degree) and a readable "connected to" summary.
  const connections = useMemo(() => {
    const byNode = new Map<string, string[]>();
    const labelById = new Map(data.nodes.map((n) => [n.id, n.label]));
    for (const l of data.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as { id: string }).id;
      const t = typeof l.target === "string" ? l.target : (l.target as { id: string }).id;
      byNode.set(s, [...(byNode.get(s) ?? []), `${edgeTypeLabel(l.edgeType)} → ${labelById.get(t) ?? t}`]);
      byNode.set(t, [...(byNode.get(t) ?? []), `← ${edgeTypeLabel(l.edgeType)} from ${labelById.get(s) ?? s}`]);
    }
    return byNode;
  }, [data]);

  const rows = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...data.nodes].sort((a, b) => {
      if (sortKey === "connections") {
        return dir * ((connections.get(a.id)?.length ?? 0) - (connections.get(b.id)?.length ?? 0));
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
            <SortHeader
              label="Connections"
              active={sortKey === "connections"}
              asc={asc}
              onClick={() => toggleSort("connections")}
            />
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <NodeRow key={n.id} node={n} connections={connections.get(n.id) ?? []} />
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

function NodeRow({ node, connections }: { node: GraphData["nodes"][number]; connections: string[] }) {
  const meta = STATE_META[node.state];
  return (
    <tr data-graph-node={node.id} className="border-b border-[var(--color-border)] align-top">
      <td className="py-2 pr-4">
        <div className="font-medium text-[var(--color-text)]">
          {node.url ? (
            <a href={node.url} target="_blank" rel="noopener noreferrer" className="underline">
              {node.label}
            </a>
          ) : (
            node.label
          )}
          {node.year ? <span className="text-[var(--color-text-muted)]"> ({node.year})</span> : null}
        </div>
        {node.authors && <div className="text-xs text-[var(--color-text-muted)]">{node.authors}</div>}
      </td>
      <td className="py-2 pr-4 text-[var(--color-text-muted)]">{node.type}</td>
      <td className="py-2 pr-4">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${meta.colorVar})` }} />
          {meta.label}
        </span>
      </td>
      <td className="py-2 pr-4 text-xs text-[var(--color-text-muted)]">
        {connections.length === 0 ? "—" : <ul className="flex flex-col gap-0.5">{connections.map((c, i) => <li key={i}>{c}</li>)}</ul>}
      </td>
    </tr>
  );
}
