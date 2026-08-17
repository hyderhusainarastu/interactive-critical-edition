import { describe, expect, it } from "vitest";
import { DEFAULT_WIDE_PANEL_STATE, toggleWidePanel } from "./panelState";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `useFocusTrap.test.ts`/`useDialogEscape.test.ts` — `apps/web` has no
 * vitest/DOM runner wired, so this pure reducer is tested as a plain
 * function).
 */

describe("toggleWidePanel", () => {
  // --- toggling one panel never touches the other ---------------------------
  it("toggling one panel never touches the other", () => {
    expect(toggleWidePanel(DEFAULT_WIDE_PANEL_STATE, "sources")).toEqual({ sources: false, citations: true });
    expect(toggleWidePanel(DEFAULT_WIDE_PANEL_STATE, "citations")).toEqual({ sources: true, citations: false });
  });

  // --- toggling twice returns to the original state --------------------------
  it("toggling twice returns to the original state", () => {
    expect(toggleWidePanel(toggleWidePanel(DEFAULT_WIDE_PANEL_STATE, "sources"), "sources")).toEqual(
      DEFAULT_WIDE_PANEL_STATE,
    );
  });

  // --- both collapsed is reachable and independent ---------------------------
  it("both collapsed is reachable and independent", () => {
    const bothCollapsed = toggleWidePanel(toggleWidePanel(DEFAULT_WIDE_PANEL_STATE, "sources"), "citations");
    expect(bothCollapsed).toEqual({ sources: false, citations: false });
  });

  // --- the input object is never mutated in place -----------------------------
  it("the input object is never mutated in place", () => {
    const input = { sources: true, citations: true };
    toggleWidePanel(input, "sources");
    expect(input).toEqual({ sources: true, citations: true });
  });
});
