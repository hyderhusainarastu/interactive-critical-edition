import assert from "node:assert/strict";
import { shouldHandleEscape } from "./useDialogEscape";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `useFocusTrap.test.ts`).
 */

// --- only Escape closes, and only while the surface is active ------------
assert.equal(shouldHandleEscape("Escape", true), true);
assert.equal(shouldHandleEscape("Escape", false), false);
assert.equal(shouldHandleEscape("Enter", true), false);
assert.equal(shouldHandleEscape("Tab", true), false);
assert.equal(shouldHandleEscape("Escape", false), false);

console.log("useDialogEscape.test.ts: all assertions passed");
