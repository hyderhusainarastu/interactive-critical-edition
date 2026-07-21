"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/app/PageHeader";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GraphAccessibleFallback } from "./GraphAccessibleFallback";
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
  filterGraphData,
  type GraphData,
  type GraphFilters,
  type GraphNode,
  type NodeType,
} from "./types";

// WebGL + three.js — client only, so pull it in dynamically with SSR off.
const KnowledgeGraph3D = dynamic(() => import("./KnowledgeGraph3D").then((m) => m.KnowledgeGraph3D), {
  ssr: false,
  loading: () => <p className="py-10 text-center text-[var(--color-text-muted)]">Loading 3D view…</p>,
});

const FILTER_KEYS = ["state", "type", "authority", "provider", "relation", "credibilityBand", "associatedWork"] as const;

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
export function GraphView({ endpoint, backHref, backLabel }: { endpoint: string; backHref: string; backLabel: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<GraphFilters>(() => filtersFromParams(searchParams));

  useEffect(() => {
    let ignore = false;
    fetch(endpoint)
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
  }, [endpoint]);

  const updateFilter = useCallback(
    (key: keyof GraphFilters, value: string) => {
      const next = { ...filters, [key]: value } as GraphFilters;
      setFilters(next);
      const params = new URLSearchParams(searchParams.toString());
      for (const k of FILTER_KEYS) {
        if (next[k] === "all") params.delete(k);
        else params.set(k, next[k]);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filters, pathname, router, searchParams],
  );

  const onNodeClick = useCallback((node: GraphNode) => setSelected(node), []);

  const filtered = useMemo(() => (data ? filterGraphData(data, filters) : null), [data, filters]);

  // Filter option lists come from the FULL data, not the filtered set, so
  // choosing one filter never hides the options for another.
  const relations = useMemo(() => (data ? [...new Set(data.links.map((l) => l.edgeType))].sort() : []), [data]);
  const authorities = useMemo(
    () => (data ? [...new Set(data.nodes.map((n) => n.authority).filter(Boolean) as string[])].sort() : []),
    [data],
  );
  const providers = useMemo(
    () => (data ? [...new Set(data.nodes.map((n) => n.provider).filter(Boolean) as string[])].sort() : []),
    [data],
  );
  const types = useMemo(() => (data ? [...new Set(data.nodes.map((n) => n.type))] : []), [data]);
  const workNodes = useMemo(() => (data ? data.nodes.filter((n) => n.type === "work") : []), [data]);
  const credibilityBands = useMemo(
    () => (data ? [...new Set(data.nodes.map((n) => credibilityBandFor(n.credibilityScore)))].sort() : []),
    [data],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-1 text-sm text-[var(--color-text-muted)]">
        <Link href={backHref} className="underline">
          ← {backLabel}
        </Link>
      </div>
      <div className="mb-4"><PageHeader title="Visualization" description={`${data?.title ?? "Your library"} · works, references, concepts, and (per-work) the text’s own outline.`} /></div>

      {error && <p className="text-[var(--color-accent-burgundy)]">{error}</p>}
      {!data && !error && <p className="text-[var(--color-text-muted)]">Loading graph…</p>}

      {data && data.nodes.length === 0 && (
        <p className="text-[var(--color-text-muted)]">
          Nothing to graph yet — upload and analyze a work so its references and connections appear here.
        </p>
      )}

      {data && filtered && data.nodes.length > 0 && (
        <>
          {/* Legend + stats */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {STATE_ORDER.map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
                <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${STATE_META[s].colorVar})` }} />
                {STATE_META[s].label}
              </span>
            ))}
            <span className="ml-auto text-[var(--color-text-muted)]">
              {data.stats.works} works · {data.stats.references} references · {data.stats.concepts} concepts ·{" "}
              {data.stats.missing} missing · {data.stats.read} read
            </span>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs" aria-label="Relationship color legend">
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
              <span className="text-[var(--color-text-muted)]">Filter</span>
              <select
                value={filters.state}
                onChange={(e) => updateFilter("state", e.target.value)}
                className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
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
                  className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
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
                  className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
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
                  className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
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
                  className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
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
                  className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
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

            {workNodes.length > 1 && (
              <label className="flex items-center gap-1">
                <span className="text-[var(--color-text-muted)]">Associated work</span>
                <select
                  value={filters.associatedWork}
                  onChange={(e) => updateFilter("associatedWork", e.target.value)}
                  className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
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

            <span className="ml-auto text-xs text-[var(--color-text-muted)]">
              {filtered.nodes.length} of {data.nodes.length} shown
            </span>
          </div>

          {filtered.nodes.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">No nodes match this filter.</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.9fr)]">
              <section className="order-2 lg:order-1" aria-label="3D relationship graph">
                <KnowledgeGraph3D data={filtered} onNodeClick={onNodeClick} />
              </section>
              <section className="order-1 lg:order-2" aria-label="Accessible relationship table">
                <GraphAccessibleFallback data={filtered} />
              </section>
            </div>
          )}

          {/* Node detail (from a 3D click) */}
          {selected && (
            <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-[var(--color-text)]">{selected.label}</p>
                  {selected.authors && <p className="text-sm text-[var(--color-text-muted)]">{selected.authors}</p>}
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                    {STATE_META[selected.state].label}
                    {selected.year ? ` · ${selected.year}` : ""}
                  </p>
                  {selected.url && (
                    <a href={selected.url} target="_blank" rel="noopener noreferrer" className="text-sm underline">
                      open reference ↗
                    </a>
                  )}
                </div>
                <button type="button" className="text-sm underline" onClick={() => setSelected(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
