import { describe, expect, it } from "vitest";
import { isAskLibraryRoute, isImmersiveRoute, isReaderRoute } from "./immersive";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `chartGeometry.test.ts`/`avatarColor.test.ts` — apps/web has no vitest
 * runner wired, so these are plain node:assert scripts).
 */

describe("isImmersiveRoute", () => {
  // --- immersive routes ---------------------------------------------------
  it("treats the knowledge map, work-scoped reader/graph, and writer documents as immersive", () => {
    expect(isImmersiveRoute("/graph")).toBe(true);
    expect(isImmersiveRoute("/works/abc-123/reader")).toBe(true);
    expect(isImmersiveRoute("/works/abc-123/reader/")).toBe(true);
    expect(isImmersiveRoute("/works/abc-123/reader/notes")).toBe(true);
    expect(isImmersiveRoute("/works/abc-123/graph")).toBe(true);
    expect(isImmersiveRoute("/works/abc-123/graph?layout=explore".split("?")[0])).toBe(true);
    expect(isImmersiveRoute("/writer/proj-1")).toBe(true);
    expect(isImmersiveRoute("/writer/proj-1/")).toBe(true);
  });

  // --- the redesign-shell-spec.md §4 compatibility check: work-scoped but
  // NOT one of Reader/Knowledge-Map must stay non-immersive -----------------
  it("redesign-shell-spec.md §4: work-scoped but NOT Reader/Knowledge-Map stays non-immersive", () => {
    expect(isImmersiveRoute("/works/abc-123/roadmap")).toBe(false);
    expect(isImmersiveRoute("/works/abc-123/curriculum")).toBe(false);
    expect(isImmersiveRoute("/works/abc-123/diagnostic")).toBe(false);
  });

  // --- non-immersive routes ------------------------------------------------
  it("treats the ordinary workspace destinations as non-immersive", () => {
    expect(isImmersiveRoute("/dashboard")).toBe(false);
    expect(isImmersiveRoute("/works")).toBe(false);
    expect(isImmersiveRoute("/works/trash")).toBe(false);
    expect(isImmersiveRoute("/library")).toBe(false);
    expect(isImmersiveRoute("/writer")).toBe(false);
    expect(isImmersiveRoute("/research")).toBe(false);
    expect(isImmersiveRoute("/ask-library")).toBe(false);
    expect(isImmersiveRoute("/account/profile")).toBe(false);
  });
});

// --- isReaderRoute: Ask Library single-controller enforcement -----------
// (stage4-read-spec.md §9 item 3) — must match only the Reader route, not
// the Knowledge Map or any other work-scoped tab, since `AppShellRoot` uses
// this to decide when to suppress its own `GlobalRagSidebar` render.
describe("isReaderRoute", () => {
  it("Ask Library single-controller enforcement: matches only the Reader route, not the Knowledge Map or any other work-scoped tab", () => {
    expect(isReaderRoute("/works/abc-123/reader")).toBe(true);
    expect(isReaderRoute("/works/abc-123/reader/")).toBe(true);
    expect(isReaderRoute("/works/abc-123/reader/notes")).toBe(true);
    expect(isReaderRoute("/works/abc-123/graph")).toBe(false);
    expect(isReaderRoute("/works/abc-123/roadmap")).toBe(false);
    expect(isReaderRoute("/works")).toBe(false);
    expect(isReaderRoute("/works/trash")).toBe(false);
    expect(isReaderRoute("/dashboard")).toBe(false);
    expect(isReaderRoute("/ask-library")).toBe(false);
  });
});

// --- isAskLibraryRoute: same enforcement, the full-page destination ------
describe("isAskLibraryRoute", () => {
  it("same enforcement, the full-page destination", () => {
    expect(isAskLibraryRoute("/ask-library")).toBe(true);
    expect(isAskLibraryRoute("/ask-library/")).toBe(false);
    expect(isAskLibraryRoute("/works/abc-123/reader")).toBe(false);
    expect(isAskLibraryRoute("/dashboard")).toBe(false);
  });
});
