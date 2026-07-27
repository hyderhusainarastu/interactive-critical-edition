import assert from "node:assert/strict";
import { resolveFocusTrapAction } from "./useFocusTrap";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `chartGeometry.test.ts`/`navItems.test.ts` — apps/web has no vitest/DOM
 * runner wired, so the focus-trap's actual Tab-wrap decision is tested as a
 * pure function taking (focusableCount, activeIndex, shiftKey) rather than
 * against a real `useFocusTrap` + jsdom).
 */

// --- empty container: always retreat to the container itself -------------
assert.equal(resolveFocusTrapAction(0, -1, false), "focus-container");
assert.equal(resolveFocusTrapAction(0, -1, true), "focus-container");

// --- forward Tab from the last focusable wraps to the first --------------
assert.equal(resolveFocusTrapAction(3, 2, false), "wrap-to-first");
assert.equal(resolveFocusTrapAction(1, 0, false), "wrap-to-first"); // single-item trap: last === first

// --- Shift+Tab from the first focusable wraps to the last ----------------
assert.equal(resolveFocusTrapAction(3, 0, true), "wrap-to-last");
assert.equal(resolveFocusTrapAction(1, 0, true), "wrap-to-last");

// --- everywhere else in the middle: let the browser move focus normally --
assert.equal(resolveFocusTrapAction(3, 1, false), "allow-default");
assert.equal(resolveFocusTrapAction(3, 1, true), "allow-default");

// --- focus outside the tracked list (activeIndex -1, non-empty trap): not
// at either edge, so don't intervene -------------------------------------
assert.equal(resolveFocusTrapAction(3, -1, false), "allow-default");
assert.equal(resolveFocusTrapAction(3, -1, true), "allow-default");

console.log("useFocusTrap.test.ts: all assertions passed");
