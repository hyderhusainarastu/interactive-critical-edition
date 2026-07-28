import assert from "node:assert/strict";
import { graphFiltersFromUrlFilters, urlFiltersFromGraphFilters } from "./graphFiltersUrlAdapter";
import { DEFAULT_GRAPH_FILTERS } from "../graph/types";

/** `npx tsx apps/web/src/components/knowledge-map/graphFiltersUrlAdapter.test.ts` */

// --- graphFiltersFromUrlFilters ---
assert.deepEqual(graphFiltersFromUrlFilters({}), DEFAULT_GRAPH_FILTERS, "empty URL filters -> all defaults");
{
  const result = graphFiltersFromUrlFilters({ search: "aristotle", type: "work" });
  assert.equal(result.search, "aristotle");
  assert.equal(result.type, "work");
  assert.equal(result.state, "all", "unset keys keep their default");
}
console.log("graphFiltersFromUrlFilters: OK");

// --- urlFiltersFromGraphFilters ---
assert.deepEqual(urlFiltersFromGraphFilters(DEFAULT_GRAPH_FILTERS), {}, "all-default GraphFilters -> empty URL filters");
{
  const filters = { ...DEFAULT_GRAPH_FILTERS, search: "aristotle", credibilityBand: "high" as const };
  const urlFilters = urlFiltersFromGraphFilters(filters);
  assert.deepEqual(urlFilters, { search: "aristotle", credibilityBand: "high" }, "only non-default keys are written");
}
console.log("urlFiltersFromGraphFilters: OK");

// --- round-trip ---
{
  const original = { ...DEFAULT_GRAPH_FILTERS, search: "hylomorphism", type: "concept" as const, relation: "opposition" };
  const roundTripped = graphFiltersFromUrlFilters(urlFiltersFromGraphFilters(original));
  assert.deepEqual(roundTripped, original);
}
console.log("round-trip: OK");

console.log("graphFiltersUrlAdapter.test.ts: all assertions passed");
