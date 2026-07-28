"use client";

/**
 * The mandatory, always-real semantic List view (charter §10 "2D and
 * List", spec §1.1's `KnowledgeMapListView.tsx` row). Consumes the SAME
 * filtered `DisplayNode[]`/`DisplayLink[]` selection the 3D scene and 2D
 * view do — grouped by layer then relationship distance (`listLayout.ts`),
 * with sort/select/actions and pagination (charter §16 "no pagination/
 * virtualization" was baseline defect #9; this is the fix, not a carry-
 * forward of the old `GraphAccessibleFallback.tsx` table as-is).
 *
 * This is the view `KnowledgeMapFallbackBoundary.tsx` renders whenever 3D
 * isn't active — so it must be a fully independent, fully-capable view on
 * its own (real node data, real filters already applied upstream, real
 * selection, real destination links, real scholarly actions via the
 * inspector this same selection drives), never a stripped-down emergency
 * table. Ported table conventions (column set, per-row destination link)
 * from `graph/GraphAccessibleFallback.tsx`; the missing pagination that
 * file's own baseline defect flagged is the one thing this port adds
 * rather than repeats.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LiveRegion } from "@/components/primitives/LiveRegion";
import { STATE_META, type GraphNode, type NodeState } from "../graph/types";
import type { KnowledgeMapDisplayLink, KnowledgeMapDisplayNode } from "./adapter";
import { buildListRows, LAYER_LABEL, LIST_PAGE_SIZE, paginateListRows, sortListRows, type ListSortKey } from "./listLayout";
import { EMPTY_FOCUS_EMPHASIS, emphasisStateForNode, type FocusEmphasis, type NodeEmphasisState } from "./graphFocus";

export interface KnowledgeMapListViewProps {
  /** The current disclosed topology (same array `KnowledgeMapScene` would
   *  receive) — this view filters by `visibleNodeIds` itself, the same way
   *  the 3D scene toggles visibility rather than removing array entries,
   *  so both views stay driven by literally the same two props. */
  nodes: KnowledgeMapDisplayNode[];
  links: KnowledgeMapDisplayLink[];
  visibleNodeIds?: ReadonlySet<string> | null;
  rootNodeId: string | null;
  selectedId: string | null;
  canonicalNodeById: ReadonlyMap<string, GraphNode>;
  /** Charter §9/§10's active `GraphFocusState` emphasis (`./graphFocus.ts`),
   *  the SAME value `KnowledgeMapScene`/`KnowledgeMap2DView` consume — a
   *  dimmed row stays in the table (charter: "never silently removed"),
   *  just visually and semantically (`data-emphasis="dimmed"`) marked as
   *  outside the active focus. */
  emphasis?: FocusEmphasis;
  onSelect: (nodeId: string | null) => void;
}

function stateLabel(id: string, canonicalNodeById: ReadonlyMap<string, GraphNode>): { label: string; colorVar: string } | null {
  const canonical = canonicalNodeById.get(id);
  if (!canonical) return null;
  const meta = STATE_META[canonical.state as NodeState];
  return meta ? { label: meta.label, colorVar: meta.colorVar } : null;
}

function distanceLabel(distance: number | null): string {
  if (distance === null) return "—";
  if (distance === 0) return "Root";
  return `${distance} hop${distance === 1 ? "" : "s"}`;
}

export function KnowledgeMapListView({
  nodes,
  links,
  visibleNodeIds,
  rootNodeId,
  selectedId,
  canonicalNodeById,
  emphasis = EMPTY_FOCUS_EMPHASIS,
  onSelect,
}: KnowledgeMapListViewProps) {
  const [sortKey, setSortKey] = useState<ListSortKey>("distance");
  const [ascending, setAscending] = useState(true);
  const [page, setPage] = useState(1);
  // A11y-proxy pass finding (stage7-prep/a11y-proxy.md #4): selecting a
  // node produced zero screen-reader announcement — the one
  // `aria-live="polite"` region on this view was the pager's "Page X of Y"
  // text, which never changes on selection. Announced here, tied directly
  // to the actual user action (the row/button click that calls `onSelect`),
  // rather than derived from a `selectedId`-change effect — that would
  // also fire on an initial deep-link/mount selection, which isn't a "just
  // selected this" event a screen-reader user needs announced.
  const [announcement, setAnnouncement] = useState("");
  function handleSelect(id: string, label: string) {
    onSelect(id);
    setAnnouncement(`Selected ${label}`);
  }

  const visibleNodes = useMemo(() => (visibleNodeIds ? nodes.filter((n) => visibleNodeIds.has(String(n.id))) : nodes), [nodes, visibleNodeIds]);
  const visibleIdSet = useMemo(() => new Set(visibleNodes.map((n) => String(n.id))), [visibleNodes]);
  const visibleLinks = useMemo(() => links.filter((l) => visibleIdSet.has(String(l.source)) && visibleIdSet.has(String(l.target))), [links, visibleIdSet]);

  const rows = useMemo(() => buildListRows(visibleNodes, rootNodeId, visibleLinks), [visibleNodes, rootNodeId, visibleLinks]);
  const sortedRows = useMemo(() => sortListRows(rows, sortKey, ascending), [rows, sortKey, ascending]);
  const { pageRows, pageCount, page: clampedPage, totalRows } = useMemo(() => paginateListRows(sortedRows, page, LIST_PAGE_SIZE), [sortedRows, page]);

  // A filter/sort change that shrinks the result set below the current
  // page must not strand the user on a now-empty page — reset to 1
  // whenever the INPUT identity changes, not every render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [sortedRows.length]);

  function toggleSort(key: ListSortKey) {
    if (sortKey === key) setAscending((v) => !v);
    else {
      setSortKey(key);
      setAscending(true);
    }
  }

  return (
    <div data-testid="knowledge-map-list-view" className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 text-xs">
        {/* A11y-proxy pass finding #4: this result count is real, visible
            text that also needs to be a live region — filtering/searching
            changes it without any other cue a screen-reader user would
            otherwise get. `aria-atomic` re-reads the whole sentence on any
            change, not just the changed digit. */}
        <span className="text-[var(--color-text-muted)]" role="status" aria-live="polite" aria-atomic="true">
          {totalRows} node{totalRows === 1 ? "" : "s"} shown
        </span>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Sort">
          <SortButton label="By distance" active={sortKey === "distance"} ascending={ascending} onClick={() => toggleSort("distance")} />
          <SortButton label="By label" active={sortKey === "label"} ascending={ascending} onClick={() => toggleSort("label")} />
        </div>
      </div>
      <LiveRegion message={announcement} />

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-auto">
        {totalRows === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--color-text-muted)]">No nodes match the current filters.</p>
        ) : (
          <table className="w-full min-w-[520px] border-collapse text-sm" data-testid="knowledge-map-list-table">
            <caption className="sr-only">Knowledge Map contents as a list: every node currently shown, grouped by layer.</caption>
            <tbody>
              {pageRows.map((row, index) => {
                const showHeader = index === 0 || pageRows[index - 1].layer !== row.layer;
                const id = String(row.node.id);
                const meta = stateLabel(id, canonicalNodeById);
                const selected = selectedId === id;
                return (
                  <FragmentRow
                    key={id}
                    row={row}
                    showHeader={showHeader}
                    selected={selected}
                    isRoot={rootNodeId === id}
                    meta={meta}
                    emphasisState={emphasisStateForNode(id, selectedId, emphasis)}
                    onSelect={() => handleSelect(id, row.node.label)}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {pageCount > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-3 border-t border-[var(--color-border)] px-3 py-2 text-xs">
          <button type="button" className="app-control rounded px-2 py-1 disabled:opacity-40" disabled={clampedPage <= 1} onClick={() => setPage(clampedPage - 1)}>
            Previous
          </button>
          <span aria-live="polite">
            Page {clampedPage} of {pageCount}
          </span>
          <button type="button" className="app-control rounded px-2 py-1 disabled:opacity-40" disabled={clampedPage >= pageCount} onClick={() => setPage(clampedPage + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function SortButton({ label, active, ascending, onClick }: { label: string; active: boolean; ascending: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`app-control rounded px-2 py-1 ${active ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]"}`}
    >
      {label} <span aria-hidden>{active ? (ascending ? "▲" : "▼") : ""}</span>
    </button>
  );
}

function FragmentRow({
  row,
  showHeader,
  selected,
  isRoot,
  meta,
  emphasisState,
  onSelect,
}: {
  row: ReturnType<typeof buildListRows>[number];
  showHeader: boolean;
  selected: boolean;
  isRoot: boolean;
  meta: { label: string; colorVar: string } | null;
  emphasisState: NodeEmphasisState;
  onSelect: () => void;
}) {
  const node = row.node;
  // Charter §10 "unrelated visible content dims to 0.12 opacity ... never
  // silently removed" — a dimmed row stays a full, actionable row (same
  // click/select/destination link), just visually de-emphasized and
  // carrying `data-emphasis="dimmed"` for assistive tech/e2e assertions.
  // The exact 0.12 figure is a SPATIAL-canvas rule (3D scene / SVG 2D dots)
  // where a dimmed mark is still legible at a glance against its neighbors;
  // a DATA TABLE ROW at 0.12 would fail this same view's own accessibility
  // requirement to stay a fully readable, equal-capability representation
  // (charter §17 "an equal-capability semantic 2D/List representation"),
  // so this row uses a lighter, still-legible 0.55 — the semantic fact
  // (`data-emphasis="dimmed"`, the row's position/grouping) is identical to
  // the 3D/2D views either way; only the numeric opacity differs, and only
  // because this is text a reader must still be able to read, not a mark on
  // a spatial canvas.
  const dimmed = emphasisState === "dimmed";
  return (
    <>
      {showHeader && (
        <tr>
          <th
            colSpan={4}
            scope="colgroup"
            className="sticky top-0 bg-[var(--color-surface-strong)] px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--color-surface-strong-fg-soft)]"
          >
            {LAYER_LABEL[row.layer]}
          </th>
        </tr>
      )}
      <tr
        data-graph-node={node.id}
        data-selected={selected ? "true" : "false"}
        data-emphasis={emphasisState}
        aria-current={selected ? "true" : undefined}
        style={dimmed ? { opacity: 0.55 } : undefined}
        className={`cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface)] ${selected ? "bg-[var(--color-surface)]" : ""}`}
        onClick={onSelect}
      >
        <td className="px-2 py-2">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            className="text-left font-medium text-[var(--color-text)] underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-accent-ink)]"
          >
            {node.label}
            {isRoot && <span className="ml-1 text-[10px] uppercase text-[var(--color-text-muted)]">(root)</span>}
          </button>
        </td>
        <td className="px-2 py-2 text-xs text-[var(--color-text-muted)]">{node.displayKind}</td>
        <td className="px-2 py-2 text-xs">
          {meta ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: `var(${meta.colorVar})` }} />
              {meta.label}
            </span>
          ) : (
            <span className="text-[var(--color-text-muted)]">{node.unavailableReason ?? "—"}</span>
          )}
        </td>
        <td className="px-2 py-2 text-xs text-[var(--color-text-muted)]">
          {distanceLabel(row.distance)}
          {node.destination && (
            <>
              {" · "}
              <Link href={node.destination} className="underline" onClick={(event) => event.stopPropagation()}>
                Open
              </Link>
            </>
          )}
        </td>
      </tr>
    </>
  );
}
