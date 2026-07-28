"use client";

/**
 * The collapsible semantic-layer/filter rail (charter §10 "Graph workspace
 * layout", spec §1.1's `FilterRail.tsx` row). Renders the six layer
 * toggles plus the existing `GraphFilters` fields as active-filter
 * controls, per charter §7's progressive-disclosure rule (a short list of
 * common controls, not every field flat) — the filter *fields* themselves
 * are the existing, unmodified `GraphFilters` from `@/components/graph/types`,
 * only the presentation is new.
 *
 * Also renders the current disclosure/aggregation summary (charter §8:
 * "Do not silently drop hidden nodes; show counts and the reason for
 * aggregation") — each aggregate `DisplayNode` `buildAggregateNodes`
 * produced is listed with its real count and an "Expand" action that pulls
 * more of that exact group into view.
 */
import {
  CREDIBILITY_BAND_META,
  EDGE_FAMILY_META,
  EDGE_FAMILY_ORDER,
  STATE_META,
  STATE_ORDER,
  TYPE_LABEL,
  isDefaultFilters,
  type CredibilityBand,
  type GraphFilters,
  type NodeState,
  type NodeType,
} from "../graph/types";
import { LAYER_ORDER, type Layer } from "@ice/graph-display";
import type { KnowledgeMapDisplayNode } from "./adapter";

export const LAYER_LABEL: Record<Layer, string> = {
  evidence: "Evidence",
  intellectual: "Intellectual",
  claim: "Claims",
  debate: "Debates",
  learning: "Learning",
  research: "Research",
};

export interface AggregateSummary {
  node: KnowledgeMapDisplayNode;
  count: number;
}

export interface FilterRailProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeLayers: Layer[];
  onToggleLayer: (layer: Layer) => void;
  filters: GraphFilters;
  onFilterChange: (patch: Partial<GraphFilters>) => void;
  onClearFilters: () => void;
  aggregates: AggregateSummary[];
  onExpandAggregate: (aggregateNodeId: string) => void;
}

export function FilterRail({
  collapsed,
  onToggleCollapsed,
  activeLayers,
  onToggleLayer,
  filters,
  onFilterChange,
  onClearFilters,
  aggregates,
  onExpandAggregate,
}: FilterRailProps) {
  if (collapsed) {
    return (
      <div className="flex w-11 flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-background)] py-2">
        <button type="button" onClick={onToggleCollapsed} className="app-control app-icon-button" aria-label="Expand filter rail">
          ›
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="knowledge-map-filter-rail"
      className="app-reveal flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-background)] p-3 text-sm"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Filters</h2>
        {/* `.app-icon-button` (fixed 44x44) rather than the bare `p-1`
            styling this collapse toggle used before — real axe touch-target
            audit finding (2026-07-28): a 24x12 control genuinely fails the
            self-imposed 44x44 floor, not a naming-only issue. */}
        <button type="button" onClick={onToggleCollapsed} className="app-control app-icon-button" aria-label="Collapse filter rail">
          ‹
        </button>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs font-semibold text-[var(--color-text-muted)]">Layers</legend>
        {LAYER_ORDER.map((layer) => (
          <label key={layer} className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={activeLayers.length === 0 || activeLayers.includes(layer)} onChange={() => onToggleLayer(layer)} />
            {LAYER_LABEL[layer]}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-[var(--color-text-muted)]">Reading state</span>
        <select
          value={filters.state}
          onChange={(e) => onFilterChange({ state: e.target.value as NodeState | "all" })}
          className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
        >
          <option value="all">All states</option>
          {STATE_ORDER.map((state) => (
            <option key={state} value={state}>
              {STATE_META[state].label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-[var(--color-text-muted)]">Node type</span>
        <select
          value={filters.type}
          onChange={(e) => onFilterChange({ type: e.target.value as NodeType | "all" })}
          className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
        >
          <option value="all">All types</option>
          {(Object.keys(TYPE_LABEL) as NodeType[]).map((type) => (
            <option key={type} value={type}>
              {TYPE_LABEL[type]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-[var(--color-text-muted)]">Relationship</span>
        <select
          value={filters.relation}
          onChange={(e) => onFilterChange({ relation: e.target.value })}
          className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
        >
          <option value="all">All relationships</option>
          {EDGE_FAMILY_ORDER.map((family) => (
            <option key={family} value={family}>
              {EDGE_FAMILY_META[family].label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-semibold text-[var(--color-text-muted)]">Credibility</span>
        <select
          value={filters.credibilityBand}
          onChange={(e) => onFilterChange({ credibilityBand: e.target.value as CredibilityBand | "all" })}
          className="app-control rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
        >
          <option value="all">Any credibility</option>
          {(Object.keys(CREDIBILITY_BAND_META) as CredibilityBand[]).map((band) => (
            <option key={band} value={band}>
              {CREDIBILITY_BAND_META[band].label}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        onClick={onClearFilters}
        disabled={isDefaultFilters(filters) && activeLayers.length === 0}
        className="app-control self-start rounded px-2 py-1 text-xs text-[var(--color-text-muted)] underline disabled:no-underline disabled:opacity-40"
      >
        Clear all filters
      </button>

      {aggregates.length > 0 && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Not shown yet</h2>
          <ul className="flex flex-col gap-2" aria-label="Aggregated, not-yet-visible nodes">
            {aggregates.map(({ node, count }) => (
              <li key={String(node.id)} className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-2 py-1.5 text-xs">
                <span>{node.label}</span>
                <button
                  type="button"
                  onClick={() => onExpandAggregate(String(node.id))}
                  className="app-control shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-text)]"
                  aria-label={`Expand ${count} more ${node.displayKind} nodes`}
                >
                  Expand
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
