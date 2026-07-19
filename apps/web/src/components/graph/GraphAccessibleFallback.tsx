"use client";

import { useMemo, useState } from "react";
import { edgeTypeLabel, STATE_META, type GraphData, type GraphNode, type NodeState } from "./types";

/**
 * The mandatory non-3D fallback (plan §20): the identical node/edge data
 * as a sortable, filterable, fully keyboard- and screen-reader-operable
 * table. A WebGL scene can't be read by assistive tech, so the 3D view is
 * treated as an enhancement over this — reachable by a visible toggle,
 * never the only way to get the information.
 */
type SortKey = "label" | "state" | "type" | "connections";

export function GraphAccessibleFallback({ data }: { data: GraphData }) {
  const [filterState, setFilterState] = useState<NodeState | "all">("all");
  const [filterAuthority, setFilterAuthority] = useState<string>("all");
  const [filterProvider, setFilterProvider] = useState<string>("all");
  const [filterRelation, setFilterRelation] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("state");
  const [asc, setAsc] = useState(true);

  // Connections per node (degree) and a readable "connected to" summary, plus
  // the set of relation (edge) types touching each node (for the relation filter).
  const { connections, edgeTypesByNode } = useMemo(() => {
    const byNode = new Map<string, string[]>();
    const edgesByNode = new Map<string, Set<string>>();
    const labelById = new Map(data.nodes.map((n) => [n.id, n.label]));
    const add = (id: string, edgeType: string) => {
      const set = edgesByNode.get(id) ?? new Set<string>();
      set.add(edgeType);
      edgesByNode.set(id, set);
    };
    for (const l of data.links) {
      const s = typeof l.source === "string" ? l.source : (l.source as { id: string }).id;
      const t = typeof l.target === "string" ? l.target : (l.target as { id: string }).id;
      byNode.set(s, [...(byNode.get(s) ?? []), `${edgeTypeLabel(l.edgeType)} → ${labelById.get(t) ?? t}`]);
      byNode.set(t, [...(byNode.get(t) ?? []), `← ${edgeTypeLabel(l.edgeType)} from ${labelById.get(s) ?? s}`]);
      add(s, l.edgeType);
      add(t, l.edgeType);
    }
    return { connections: byNode, edgeTypesByNode: edgesByNode };
  }, [data]);

  const authorities = useMemo(() => [...new Set(data.nodes.map((n) => n.authority).filter(Boolean) as string[])].sort(), [data.nodes]);
  const providers = useMemo(() => [...new Set(data.nodes.map((n) => n.provider).filter(Boolean) as string[])].sort(), [data.nodes]);
  const relations = useMemo(() => [...new Set(data.links.map((l) => l.edgeType))].sort(), [data.links]);

  const rows = useMemo(() => {
    const filtered = data.nodes.filter(
      (n) =>
        (filterState === "all" || n.state === filterState) &&
        (filterAuthority === "all" || n.authority === filterAuthority) &&
        (filterProvider === "all" || n.provider === filterProvider) &&
        (filterRelation === "all" || edgeTypesByNode.get(n.id)?.has(filterRelation)),
    );
    const dir = asc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "connections") {
        return dir * ((connections.get(a.id)?.length ?? 0) - (connections.get(b.id)?.length ?? 0));
      }
      return dir * String(a[sortKey]).localeCompare(String(b[sortKey]));
    });
  }, [data.nodes, filterState, filterAuthority, filterProvider, filterRelation, sortKey, asc, connections, edgeTypesByNode]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(true);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          <span className="text-[var(--color-text-muted)]">Filter</span>
          <select
            value={filterState}
            onChange={(e) => setFilterState(e.target.value as NodeState | "all")}
            className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
          >
            <option value="all">All ({data.nodes.length})</option>
            {(Object.keys(STATE_META) as NodeState[]).map((s) => (
              <option key={s} value={s}>
                {STATE_META[s].label}
              </option>
            ))}
          </select>
        </label>

        {relations.length > 0 && (
          <label className="flex items-center gap-1">
            <span className="text-[var(--color-text-muted)]">Relation</span>
            <select value={filterRelation} onChange={(e) => setFilterRelation(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
              <option value="all">All</option>
              {relations.map((r) => <option key={r} value={r}>{edgeTypeLabel(r)}</option>)}
            </select>
          </label>
        )}

        {authorities.length > 0 && (
          <label className="flex items-center gap-1">
            <span className="text-[var(--color-text-muted)]">Authority</span>
            <select value={filterAuthority} onChange={(e) => setFilterAuthority(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
              <option value="all">All</option>
              {authorities.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        )}

        {providers.length > 0 && (
          <label className="flex items-center gap-1">
            <span className="text-[var(--color-text-muted)]">Provider</span>
            <select value={filterProvider} onChange={(e) => setFilterProvider(e.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
              <option value="all">All</option>
              {providers.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Knowledge graph as a table: each work or referenced reading, its read status, and what it connects to.
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
        {rows.length === 0 && <p className="py-4 text-[var(--color-text-muted)]">No nodes match this filter.</p>}
      </div>
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

function NodeRow({ node, connections }: { node: GraphNode; connections: string[] }) {
  const meta = STATE_META[node.state];
  return (
    <tr className="border-b border-[var(--color-border)] align-top">
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
