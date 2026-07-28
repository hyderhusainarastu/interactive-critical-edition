import assert from "node:assert/strict";
import { DEFAULT_WIDE_PANEL_STATE, toggleWidePanel } from "./panelState";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `useFocusTrap.test.ts`/`useDialogEscape.test.ts` — `apps/web` has no
 * vitest/DOM runner wired, so this pure reducer is tested as a plain
 * function).
 */

// --- toggling one panel never touches the other ---------------------------
assert.deepEqual(toggleWidePanel(DEFAULT_WIDE_PANEL_STATE, "sources"), { sources: false, citations: true });
assert.deepEqual(toggleWidePanel(DEFAULT_WIDE_PANEL_STATE, "citations"), { sources: true, citations: false });

// --- toggling twice returns to the original state --------------------------
assert.deepEqual(
  toggleWidePanel(toggleWidePanel(DEFAULT_WIDE_PANEL_STATE, "sources"), "sources"),
  DEFAULT_WIDE_PANEL_STATE,
);

// --- both collapsed is reachable and independent ---------------------------
const bothCollapsed = toggleWidePanel(toggleWidePanel(DEFAULT_WIDE_PANEL_STATE, "sources"), "citations");
assert.deepEqual(bothCollapsed, { sources: false, citations: false });

// --- the input object is never mutated in place -----------------------------
const input = { sources: true, citations: true };
toggleWidePanel(input, "sources");
assert.deepEqual(input, { sources: true, citations: true });

console.log("panelState.test.ts: all assertions passed");
