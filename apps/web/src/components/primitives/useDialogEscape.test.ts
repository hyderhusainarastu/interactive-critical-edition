import { describe, expect, it } from "vitest";
import { shouldHandleEscape } from "./useDialogEscape";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `useFocusTrap.test.ts`).
 */

describe("shouldHandleEscape", () => {
  // --- only Escape closes, and only while the surface is active ------------
  it("closes only on Escape, and only while the surface is active", () => {
    expect(shouldHandleEscape("Escape", true)).toBe(true);
    expect(shouldHandleEscape("Escape", false)).toBe(false);
    expect(shouldHandleEscape("Enter", true)).toBe(false);
    expect(shouldHandleEscape("Tab", true)).toBe(false);
    expect(shouldHandleEscape("Escape", false)).toBe(false);
  });
});
