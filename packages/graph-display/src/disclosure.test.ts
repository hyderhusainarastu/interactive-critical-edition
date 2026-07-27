import { describe, expect, it } from "vitest";
import {
  EXPANSION_CAP,
  INITIAL_NEIGHBOR_CAP,
  VISIBLE_CAP,
  buildAggregateNodes,
  enforceVisibleCap,
  expandNeighborhood,
  initialNeighborhood,
  selectPrioritized,
  type DisclosureCandidate,
} from "./disclosure";
import { makeNode } from "./testFixtures";

function candidate(
  id: string,
  opts: Partial<Omit<DisclosureCandidate, "node">> = {},
): DisclosureCandidate {
  return {
    node: makeNode(id, "reference"),
    directVerifiedEvidenceAnchored: false,
    confidence: null,
    ...opts,
  };
}

function candidates(n: number, prefix = "n"): DisclosureCandidate[] {
  // Ids padded so lexicographic tie-break order is predictable and stable
  // regardless of n's magnitude.
  return Array.from({ length: n }, (_, i) => candidate(`${prefix}${String(i).padStart(5, "0")}`));
}

describe("selectPrioritized — priority ordering", () => {
  it("puts direct-verified-evidence-anchored candidates before all others", () => {
    const c = [
      candidate("low-priority", { directVerifiedEvidenceAnchored: false, confidence: 0.99 }),
      candidate("high-priority", { directVerifiedEvidenceAnchored: true, confidence: 0.01 }),
    ];
    const { visible } = selectPrioritized(c, 1);
    expect(visible[0].id).toBe("high-priority");
  });

  it("within the same anchoring tier, orders by confidence descending", () => {
    const c = [
      candidate("mid", { confidence: 0.5 }),
      candidate("high", { confidence: 0.9 }),
      candidate("low", { confidence: 0.1 }),
    ];
    const { visible } = selectPrioritized(c, 3);
    expect(visible.map((n) => n.id)).toEqual(["high", "mid", "low"]);
  });

  it("null confidence sorts after every candidate with a real confidence value, never as if it were 0", () => {
    const c = [
      candidate("has-zero-confidence", { confidence: 0 }),
      candidate("has-no-confidence", { confidence: null }),
    ];
    const { visible } = selectPrioritized(c, 2);
    expect(visible.map((n) => n.id)).toEqual(["has-zero-confidence", "has-no-confidence"]);
  });

  it("ties break on stable id order, independent of input order", () => {
    const forward = [candidate("b"), candidate("a"), candidate("c")];
    const backward = [candidate("c"), candidate("a"), candidate("b")];
    expect(selectPrioritized(forward, 3).visible.map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(selectPrioritized(backward, 3).visible.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("never mutates the input candidates array", () => {
    const c = candidates(5);
    const snapshot = c.map((x) => x.node.id);
    selectPrioritized(c, 2);
    expect(c.map((x) => x.node.id)).toEqual(snapshot);
  });

  it("hidden + visible together account for every candidate exactly once", () => {
    const c = candidates(30);
    const { visible, hidden } = selectPrioritized(c, 12);
    expect(visible.length).toBe(12);
    expect(hidden.length).toBe(18);
    const allIds = new Set([...visible, ...hidden].map((n) => n.id));
    expect(allIds.size).toBe(30);
  });
});

describe("initialNeighborhood — boundary fixtures", () => {
  const root = makeNode("root", "work", { layer: "intellectual" });

  it.each([
    ["mobile" as const, 11, 11, 0],
    ["mobile" as const, 12, 12, 0],
    ["mobile" as const, 13, 12, 1],
    ["desktop" as const, 23, 23, 0],
    ["desktop" as const, 24, 24, 0],
    ["desktop" as const, 25, 24, 1],
  ])("device=%s, %i candidates -> %i visible neighbors, %i hidden", (device, count, expectedVisible, expectedHidden) => {
    const { visible, hidden } = initialNeighborhood(root, candidates(count), device);
    // visible always includes the root plus up to the cap of neighbors.
    expect(visible.length).toBe(1 + expectedVisible);
    expect(visible[0].id).toBe("root");
    expect(hidden.length).toBe(expectedHidden);
  });

  it("root is never counted against the neighbor cap and never appears in hidden", () => {
    const { visible, hidden } = initialNeighborhood(root, candidates(INITIAL_NEIGHBOR_CAP.desktop + 50), "desktop");
    expect(visible[0].id).toBe("root");
    expect(hidden.some((n) => n.id === "root")).toBe(false);
  });
});

describe("expandNeighborhood — bounded to 20 per explicit expansion", () => {
  it("caps a single expansion at EXPANSION_CAP (20)", () => {
    expect(EXPANSION_CAP).toBe(20);
    const { visible, hidden } = expandNeighborhood(candidates(35));
    expect(visible.length).toBe(20);
    expect(hidden.length).toBe(15);
  });

  it("does not cap an expansion smaller than the limit", () => {
    const { visible, hidden } = expandNeighborhood(candidates(5));
    expect(visible.length).toBe(5);
    expect(hidden.length).toBe(0);
  });
});

describe("enforceVisibleCap — boundary fixtures", () => {
  it.each([
    ["mobile" as const, 59, 59, 0],
    ["mobile" as const, 60, 60, 0],
    ["mobile" as const, 61, 60, 1],
    ["desktop" as const, 119, 119, 0],
    ["desktop" as const, 120, 120, 0],
    ["desktop" as const, 121, 120, 1],
  ])("device=%s, %i accumulated -> %i visible, %i hidden", (device, count, expectedVisible, expectedHidden) => {
    const { visible, hidden } = enforceVisibleCap(candidates(count), device);
    expect(visible.length).toBe(expectedVisible);
    expect(hidden.length).toBe(expectedHidden);
  });

  it("VISIBLE_CAP matches the charter exactly", () => {
    expect(VISIBLE_CAP).toEqual({ desktop: 120, mobile: 60 });
  });

  it("a root candidate always survives the visible cap even at the lowest priority", () => {
    const rootCandidate: DisclosureCandidate = {
      node: makeNode("root", "work"),
      directVerifiedEvidenceAnchored: false,
      confidence: null,
      isRoot: true,
    };
    const rest = candidates(VISIBLE_CAP.mobile + 10).map((c) => ({ ...c, directVerifiedEvidenceAnchored: true, confidence: 1 }));
    const { visible } = enforceVisibleCap([rootCandidate, ...rest], "mobile");
    expect(visible.some((n) => n.id === "root")).toBe(true);
  });
});

describe("buildAggregateNodes — deterministic 'N more <kind>' aggregation", () => {
  it("groups hidden nodes by displayKind and every basisId is accounted for exactly once", () => {
    const hidden = [
      makeNode("r1", "reference"),
      makeNode("r2", "reference"),
      makeNode("r3", "reference"),
      makeNode("c1", "concept"),
    ];
    const { aggregates } = buildAggregateNodes(hidden, { rule: "initial-disclosure", version: "1" });
    expect(aggregates.length).toBe(2);
    const referenceAggregate = aggregates.find((a) => a.label.includes("reference"))!;
    expect(referenceAggregate.label).toBe("3 more references");
    expect(referenceAggregate.projection).not.toBeNull();
    expect([...referenceAggregate.projection!.basisIds].sort()).toEqual(["r1", "r2", "r3"].sort());

    const conceptAggregate = aggregates.find((a) => a.label.includes("concept"))!;
    expect(conceptAggregate.label).toBe("1 more concepts");
    expect(conceptAggregate.projection!.basisIds).toEqual(["c1"]);

    // Every hidden node id appears in exactly one aggregate's basisIds —
    // "never silently drop hidden nodes."
    const allBasisIds = aggregates.flatMap((a) => a.projection!.basisIds);
    expect([...allBasisIds].sort()).toEqual(hidden.map((n) => n.id).sort());
  });

  it("aggregate nodes carry displayKind 'aggregate' and the layer of their (homogeneous) basis", () => {
    const hidden = [makeNode("claim1", "claim", { layer: "claim" }), makeNode("claim2", "claim", { layer: "claim" })];
    const { aggregates } = buildAggregateNodes(hidden, { rule: "expand", version: "1" });
    expect(aggregates[0].displayKind).toBe("aggregate");
    expect(aggregates[0].layer).toBe("claim");
  });

  it("aggregate projection records rule and version", () => {
    const hidden = [makeNode("x", "reference")];
    const { aggregates } = buildAggregateNodes(hidden, { rule: "visible-cap", version: "2024-07-27" });
    expect(aggregates[0].projection).toEqual({ basisIds: ["x"], rule: "visible-cap", version: "2024-07-27" });
  });

  it("id is deterministic and stable across rebuilds from the same rule+kind, changing only with the basis", () => {
    const first = buildAggregateNodes([makeNode("a", "reference")], { rule: "r", version: "1" });
    const second = buildAggregateNodes([makeNode("a", "reference"), makeNode("b", "reference")], { rule: "r", version: "2" });
    expect(first.aggregates[0].id).toBe(second.aggregates[0].id);
    expect(second.aggregates[0].label).toBe("2 more references");
  });

  it("flags (rather than silently picks) a layer mismatch within one kind group", () => {
    const hidden = [makeNode("a", "reference", { layer: "intellectual" }), makeNode("b", "reference", { layer: "evidence" })];
    const { layerMismatchDiagnostics } = buildAggregateNodes(hidden, { rule: "r", version: "1" });
    expect(layerMismatchDiagnostics.length).toBe(1);
    expect(layerMismatchDiagnostics[0].kind).toBe("reference");
  });

  it("empty hidden list produces no aggregates", () => {
    expect(buildAggregateNodes([], { rule: "r", version: "1" }).aggregates).toEqual([]);
  });

  it("a caller-supplied labelForKind overrides the default plural", () => {
    const { aggregates } = buildAggregateNodes([makeNode("x", "peer_reviewed_source")], {
      rule: "r",
      version: "1",
      labelForKind: () => "sources",
    });
    expect(aggregates[0].label).toBe("1 more sources");
  });

  it("iteration order is deterministic (alphabetical by kind) regardless of input order", () => {
    const hidden = [makeNode("z", "section"), makeNode("a", "concept")];
    const { aggregates: first } = buildAggregateNodes(hidden, { rule: "r", version: "1" });
    const { aggregates: second } = buildAggregateNodes([...hidden].reverse(), { rule: "r", version: "1" });
    expect(first.map((a) => a.id)).toEqual(second.map((a) => a.id));
  });
});
