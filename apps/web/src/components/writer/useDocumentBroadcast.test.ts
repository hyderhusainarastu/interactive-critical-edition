import { describe, expect, it } from "vitest";
import { shouldShowCrossTabConflict } from "./useDocumentBroadcast";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `panels/panelState.test.ts`/`useFocusTrap.test.ts` — apps/web has no
 * vitest/DOM runner wired, so this pure predicate is tested as a plain
 * function).
 */

const message = { documentId: "doc-1", updatedAt: "2026-07-28T00:00:00.000Z" };

describe("shouldShowCrossTabConflict", () => {
  // --- a broadcast for a different document is never a conflict here -------
  it("a broadcast for a different document is never a conflict here", () => {
    expect(shouldShowCrossTabConflict(message, "doc-2", "Editing")).toBe(false);
  });

  // --- no document open in this tab at all: never a conflict ---------------
  it("no document open in this tab at all: never a conflict", () => {
    expect(shouldShowCrossTabConflict(message, undefined, "Editing")).toBe(false);
  });

  // --- same document, but this tab has nothing unsaved: no conflict --------
  it("same document, but this tab has nothing unsaved: no conflict", () => {
    expect(shouldShowCrossTabConflict(message, "doc-1", "Saved")).toBe(false);
  });

  // --- same document, with unsaved-or-unconfirmed local edits: a conflict --
  it("same document, with unsaved-or-unconfirmed local edits: a conflict", () => {
    expect(shouldShowCrossTabConflict(message, "doc-1", "Editing")).toBe(true);
    expect(shouldShowCrossTabConflict(message, "doc-1", "Saving…")).toBe(true);
    expect(shouldShowCrossTabConflict(message, "doc-1", "Save failed")).toBe(true);
  });

  // --- an existing conflict banner still counts as "unsaved" ---------------
  it("an existing conflict banner still counts as \"unsaved\"", () => {
    expect(shouldShowCrossTabConflict(message, "doc-1", "Edited in another tab")).toBe(true);
  });
});
