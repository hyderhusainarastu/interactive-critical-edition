import assert from "node:assert/strict";
import { topmostTransientUiKind } from "./escapeStack";

/** `npx tsx apps/web/src/components/knowledge-map/escapeStack.test.ts` */

assert.equal(topmostTransientUiKind({ filtersOpen: false, helpOpen: false, inspectorOpen: false }), null);
assert.equal(topmostTransientUiKind({ filtersOpen: true, helpOpen: true, inspectorOpen: true }), "filters", "filters wins over everything");
assert.equal(topmostTransientUiKind({ filtersOpen: false, helpOpen: true, inspectorOpen: true }), "help", "help wins over inspector");
assert.equal(topmostTransientUiKind({ filtersOpen: false, helpOpen: false, inspectorOpen: true }), "inspector", "inspector is the last resort");

console.log("topmostTransientUiKind: OK");
console.log("escapeStack.test.ts: all assertions passed");
