import assert from "node:assert/strict";
import { isAskLibraryRoute, isImmersiveRoute, isReaderRoute } from "./immersive";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `chartGeometry.test.ts`/`avatarColor.test.ts` — apps/web has no vitest
 * runner wired, so these are plain node:assert scripts).
 */

// --- immersive routes ---------------------------------------------------
assert.equal(isImmersiveRoute("/graph"), true);
assert.equal(isImmersiveRoute("/works/abc-123/reader"), true);
assert.equal(isImmersiveRoute("/works/abc-123/reader/"), true);
assert.equal(isImmersiveRoute("/works/abc-123/reader/notes"), true);
assert.equal(isImmersiveRoute("/works/abc-123/graph"), true);
assert.equal(isImmersiveRoute("/works/abc-123/graph?layout=explore".split("?")[0]), true);
assert.equal(isImmersiveRoute("/writer/proj-1"), true);
assert.equal(isImmersiveRoute("/writer/proj-1/"), true);

// --- the redesign-shell-spec.md §4 compatibility check: work-scoped but
// NOT one of Reader/Knowledge-Map must stay non-immersive -----------------
assert.equal(isImmersiveRoute("/works/abc-123/roadmap"), false);
assert.equal(isImmersiveRoute("/works/abc-123/curriculum"), false);
assert.equal(isImmersiveRoute("/works/abc-123/diagnostic"), false);

// --- non-immersive routes ------------------------------------------------
assert.equal(isImmersiveRoute("/dashboard"), false);
assert.equal(isImmersiveRoute("/works"), false);
assert.equal(isImmersiveRoute("/works/trash"), false);
assert.equal(isImmersiveRoute("/library"), false);
assert.equal(isImmersiveRoute("/writer"), false);
assert.equal(isImmersiveRoute("/research"), false);
assert.equal(isImmersiveRoute("/ask-library"), false);
assert.equal(isImmersiveRoute("/account/profile"), false);

// --- isReaderRoute: Ask Library single-controller enforcement -----------
// (stage4-read-spec.md §9 item 3) — must match only the Reader route, not
// the Knowledge Map or any other work-scoped tab, since `AppShellRoot` uses
// this to decide when to suppress its own `GlobalRagSidebar` render.
assert.equal(isReaderRoute("/works/abc-123/reader"), true);
assert.equal(isReaderRoute("/works/abc-123/reader/"), true);
assert.equal(isReaderRoute("/works/abc-123/reader/notes"), true);
assert.equal(isReaderRoute("/works/abc-123/graph"), false);
assert.equal(isReaderRoute("/works/abc-123/roadmap"), false);
assert.equal(isReaderRoute("/works"), false);
assert.equal(isReaderRoute("/works/trash"), false);
assert.equal(isReaderRoute("/dashboard"), false);
assert.equal(isReaderRoute("/ask-library"), false);

// --- isAskLibraryRoute: same enforcement, the full-page destination ------
assert.equal(isAskLibraryRoute("/ask-library"), true);
assert.equal(isAskLibraryRoute("/ask-library/"), false);
assert.equal(isAskLibraryRoute("/works/abc-123/reader"), false);
assert.equal(isAskLibraryRoute("/dashboard"), false);

console.log("immersive.test.ts: all assertions passed");
