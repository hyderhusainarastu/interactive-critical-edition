import { describe, expect, it } from "vitest";
import { resolveFocusTrapAction } from "./useFocusTrap";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `chartGeometry.test.ts`/`navItems.test.ts` — apps/web has no vitest/DOM
 * runner wired, so the focus-trap's actual Tab-wrap decision is tested as a
 * pure function taking (focusableCount, activeIndex, shiftKey) rather than
 * against a real `useFocusTrap` + jsdom).
 */

describe("resolveFocusTrapAction", () => {
  // --- empty container: always retreat to the container itself -------------
  it("empty container: always retreat to the container itself", () => {
    expect(resolveFocusTrapAction(0, -1, false)).toBe("focus-container");
    expect(resolveFocusTrapAction(0, -1, true)).toBe("focus-container");
  });

  // --- forward Tab from the last focusable wraps to the first --------------
  it("forward Tab from the last focusable wraps to the first", () => {
    expect(resolveFocusTrapAction(3, 2, false)).toBe("wrap-to-first");
    expect(resolveFocusTrapAction(1, 0, false)).toBe("wrap-to-first"); // single-item trap: last === first
  });

  // --- Shift+Tab from the first focusable wraps to the last ----------------
  it("Shift+Tab from the first focusable wraps to the last", () => {
    expect(resolveFocusTrapAction(3, 0, true)).toBe("wrap-to-last");
    expect(resolveFocusTrapAction(1, 0, true)).toBe("wrap-to-last");
  });

  // --- everywhere else in the middle: let the browser move focus normally --
  it("everywhere else in the middle: let the browser move focus normally", () => {
    expect(resolveFocusTrapAction(3, 1, false)).toBe("allow-default");
    expect(resolveFocusTrapAction(3, 1, true)).toBe("allow-default");
  });

  // --- focus outside the tracked list (activeIndex -1, non-empty trap): not
  // at either edge, so don't intervene -------------------------------------
  it("focus outside the tracked list (activeIndex -1, non-empty trap): not at either edge, so don't intervene", () => {
    expect(resolveFocusTrapAction(3, -1, false)).toBe("allow-default");
    expect(resolveFocusTrapAction(3, -1, true)).toBe("allow-default");
  });
});
