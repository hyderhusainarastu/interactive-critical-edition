import { describe, expect, it } from "vitest";
import { graphFiltersFromUrlFilters, urlFiltersFromGraphFilters } from "./graphFiltersUrlAdapter";
import { DEFAULT_GRAPH_FILTERS } from "../graph/filterGraphData";

describe("graphFiltersFromUrlFilters", () => {
  it("empty URL filters -> all defaults", () => {
    expect(graphFiltersFromUrlFilters({})).toEqual(DEFAULT_GRAPH_FILTERS);
  });

  it("unset keys keep their default", () => {
    const result = graphFiltersFromUrlFilters({ search: "aristotle", type: "work" });
    expect(result.search).toBe("aristotle");
    expect(result.type).toBe("work");
    // unset keys keep their default
    expect(result.state).toBe("all");
  });
});

describe("urlFiltersFromGraphFilters", () => {
  it("all-default GraphFilters -> empty URL filters", () => {
    expect(urlFiltersFromGraphFilters(DEFAULT_GRAPH_FILTERS)).toEqual({});
  });

  it("only non-default keys are written", () => {
    const filters = { ...DEFAULT_GRAPH_FILTERS, search: "aristotle", credibilityBand: "high" as const };
    const urlFilters = urlFiltersFromGraphFilters(filters);
    expect(urlFilters).toEqual({ search: "aristotle", credibilityBand: "high" });
  });
});

describe("graphFiltersUrlAdapter round-trip", () => {
  // --- round-trip ---
  it("round-trips a non-default filter set unchanged", () => {
    const original = { ...DEFAULT_GRAPH_FILTERS, search: "hylomorphism", type: "concept" as const, relation: "opposition" };
    const roundTripped = graphFiltersFromUrlFilters(urlFiltersFromGraphFilters(original));
    expect(roundTripped).toEqual(original);
  });
});
