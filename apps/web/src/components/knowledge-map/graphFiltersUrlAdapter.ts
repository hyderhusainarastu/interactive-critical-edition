/**
 * Converts between `@ice/graph-display`'s `GraphUrlFilters` (a `Partial`
 * map — a filter key is present-with-a-value or absent, `urlState.ts`'s
 * own doc comment) and `apps/web`'s existing `GraphFilters` (every field
 * always present, defaulting to `"all"`/`""` — `../graph/types.ts`'s
 * `DEFAULT_GRAPH_FILTERS`, the shape `filterGraphData`/`FilterRail.tsx`
 * actually consume). Charter §9 requires "Active filters" to round-trip
 * through the URL; this is the one place that conversion happens, so
 * `KnowledgeMapWorkspace.tsx` never hand-rolls it inline and risks
 * drifting the two shapes apart.
 */
import { GRAPH_FILTER_KEYS, type GraphUrlFilters } from "@ice/graph-display";
import { DEFAULT_GRAPH_FILTERS, type GraphFilters } from "../graph/types";

export function graphFiltersFromUrlFilters(urlFilters: GraphUrlFilters): GraphFilters {
  const filters = { ...DEFAULT_GRAPH_FILTERS };
  for (const key of GRAPH_FILTER_KEYS) {
    const value = urlFilters[key];
    if (value !== undefined) (filters as Record<string, string>)[key] = value;
  }
  return filters;
}

/** Only a NON-default value is ever written to the URL — same "the URL
 *  only ever shows non-default values" convention the legacy `GraphView`
 *  already used for this exact field set (`FILTER_KEYS`'s doc comment),
 *  so a filter-free context keeps a clean, bookmarkable URL. */
export function urlFiltersFromGraphFilters(filters: GraphFilters): GraphUrlFilters {
  const urlFilters: GraphUrlFilters = {};
  for (const key of GRAPH_FILTER_KEYS) {
    const value = filters[key];
    const isDefault = value === DEFAULT_GRAPH_FILTERS[key];
    if (!isDefault) urlFilters[key] = value;
  }
  return urlFilters;
}
