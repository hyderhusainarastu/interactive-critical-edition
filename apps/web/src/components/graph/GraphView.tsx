"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { GraphAccessibleFallback } from "./GraphAccessibleFallback";
import { STATE_META, STATE_ORDER, type GraphData, type GraphNode } from "./types";

// WebGL + three.js — client only, so pull it in dynamically with SSR off.
const KnowledgeGraph3D = dynamic(() => import("./KnowledgeGraph3D").then((m) => m.KnowledgeGraph3D), {
  ssr: false,
  loading: () => <p className="py-10 text-center text-[var(--color-text-muted)]">Loading 3D view…</p>,
});

/**
 * Orchestrates the knowledge-graph tab: fetches the per-user graph, offers
 * a visible 3D ⇄ table toggle (the table is the accessible equal, plan
 * §20), a state legend, summary counts, and a click-to-detail panel. The
 * table view is the default so the information is reachable with zero
 * WebGL — the 3D scene is opt-in.
 */
export function GraphView({ endpoint, backHref, backLabel }: { endpoint: string; backHref: string; backLabel: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"table" | "3d">("table");
  const [selected, setSelected] = useState<GraphNode | null>(null);

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

  const onNodeClick = useCallback((node: GraphNode) => setSelected(node), []);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-1 text-sm text-[var(--color-text-muted)]">
        <Link href={backHref} className="underline">
          ← {backLabel}
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-[var(--color-text)]">Knowledge graph</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {data?.title ?? ""} · works, the readings they reference, and what you&rsquo;ve read.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-[var(--color-border)] p-0.5 text-sm" role="group" aria-label="View mode">
          <button
            type="button"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
            className="rounded px-3 py-1"
            style={{ background: view === "table" ? "var(--color-surface)" : "transparent" }}
          >
            Table
          </button>
          <button
            type="button"
            aria-pressed={view === "3d"}
            onClick={() => setView("3d")}
            className="rounded px-3 py-1"
            style={{ background: view === "3d" ? "var(--color-surface)" : "transparent" }}
          >
            3D
          </button>
        </div>
      </div>

      {error && <p className="text-[var(--color-accent-burgundy)]">{error}</p>}
      {!data && !error && <p className="text-[var(--color-text-muted)]">Loading graph…</p>}

      {data && data.nodes.length === 0 && (
        <p className="text-[var(--color-text-muted)]">
          Nothing to graph yet — upload and analyze a work so its references and connections appear here.
        </p>
      )}

      {data && data.nodes.length > 0 && (
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
              {data.stats.works} works · {data.stats.references} references · {data.stats.missing} missing ·{" "}
              {data.stats.read} read
            </span>
          </div>

          {view === "table" ? (
            <GraphAccessibleFallback data={data} />
          ) : (
            <KnowledgeGraph3D data={data} onNodeClick={onNodeClick} />
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
