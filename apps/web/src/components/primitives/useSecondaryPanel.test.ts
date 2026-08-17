import { describe, expect, it } from "vitest";
import { secondaryPanelReducer } from "./useSecondaryPanel";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `useFocusTrap.test.ts`). Covers the charter's "never show more than one
 * secondary drawer or bottom sheet on mobile" requirement (redesign-shell-
 * spec.md §3.4) as a pure reducer, since the whole enforcement mechanism is
 * "there is exactly one `openId` slot" — no DOM/React needed to prove it.
 */

describe("secondaryPanelReducer", () => {
  // --- opening from nothing open -------------------------------------------
  it("opens from nothing open", () => {
    expect(secondaryPanelReducer(null, { type: "open", id: "preferences" })).toBe("preferences");
  });

  // --- one-at-a-time: opening a second panel supersedes the first without a
  // separate "close the old one" step ---------------------------------------
  it("one-at-a-time: opening a second panel supersedes the first without a separate \"close the old one\" step", () => {
    expect(secondaryPanelReducer("preferences", { type: "open", id: "profile" })).toBe("profile");
    expect(secondaryPanelReducer("profile", { type: "open", id: "rag" })).toBe("rag");
    // Opening the SAME id again is a no-op in effect (still just that id).
    expect(secondaryPanelReducer("preferences", { type: "open", id: "preferences" })).toBe("preferences");
  });

  // --- closing the panel that currently owns the slot clears it ------------
  it("closing the panel that currently owns the slot clears it", () => {
    expect(secondaryPanelReducer("profile", { type: "close", id: "profile" })).toBe(null);
  });

  // --- a stale close from a panel that has already been superseded must NOT
  // close whatever is open now — this is the core "can't reintroduce the bug"
  // guarantee: an old panel's own unmount/close effect firing late can never
  // clobber a newer panel's open state ---------------------------------------
  it("a stale close from an already-superseded panel must NOT close whatever is open now", () => {
    expect(secondaryPanelReducer("profile", { type: "close", id: "preferences" })).toBe("profile");
  });

  // --- closing when nothing is open is a no-op ------------------------------
  it("closing when nothing is open is a no-op", () => {
    expect(secondaryPanelReducer(null, { type: "close", id: "preferences" })).toBe(null);
  });
});
