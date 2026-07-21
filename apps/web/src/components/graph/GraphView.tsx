"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/app/PageHeader";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type GraphLink,
  type GraphNode,
  type NodeType,
} from "./types";

// WebGL + three.js — client only, so pull it in dynamically with SSR off.
const KnowledgeGraph3D = dynamic(() => import("./KnowledgeGraph3D").then((m) => m.KnowledgeGraph3D), {
  ssr: false,
  loading: () => <p className="py-10 text-center text-[var(--color-text-muted)]">Loading 3D view…</p>,
});

const FILTER_KEYS = ["search", "state", "type", "authority", "provider", "relation", "credibilityBand", "associatedWork"] as const;
const PINNED_WORK_PARAM = "pinnedWork";

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
export function GraphView({ endpoint, backHref, backLabel, enableExpansion = false }: { endpoint: string; backHref: string; backLabel: string; enableExpansion?: boolean }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [selectedLink, setSelectedLink] = useState<GraphLink | null>(null);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<GraphFilters>(() => filtersFromParams(searchParams));
  const [pinnedWorkIds, setPinnedWorkIds] = useState<string[]>(() => searchParams.getAll(PINNED_WORK_PARAM).filter((id) => id.startsWith("work:")));
  const graphWorkspaceRef = useRef<HTMLDivElement>(null);

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
        if (next[k] === "all" || next[k] === "") params.delete(k);
        else params.set(k, next[k]);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [filters, pathname, router, searchParams],
  );

  const onNodeClick = useCallback((node: GraphNode) => {
    setSelected(node);
    setSelectedLink(null);
  }, []);

  const togglePinnedWork = useCallback((workId: string, checked: boolean) => {
    setPinnedWorkIds((current) => {
      const next = checked ? [...new Set([...current, workId])] : current.filter((id) => id !== workId);
      const params = new URLSearchParams(searchParams.toString());
      params.delete(PINNED_WORK_PARAM);
      for (const id of next) params.append(PINNED_WORK_PARAM, id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      return next;
    });
  }, [pathname, router, searchParams]);

  function toggleFullscreen() {
    const target = graphWorkspaceRef.current;
    if (!target) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void target.requestFullscreen();
  }

  function exportPng() {
    const canvas = graphWorkspaceRef.current?.querySelector("canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = "palimnote-cross-library-graph.png";
    link.click();
  }

  const filtered = useMemo(() => (data ? filterGraphData(data, filters, pinnedWorkIds) : null), [data, filters, pinnedWorkIds]);

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
      <div className="mb-4"><PageHeader title="Visualization" description={`${data?.title ?? "Your library"} · works, sources, concepts, people, and (per-work) the text’s own outline.`} /></div>

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
              {data.stats.works} works · {data.stats.references} references · {data.stats.sources} sources · {data.stats.concepts} concepts · {data.stats.people} people ·{" "}
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
              <span className="text-[var(--color-text-muted)]">Search</span>
              <input
                value={filters.search}
                onChange={(event) => updateFilter("search", event.target.value)}
                placeholder="Works, concepts, sources"
                className="w-48 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
              />
            </label>
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

          {workNodes.length > 0 && (
            <fieldset className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm" aria-label="Pinned uploaded works">
              <legend className="px-1 text-xs font-medium text-[var(--color-text-muted)]">Pinned uploaded works</legend>
              <p className="mb-2 text-xs text-[var(--color-text-muted)]">Select one or more works to keep them anchored in the graph and table while you filter their surrounding research web.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {workNodes.map((work) => (
                  <label key={work.id} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={pinnedWorkIds.includes(work.id)} onChange={(event) => togglePinnedWork(work.id, event.target.checked)} />
                    <span>{work.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {enableExpansion && <GraphExpansionControls workNodes={workNodes} />}

          {filtered.nodes.length === 0 ? (
            <p className="text-[var(--color-text-muted)]">No nodes match this filter.</p>
          ) : (
            <div ref={graphWorkspaceRef} className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(22rem,0.9fr)]">
              <section className="order-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 lg:order-1" aria-label="3D relationship graph">
                <div className="mb-2 flex justify-end gap-2 text-xs">
                  <button type="button" onClick={toggleFullscreen} className="rounded border border-[var(--color-border)] px-2 py-1">Fullscreen</button>
                  <button type="button" onClick={exportPng} className="rounded border border-[var(--color-border)] px-2 py-1">Export PNG</button>
                </div>
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_17rem]">
                  <KnowledgeGraph3D data={filtered} onNodeClick={onNodeClick} onLinkClick={setSelectedLink} pinnedWorkIds={pinnedWorkIds} selectedNodeId={selected?.id} />
                  <GraphInspector selected={selected} selectedLink={selectedLink} onCloseNode={() => setSelected(null)} onCloseLink={() => setSelectedLink(null)} />
                </div>
              </section>
              <section className="order-1 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 lg:order-2" aria-label="Accessible relationship table">
                <GraphAccessibleFallback data={filtered} selectedNodeId={selected?.id} onNodeClick={onNodeClick} />
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EvidenceAnchors({ evidence }: { evidence: unknown }) {
  const record = evidence && typeof evidence === "object" ? evidence as { sourceClaims?: { claim?: string; excerpt?: string }[]; targetClaims?: { claim?: string; excerpt?: string }[] } : null;
  if (!record) return null;
  const anchors = [...(record.sourceClaims ?? []), ...(record.targetClaims ?? [])].slice(0, 6);
  if (!anchors.length) return null;
  return <ul className="mt-3 space-y-2 border-l-2 border-[var(--color-border)] pl-3 text-xs text-[var(--color-text-muted)]" aria-label="Grounded claim evidence">
    {anchors.map((anchor, index) => <li key={index}><span className="font-medium text-[var(--color-text)]">{anchor.claim}</span>{anchor.excerpt ? <span> — “{anchor.excerpt}”</span> : null}</li>)}
  </ul>;
}

function GraphInspector({
  selected,
  selectedLink,
  onCloseNode,
  onCloseLink,
}: {
  selected: GraphNode | null;
  selectedLink: GraphLink | null;
  onCloseNode: () => void;
  onCloseLink: () => void;
}) {
  return (
    <aside className="max-h-[520px] overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-background)] p-3" aria-label="Graph inspector" data-graph-inspector>
      {!selected && !selectedLink && <p className="text-sm text-[var(--color-text-muted)]">Select a graph node or a table row to inspect its source, access, and provenance. Select a link for relationship evidence.</p>}
      {selected && (
        <div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-[var(--color-text)]">{selected.label}</p>
              {selected.authors && <p className="text-sm text-[var(--color-text-muted)]">{selected.authors}</p>}
            </div>
            <button type="button" className="text-xs underline" onClick={onCloseNode}>Close</button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            {TYPE_LABEL[selected.type]} · {STATE_META[selected.state].label}{selected.year ? ` · ${selected.year}` : ""}
          </p>
          {selected.authority && <p className="mt-2 text-xs text-[var(--color-text-muted)]">Authority {selected.authority}{selected.credibilityScore != null ? ` · credibility ${Math.round(selected.credibilityScore * 100)}%` : ""}</p>}
          {selected.sourceTextStatus && (
            <div className="mt-3 rounded border border-[var(--color-border)] p-2 text-xs">
              <p className="font-medium text-[var(--color-text)]">Source access</p>
              <p className="mt-1 text-[var(--color-text-muted)]">{sourceTextLabel(selected.sourceTextStatus, selected.accessStatus)}</p>
              {selected.license && <p className="mt-1 text-[var(--color-text-muted)]">License evidence: {selected.license}</p>}
              {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block underline">open licensed source ↗</a>}
            </div>
          )}
          {selected.provenance && <div className="mt-3 text-xs text-[var(--color-text-muted)]"><p className="font-medium text-[var(--color-text)]">Provenance</p><p className="mt-1">{selected.provenance.provider} · inspection depth {selected.provenance.inspectionDepth}{selected.provenance.inspectedAt ? ` · ${new Date(selected.provenance.inspectedAt).toLocaleDateString()}` : ""}</p></div>}
          {selected.url && <a href={selected.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm underline">open source record ↗</a>}
        </div>
      )}
      {selectedLink && (
        <div className={selected ? "mt-5 border-t border-[var(--color-border)] pt-4" : ""} data-graph-evidence>
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-[var(--color-text)]">{selectedLink.edgeType.replace(/_/g, " ")}</p>
            <button type="button" className="text-xs underline" onClick={onCloseLink}>Close</button>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{selectedLink.explanation ?? "Relationship evidence is recorded with the source relation."}</p>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">Confidence {Math.round(selectedLink.confidence * 100)}%{selectedLink.provenance ? ` · provenance depth ${selectedLink.provenance.depth}` : ""}</p>
          {Boolean(selectedLink.evidence) && <EvidenceAnchors evidence={selectedLink.evidence} />}
        </div>
      )}
    </aside>
  );
}

function sourceTextLabel(status: string, accessStatus?: string | null) {
  if (status === "open_access_indexed") return "Open-access source text indexed from license-evidenced metadata.";
  if (status === "open_access_available") return "Open-access source confirmed; its text was not automatically indexed.";
  if (status === "retrieval_failed") return "Open-access source confirmed; automatic retrieval failed, so it remains metadata-only.";
  return accessStatus === "open" ? "Open source record; no eligible source text has been indexed." : "Metadata only — Palimnote did not retrieve source text without license evidence.";
}

interface ExpansionPreview {
  availableCandidates: number;
  hasGroundedClaims: boolean;
  manual: { candidateCount: number; estimatedCostUsd: number; requiresConfirmation: boolean; hardCapUsd: number };
}

function GraphExpansionControls({ workNodes }: { workNodes: GraphNode[] }) {
  const [workId, setWorkId] = useState(workNodes[0]?.id.replace(/^work:/, "") ?? "");
  const [candidates, setCandidates] = useState(20);
  const [preview, setPreview] = useState<ExpansionPreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!workId) return;
    let ignore = false;
    fetch(`/api/graph/expansion/preview?workId=${encodeURIComponent(workId)}&candidates=${candidates}`)
      .then(async (response) => response.ok ? response.json() as Promise<ExpansionPreview> : null)
      .then((next) => { if (!ignore) setPreview(next); })
      .catch(() => { if (!ignore) setPreview(null); });
    return () => { ignore = true; };
  }, [workId, candidates]);

  async function expand(confirmEstimatedCost: boolean) {
    const response = await fetch("/api/graph/expansion", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ workId, candidates, confirmEstimatedCost }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body.preview?.manual?.requiresConfirmation) {
      setMessage(`Estimated ${formatUsd(body.preview.manual.estimatedCostUsd)}. Confirm to queue this paid expansion.`);
      return;
    }
    setMessage(response.ok ? "Expansion queued. Grounded relationships appear when the job completes." : (body.error ?? "Could not queue expansion."));
  }

  if (!workId) return null;
  return (
    <section className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm" data-graph-expansion>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-text-muted)]">Expand from work</span>
          <select value={workId} onChange={(event) => setWorkId(event.target.value)} className="rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1">
            {workNodes.map((work) => <option key={work.id} value={work.id.replace(/^work:/, "")}>{work.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs text-[var(--color-text-muted)]">New candidates</span>
          <input type="number" min={1} max={100} value={candidates} onChange={(event) => setCandidates(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1" />
        </label>
        <button type="button" disabled={!preview?.hasGroundedClaims || !preview?.manual.candidateCount} onClick={() => expand(false)} className="rounded bg-[var(--color-accent-ink)] px-3 py-1.5 text-[var(--color-background)] disabled:opacity-50">Queue expansion</button>
        {preview?.manual.requiresConfirmation && <button type="button" onClick={() => expand(true)} className="rounded border border-[var(--color-credibility-warning)] px-3 py-1.5">Confirm {formatUsd(preview.manual.estimatedCostUsd)}</button>}
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        {preview
          ? `${preview.manual.candidateCount} of ${preview.availableCandidates} grounded candidates · estimate ${formatUsd(preview.manual.estimatedCostUsd)} · hard cap ${formatUsd(preview.manual.hardCapUsd)}${preview.manual.requiresConfirmation ? " · confirmation required above $1" : ""}`
          : "Calculating a read-only estimate…"}
      </p>
      {message && <p className="mt-2 text-xs text-[var(--color-text-muted)]">{message}</p>}
    </section>
  );
}

function formatUsd(value: number) {
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}
