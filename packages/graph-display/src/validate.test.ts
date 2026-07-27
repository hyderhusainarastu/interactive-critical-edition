import { describe, expect, it } from "vitest";
import { assertNotMutated, CanonicalMutationError, deepFreeze, validateDisplayGraph } from "./validate";
import { toDisplayNodeId } from "./ids";
import { makeLink, makeNode } from "./testFixtures";

describe("validateDisplayGraph — structural invariants", () => {
  it("returns no diagnostics for a well-formed graph", () => {
    const a = makeNode("a", "work");
    const b = makeNode("b", "reference");
    const link = makeLink("a|cites|b", a.id, b.id, "reference");
    expect(validateDisplayGraph([a, b], [link])).toEqual([]);
  });

  it("flags a duplicate node id", () => {
    const a1 = makeNode("dup", "work");
    const a2 = makeNode("dup", "reference");
    const diagnostics = validateDisplayGraph([a1, a2], []);
    expect(diagnostics.some((d) => d.code === "duplicate_node_id" && d.severity === "error")).toBe(true);
  });

  it("flags a duplicate link id", () => {
    const a = makeNode("a", "work");
    const b = makeNode("b", "reference");
    const l1 = makeLink("dup", a.id, b.id, "reference");
    const l2 = makeLink("dup", a.id, b.id, "influence");
    const diagnostics = validateDisplayGraph([a, b], [l1, l2]);
    expect(diagnostics.some((d) => d.code === "duplicate_link_id" && d.severity === "error")).toBe(true);
  });

  it("flags a dangling source and a dangling target independently", () => {
    const a = makeNode("a", "work");
    const link = makeLink("l1", toDisplayNodeId("ghost-source"), a.id, "reference");
    const diagnostics = validateDisplayGraph([a], [link]);
    expect(diagnostics.some((d) => d.code === "dangling_source")).toBe(true);
    expect(diagnostics.some((d) => d.code === "dangling_target")).toBe(false);

    const link2 = makeLink("l2", a.id, toDisplayNodeId("ghost-target"), "reference");
    const diagnostics2 = validateDisplayGraph([a], [link2]);
    expect(diagnostics2.some((d) => d.code === "dangling_target")).toBe(true);
    expect(diagnostics2.some((d) => d.code === "dangling_source")).toBe(false);
  });

  it("flags a self-link", () => {
    const a = makeNode("a", "work");
    const link = makeLink("self", a.id, a.id, "reference");
    const diagnostics = validateDisplayGraph([a], [link]);
    expect(diagnostics.some((d) => d.code === "self_link" && d.severity === "error")).toBe(true);
  });

  it("flags parallel links as a warning, not an error — two real relationships can connect the same pair", () => {
    const a = makeNode("a", "work");
    const b = makeNode("b", "reference");
    const l1 = makeLink("l1", a.id, b.id, "reference");
    const l2 = makeLink("l2", a.id, b.id, "prerequisite");
    const diagnostics = validateDisplayGraph([a, b], [l1, l2]);
    const parallel = diagnostics.find((d) => d.code === "parallel_link");
    expect(parallel).toBeDefined();
    expect(parallel!.severity).toBe("warning");
  });

  it("detects a parallel pair regardless of which endpoint is listed as source vs target", () => {
    const a = makeNode("a", "work");
    const b = makeNode("b", "reference");
    const l1 = makeLink("l1", a.id, b.id, "reference");
    const l2 = makeLink("l2", b.id, a.id, "opposition");
    const diagnostics = validateDisplayGraph([a, b], [l1, l2]);
    expect(diagnostics.some((d) => d.code === "parallel_link")).toBe(true);
  });

  it("does not flag two links between different pairs as parallel", () => {
    const a = makeNode("a", "work");
    const b = makeNode("b", "reference");
    const c = makeNode("c", "concept");
    const l1 = makeLink("l1", a.id, b.id, "reference");
    const l2 = makeLink("l2", a.id, c.id, "influence");
    const diagnostics = validateDisplayGraph([a, b, c], [l1, l2]);
    expect(diagnostics.some((d) => d.code === "parallel_link")).toBe(false);
  });

  it("handles empty node/link lists without throwing", () => {
    expect(validateDisplayGraph([], [])).toEqual([]);
  });

  it("reports every diagnostic found, not just the first", () => {
    const a = makeNode("a", "work");
    const dup = makeNode("a", "reference"); // duplicate node id
    const link = makeLink("l1", toDisplayNodeId("ghost"), toDisplayNodeId("also-ghost"), "reference"); // dangling both ends
    const diagnostics = validateDisplayGraph([a, dup], [link]);
    expect(diagnostics.length).toBeGreaterThanOrEqual(3);
  });
});

describe("deepFreeze / assertNotMutated — canonical immutability", () => {
  it("deep-freezes nested objects and arrays", () => {
    const payload = { nodes: [{ id: "a", nested: { x: 1 } }], links: [] };
    deepFreeze(payload);
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.nodes)).toBe(true);
    expect(Object.isFrozen(payload.nodes[0])).toBe(true);
    expect(Object.isFrozen(payload.nodes[0].nested)).toBe(true);
  });

  it("a frozen payload throws (strict mode) on a mutation attempt, proving the adapter cannot silently mutate it", () => {
    const payload = deepFreeze({ nodes: [{ id: "a" }] });
    expect(() => {
      // deepFreeze does not change the compile-time type to readonly (only
      // the runtime object) — this assignment type-checks fine and throws
      // a real strict-mode TypeError at runtime, which is exactly what's
      // under test here.
      payload.nodes[0].id = "mutated";
    }).toThrow(TypeError);
  });

  it("is idempotent — freezing an already-frozen value does not throw", () => {
    const payload = deepFreeze({ a: 1 });
    expect(() => deepFreeze(payload)).not.toThrow();
  });

  it("returns the same reference for chaining", () => {
    const payload = { a: 1 };
    expect(deepFreeze(payload)).toBe(payload);
  });

  it("handles primitives and null without throwing", () => {
    expect(deepFreeze(5)).toBe(5);
    expect(deepFreeze("x")).toBe("x");
    expect(deepFreeze(null)).toBeNull();
  });

  it("assertNotMutated passes when nothing changed", () => {
    const payload = { a: 1, b: [1, 2, 3] };
    const snapshot = JSON.stringify(payload);
    expect(() => assertNotMutated(payload, snapshot)).not.toThrow();
  });

  it("assertNotMutated throws CanonicalMutationError when the value changed", () => {
    const payload: { a: number } = { a: 1 };
    const snapshot = JSON.stringify(payload);
    payload.a = 2;
    expect(() => assertNotMutated(payload, snapshot, "payload.a")).toThrow(CanonicalMutationError);
  });
});
