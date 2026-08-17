import { describe, expect, it } from "vitest";
import { buildCommandPaletteNavItems, buildWorkspaceNavItems, isNavItemActive, isReadSectionActive } from "./navItems";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `chartGeometry.test.ts`/`avatarColor.test.ts`).
 */

// --- buildWorkspaceNavItems: exactly 4 max, correct order, flag-dependent
const allFlags = buildWorkspaceNavItems({ writerEnabled: true, researchEnabled: true });
const noFlags = buildWorkspaceNavItems({ writerEnabled: false, researchEnabled: false });
const researchOnly = buildWorkspaceNavItems({ writerEnabled: false, researchEnabled: true });
const writerOnly = buildWorkspaceNavItems({ writerEnabled: true, researchEnabled: false });

describe("buildWorkspaceNavItems", () => {
  it("exactly 4 max, correct order, flag-dependent", () => {
    expect(allFlags.map((item) => item.label)).toEqual(["Home", "Read", "Research", "Write"]);
    expect(noFlags.map((item) => item.label)).toEqual(["Home", "Read"]);
    expect(researchOnly.map((item) => item.label)).toEqual(["Home", "Read", "Research"]);
    expect(writerOnly.map((item) => item.label)).toEqual(["Home", "Read", "Write"]);
  });
});

// --- buildCommandPaletteNavItems: Upload keeps its "U" shortcut; flags gate
// Ask Library/Research/Write/Admin independently
const paletteAll = buildCommandPaletteNavItems({ writerEnabled: true, researchEnabled: true, ragEnabled: true, admin: true });
const paletteNone = buildCommandPaletteNavItems({ writerEnabled: false, researchEnabled: false, ragEnabled: false, admin: false });

describe("buildCommandPaletteNavItems", () => {
  it("Upload keeps its \"U\" shortcut, and every flagged destination is present when all flags are on", () => {
    expect(paletteAll.find((item) => item.href === "/upload")?.shortcut).toBe("U");
    expect(paletteAll.some((item) => item.href === "/graph" && item.label === "Knowledge Map")).toBeTruthy();
    expect(paletteAll.some((item) => item.href === "/ask-library")).toBeTruthy();
    expect(paletteAll.some((item) => item.href === "/admin")).toBeTruthy();
  });

  it("flags gate Ask Library/Research/Write/Admin independently", () => {
    expect(!paletteNone.some((item) => item.href === "/ask-library")).toBeTruthy();
    expect(!paletteNone.some((item) => item.href === "/research")).toBeTruthy();
    expect(!paletteNone.some((item) => item.href === "/writer")).toBeTruthy();
    expect(!paletteNone.some((item) => item.href === "/admin")).toBeTruthy();
  });

  // Reachability floor: Library/Upload/Trash always present regardless of flags.
  it("reachability floor: Library/Upload/Trash always present regardless of flags", () => {
    expect(paletteNone.some((item) => item.href === "/library")).toBeTruthy();
    expect(paletteNone.some((item) => item.href === "/upload")).toBeTruthy();
    expect(paletteNone.some((item) => item.href === "/works/trash")).toBeTruthy();
  });
});

// --- isNavItemActive: exact + prefix match, /dashboard exact-only
describe("isNavItemActive", () => {
  it("exact + prefix match, /dashboard exact-only", () => {
    expect(isNavItemActive("/dashboard", "/dashboard")).toBe(true);
    expect(isNavItemActive("/dashboard/anything", "/dashboard")).toBe(false);
    expect(isNavItemActive("/works", "/works")).toBe(true);
    expect(isNavItemActive("/works/abc-123", "/works")).toBe(true);
    expect(isNavItemActive("/worksxyz", "/works")).toBe(false);
  });
});

// --- isReadSectionActive: covers both /works* and /library*
describe("isReadSectionActive", () => {
  it("covers both /works* and /library*", () => {
    expect(isReadSectionActive("/works")).toBe(true);
    expect(isReadSectionActive("/works/abc-123")).toBe(true);
    expect(isReadSectionActive("/library")).toBe(true);
    expect(isReadSectionActive("/library/some-record")).toBe(true);
    expect(isReadSectionActive("/dashboard")).toBe(false);
    expect(isReadSectionActive("/research")).toBe(false);
  });
});
