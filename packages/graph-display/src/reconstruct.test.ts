import { describe, expect, it } from "vitest";
import { EXPANSION_CAP } from "./disclosure";
import { toDisplayNodeId, type DisplayNodeId } from "./ids";
import type { OmittedReason, ValidityCheck } from "./omission";
import {
  reconcileSelectedId,
  reconstructGraphUrlState,
  recreateAggregatesFromBasis,
  replayExpansionTrail,
  rebuildContext,
} from "./reconstruct";
import { parseGraphUrlState, serializeGraphUrlState } from "./urlStateCodec";
import type { GraphUrlContext, GraphUrlState } from "./urlState";
import { makeNode } from "./testFixtures";

const allowAll: ValidityCheck<unknown> = () => null;
const rejectAll = (reason: OmittedReason): ValidityCheck<unknown> => () => reason;

describe("rebuildContext", () => {
  it("keeps a valid context unchanged and reports no omission", () => {
    const context: GraphUrlContext = { kind: "work", id: "w1" };
    const result = rebuildContext(context, allowAll);
    expect(result).toEqual({ context, contextValid: true, omitted: [] });
  });

  it("flags an unauthorized context and reports why", () => {
    const context: GraphUrlContext = { kind: "work", id: "w1" };
    const result = rebuildContext(context, rejectAll("unauthorized"));
    expect(result.contextValid).toBe(false);
    expect(result.omitted).toEqual([{ value: "w1", reason: "unauthorized", source: "context" }]);
    // The context itself is still returned (deterministic rebuild of what
    // WAS asked for) — it's the caller's job to route to a chooser when
    // contextValid is false, not this function's.
    expect(result.context).toEqual(context);
  });
});

describe("replayExpansionTrail", () => {
  it("replays every valid id in order", () => {
    const trail = [toDisplayNodeId("a"), toDisplayNodeId("b"), toDisplayNodeId("c")];
    const result = replayExpansionTrail(trail, allowAll);
    expect(result.expansionTrail.map(String)).toEqual(["a", "b", "c"]);
    expect(result.omitted).toEqual([]);
  });

  it("drops invalid ids with a reason while preserving the rest, in order", () => {
    const trail = [toDisplayNodeId("a"), toDisplayNodeId("deleted-one"), toDisplayNodeId("c")];
    const check: ValidityCheck<DisplayNodeId> = (id) => (String(id) === "deleted-one" ? "deleted" : null);
    const result = replayExpansionTrail(trail, check);
    expect(result.expansionTrail.map(String)).toEqual(["a", "c"]);
    expect(result.omitted).toEqual([{ value: "deleted-one", reason: "deleted", source: "expansionTrail" }]);
  });

  it("caps replay at EXPANSION_CAP, marking the overflow as over_cap", () => {
    const trail = Array.from({ length: EXPANSION_CAP + 3 }, (_, i) => toDisplayNodeId(`id-${i}`));
    const result = replayExpansionTrail(trail, allowAll);
    expect(result.expansionTrail).toHaveLength(EXPANSION_CAP);
    expect(result.expansionTrail.map(String)).toEqual(trail.slice(0, EXPANSION_CAP).map(String));
    expect(result.omitted).toHaveLength(3);
    expect(result.omitted.every((o) => o.reason === "over_cap")).toBe(true);
  });

  it("does not silently drop an invalid id past the cap — reports its own real reason, not over_cap", () => {
    // A trail already at the cap where entry #3 (within range) is invalid:
    // its own reason wins even though later entries push the tail over.
    const trail = Array.from({ length: EXPANSION_CAP }, (_, i) => toDisplayNodeId(`id-${i}`));
    const check: ValidityCheck<DisplayNodeId> = (id) => (String(id) === "id-3" ? "not_found" : null);
    const result = replayExpansionTrail(trail, check);
    expect(result.expansionTrail).toHaveLength(EXPANSION_CAP - 1);
    expect(result.omitted).toEqual([{ value: "id-3", reason: "not_found", source: "expansionTrail" }]);
  });
});

describe("reconcileSelectedId", () => {
  it("keeps a null selection as null with no omission", () => {
    expect(reconcileSelectedId(null, allowAll)).toEqual({ selectedId: null, omitted: [] });
  });

  it("keeps a valid selection", () => {
    const id = toDisplayNodeId("n1");
    expect(reconcileSelectedId(id, allowAll)).toEqual({ selectedId: id, omitted: [] });
  });

  it("nulls out and reports an invalid selection", () => {
    const id = toDisplayNodeId("n1");
    const result = reconcileSelectedId(id, rejectAll("invalid"));
    expect(result.selectedId).toBeNull();
    expect(result.omitted).toEqual([{ value: "n1", reason: "invalid", source: "selected" }]);
  });
});

describe("recreateAggregatesFromBasis", () => {
  it("always computes from the CURRENT basis passed in — there is no parameter for a stale count to hide in", () => {
    const hidden = [makeNode("h1", "reference"), makeNode("h2", "reference"), makeNode("h3", "concept")];
    const result = recreateAggregatesFromBasis(hidden, { rule: "hidden-by-kind", version: "v1" });
    const referenceAggregate = result.aggregates.find((a) => a.label.includes("references"));
    expect(referenceAggregate?.label).toBe("2 more references");
    // Calling again with a DIFFERENT current basis produces a DIFFERENT
    // result — proving nothing was cached/trusted from the first call.
    const smallerHidden = [makeNode("h1", "reference")];
    const result2 = recreateAggregatesFromBasis(smallerHidden, { rule: "hidden-by-kind", version: "v1" });
    const referenceAggregate2 = result2.aggregates.find((a) => a.label.includes("reference"));
    expect(referenceAggregate2?.label).toBe("1 more references");
  });
});

describe("reconstructGraphUrlState — full integration", () => {
  const baseState: GraphUrlState = {
    context: { kind: "work", id: "w1" },
    view: "3d",
    selectedId: toDisplayNodeId("sel-1"),
    activeLayers: ["evidence", "claim"],
    filters: { search: "vico" },
    expansionTrail: [toDisplayNodeId("e1"), toDisplayNodeId("e2")],
    focus: "neighborhood",
  };

  it("Back/Forward reconstructs an identical context, expansion trail, focus, selection, layers, and filters when everything is still valid", () => {
    const roundTripped = parseGraphUrlState(serializeGraphUrlState(baseState));
    const result = reconstructGraphUrlState(roundTripped, {
      checkContext: allowAll,
      checkExpansionId: allowAll,
      checkSelectedId: allowAll,
    });
    expect(result.context).toEqual(baseState.context);
    expect(result.contextValid).toBe(true);
    expect(result.expansionTrail.map(String)).toEqual(["e1", "e2"]);
    expect(result.focus).toBe("neighborhood");
    expect(String(result.selectedId)).toBe("sel-1");
    expect(result.activeLayers).toEqual(["evidence", "claim"]);
    expect(result.filters).toEqual({ search: "vico" });
    expect(result.omitted).toEqual([]);
  });

  it("preserves the rest of the state when one expansion id and the selection are no longer valid", () => {
    const checkExpansionId: ValidityCheck<DisplayNodeId> = (id) => (String(id) === "e2" ? "deleted" : null);
    const result = reconstructGraphUrlState(baseState, {
      checkContext: allowAll,
      checkExpansionId,
      checkSelectedId: rejectAll("unauthorized"),
    });
    expect(result.expansionTrail.map(String)).toEqual(["e1"]);
    expect(result.selectedId).toBeNull();
    // Everything else survives untouched.
    expect(result.context).toEqual(baseState.context);
    expect(result.focus).toBe(baseState.focus);
    expect(result.filters).toEqual(baseState.filters);
    expect(result.activeLayers).toEqual(baseState.activeLayers);
    expect(result.omitted).toEqual(
      expect.arrayContaining([
        { value: "e2", reason: "deleted", source: "expansionTrail" },
        { value: "sel-1", reason: "unauthorized", source: "selected" },
      ]),
    );
    expect(result.omitted).toHaveLength(2);
  });

  it("flags an invalid context but still preserves filters/layers/focus for the caller to reuse in a chooser", () => {
    const result = reconstructGraphUrlState(baseState, {
      checkContext: rejectAll("deleted"),
      checkExpansionId: allowAll,
      checkSelectedId: allowAll,
    });
    expect(result.contextValid).toBe(false);
    expect(result.filters).toEqual(baseState.filters);
    expect(result.activeLayers).toEqual(baseState.activeLayers);
    expect(result.focus).toBe(baseState.focus);
  });
});
