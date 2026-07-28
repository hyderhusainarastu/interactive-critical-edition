import assert from "node:assert/strict";
import { shouldShowCrossTabConflict } from "./useDocumentBroadcast";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `panels/panelState.test.ts`/`useFocusTrap.test.ts` — apps/web has no
 * vitest/DOM runner wired, so this pure predicate is tested as a plain
 * function).
 */

const message = { documentId: "doc-1", updatedAt: "2026-07-28T00:00:00.000Z" };

// --- a broadcast for a different document is never a conflict here -------
assert.equal(shouldShowCrossTabConflict(message, "doc-2", "Editing"), false);

// --- no document open in this tab at all: never a conflict ---------------
assert.equal(shouldShowCrossTabConflict(message, undefined, "Editing"), false);

// --- same document, but this tab has nothing unsaved: no conflict --------
assert.equal(shouldShowCrossTabConflict(message, "doc-1", "Saved"), false);

// --- same document, with unsaved-or-unconfirmed local edits: a conflict --
assert.equal(shouldShowCrossTabConflict(message, "doc-1", "Editing"), true);
assert.equal(shouldShowCrossTabConflict(message, "doc-1", "Saving…"), true);
assert.equal(shouldShowCrossTabConflict(message, "doc-1", "Save failed"), true);

// --- an existing conflict banner still counts as "unsaved" ---------------
assert.equal(shouldShowCrossTabConflict(message, "doc-1", "Edited in another tab"), true);

console.log("useDocumentBroadcast.test.ts: all assertions passed");
