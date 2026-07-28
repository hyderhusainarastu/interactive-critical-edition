import assert from "node:assert/strict";
import type { GraphUrlState } from "@ice/graph-display";
import {
  buildGraphUrlHref,
  defaultOpenContextState,
  mergeGraphUrlStatePatch,
  parseGraphUrlStateOrNull,
  PERMISSIVE_RECONSTRUCTION_VALIDATORS,
} from "./useGraphUrlState";

/** `npx tsx apps/web/src/components/knowledge-map/useGraphUrlState.test.ts`
 *  — covers the pure layer only, per this file's own doc comment on why
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

// --- buildGraphUrlHref ---
{
  const href = buildGraphUrlHref("/graph", baseState);
  assert.ok(href.startsWith("/graph?"));
  assert.ok(href.includes("ctxKind=work"));
  assert.ok(href.includes("ctxId=w1"));
  // Round-trips through the real codec (not re-derived here).
  const url = new URL(href, "https://example.test");
  const reparsed = parseGraphUrlStateOrNull(url.searchParams);
  assert.deepEqual(reparsed, baseState);
}
console.log("buildGraphUrlHref: OK");

// --- mergeGraphUrlStatePatch ---
{
  const patched = mergeGraphUrlStatePatch(baseState, { view: "2d", selectedId: "n1" as never });
  assert.equal(patched.view, "2d");
  assert.equal(patched.selectedId, "n1");
  assert.deepEqual(patched.context, baseState.context, "unpatched fields survive unchanged");
  // Pure: does not mutate the input.
  assert.equal(baseState.view, "3d");
}
console.log("mergeGraphUrlStatePatch: OK");

// --- defaultOpenContextState ---
{
  const opened = defaultOpenContextState({ kind: "claim", id: "c1" });
  assert.deepEqual(opened, {
    context: { kind: "claim", id: "c1" },
    view: "3d",
    selectedId: null,
    activeLayers: [],
    filters: {},
    expansionTrail: [],
    focus: "all",
  });
}
{
  const opened = defaultOpenContextState({ kind: "work", id: "w2" }, { view: "list", focus: "neighborhood" });
  assert.equal(opened.view, "list");
  assert.equal(opened.focus, "neighborhood");
  assert.deepEqual(opened.context, { kind: "work", id: "w2" });
}
console.log("defaultOpenContextState: OK");

// --- parseGraphUrlStateOrNull: null on missing/malformed context, never throws ---
{
  assert.equal(parseGraphUrlStateOrNull(new URLSearchParams()), null, "bare URL -> null, not a throw");
  assert.equal(parseGraphUrlStateOrNull(new URLSearchParams("ctxKind=bogus&ctxId=x")), null, "unrecognized kind -> null");
  assert.equal(parseGraphUrlStateOrNull(new URLSearchParams("ctxKind=work")), null, "missing ctxId -> null");
  const ok = parseGraphUrlStateOrNull(new URLSearchParams("ctxKind=work&ctxId=w1"));
  assert.ok(ok !== null);
  assert.deepEqual(ok!.context, { kind: "work", id: "w1" });
}
console.log("parseGraphUrlStateOrNull: OK");

// --- PERMISSIVE_RECONSTRUCTION_VALIDATORS: everything is valid ---
{
  assert.equal(PERMISSIVE_RECONSTRUCTION_VALIDATORS.checkContext({ kind: "work", id: "anything" }), null);
  assert.equal(PERMISSIVE_RECONSTRUCTION_VALIDATORS.checkExpansionId("anything" as never), null);
  assert.equal(PERMISSIVE_RECONSTRUCTION_VALIDATORS.checkSelectedId("anything" as never), null);
}
console.log("PERMISSIVE_RECONSTRUCTION_VALIDATORS: OK");

console.log("useGraphUrlState.test.ts: all assertions passed");
