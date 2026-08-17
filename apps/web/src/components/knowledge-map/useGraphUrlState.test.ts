import { describe, expect, it } from "vitest";
import type { GraphUrlState } from "@ice/graph-display";
import {
  buildGraphUrlHref,
  defaultOpenContextState,
  mergeGraphUrlStatePatch,
  parseGraphUrlStateOrNull,
  PERMISSIVE_RECONSTRUCTION_VALIDATORS,
} from "./useGraphUrlState";

/** Covers the pure layer only, per this file's own doc comment on why
 *  the React-binding layer is not unit-tested here. */

const baseState: GraphUrlState = {
  context: { kind: "work", id: "w1" },
  view: "3d",
  selectedId: null,
  activeLayers: [],
  filters: {},
  expansionTrail: [],
  focus: "all",
};

describe("buildGraphUrlHref", () => {
  it("writes the context into the query string and round-trips through the real codec", () => {
    const href = buildGraphUrlHref("/graph", baseState);
    expect(href.startsWith("/graph?")).toBeTruthy();
    expect(href.includes("ctxKind=work")).toBeTruthy();
    expect(href.includes("ctxId=w1")).toBeTruthy();
    // Round-trips through the real codec (not re-derived here).
    const url = new URL(href, "https://example.test");
    const reparsed = parseGraphUrlStateOrNull(url.searchParams);
    expect(reparsed).toEqual(baseState);
  });
});

describe("mergeGraphUrlStatePatch", () => {
  it("applies the patch, leaves unpatched fields unchanged, and never mutates the input", () => {
    const patched = mergeGraphUrlStatePatch(baseState, { view: "2d", selectedId: "n1" as never });
    expect(patched.view).toBe("2d");
    expect(patched.selectedId).toBe("n1");
    // unpatched fields survive unchanged
    expect(patched.context).toEqual(baseState.context);
    // Pure: does not mutate the input.
    expect(baseState.view).toBe("3d");
  });
});

describe("defaultOpenContextState", () => {
  it("opens a context with the documented default state", () => {
    const opened = defaultOpenContextState({ kind: "claim", id: "c1" });
    expect(opened).toEqual({
      context: { kind: "claim", id: "c1" },
      view: "3d",
      selectedId: null,
      activeLayers: [],
      filters: {},
      expansionTrail: [],
      focus: "all",
    });
  });

  it("honors explicit view/focus overrides", () => {
    const opened = defaultOpenContextState({ kind: "work", id: "w2" }, { view: "list", focus: "neighborhood" });
    expect(opened.view).toBe("list");
    expect(opened.focus).toBe("neighborhood");
    expect(opened.context).toEqual({ kind: "work", id: "w2" });
  });
});

describe("parseGraphUrlStateOrNull", () => {
  // --- parseGraphUrlStateOrNull: null on missing/malformed context, never throws ---
  it("returns null on a missing/malformed context and never throws", () => {
    // bare URL -> null, not a throw
    expect(parseGraphUrlStateOrNull(new URLSearchParams())).toBe(null);
    // unrecognized kind -> null
    expect(parseGraphUrlStateOrNull(new URLSearchParams("ctxKind=bogus&ctxId=x"))).toBe(null);
    // missing ctxId -> null
    expect(parseGraphUrlStateOrNull(new URLSearchParams("ctxKind=work"))).toBe(null);
    const ok = parseGraphUrlStateOrNull(new URLSearchParams("ctxKind=work&ctxId=w1"));
    expect(ok !== null).toBeTruthy();
    expect(ok!.context).toEqual({ kind: "work", id: "w1" });
  });
});

describe("PERMISSIVE_RECONSTRUCTION_VALIDATORS", () => {
  // --- PERMISSIVE_RECONSTRUCTION_VALIDATORS: everything is valid ---
  it("treats everything as valid", () => {
    expect(PERMISSIVE_RECONSTRUCTION_VALIDATORS.checkContext({ kind: "work", id: "anything" })).toBe(null);
    expect(PERMISSIVE_RECONSTRUCTION_VALIDATORS.checkExpansionId("anything" as never)).toBe(null);
    expect(PERMISSIVE_RECONSTRUCTION_VALIDATORS.checkSelectedId("anything" as never)).toBe(null);
  });
});
