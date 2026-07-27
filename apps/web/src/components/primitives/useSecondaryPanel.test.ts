import assert from "node:assert/strict";
import { secondaryPanelReducer } from "./useSecondaryPanel";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `useFocusTrap.test.ts`). Covers the charter's "never show more than one
 * secondary drawer or bottom sheet on mobile" requirement (redesign-shell-
 * spec.md §3.4) as a pure reducer, since the whole enforcement mechanism is
 * "there is exactly one `openId` slot" — no DOM/React needed to prove it.
 */

// --- opening from nothing open -------------------------------------------
assert.equal(secondaryPanelReducer(null, { type: "open", id: "preferences" }), "preferences");

// --- one-at-a-time: opening a second panel supersedes the first without a
// separate "close the old one" step ---------------------------------------
assert.equal(secondaryPanelReducer("preferences", { type: "open", id: "profile" }), "profile");
assert.equal(secondaryPanelReducer("profile", { type: "open", id: "rag" }), "rag");
// Opening the SAME id again is a no-op in effect (still just that id).
assert.equal(secondaryPanelReducer("preferences", { type: "open", id: "preferences" }), "preferences");

// --- closing the panel that currently owns the slot clears it ------------
assert.equal(secondaryPanelReducer("profile", { type: "close", id: "profile" }), null);

// --- a stale close from a panel that has already been superseded must NOT
// close whatever is open now — this is the core "can't reintroduce the bug"
// guarantee: an old panel's own unmount/close effect firing late can never
// clobber a newer panel's open state ---------------------------------------
assert.equal(secondaryPanelReducer("profile", { type: "close", id: "preferences" }), "profile");

// --- closing when nothing is open is a no-op ------------------------------
assert.equal(secondaryPanelReducer(null, { type: "close", id: "preferences" }), null);

console.log("useSecondaryPanel.test.ts: all assertions passed");
