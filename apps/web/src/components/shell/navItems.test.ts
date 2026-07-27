import assert from "node:assert/strict";
import { buildCommandPaletteNavItems, buildWorkspaceNavItems, isNavItemActive, isReadSectionActive } from "./navItems";

/**
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention
 * as `chartGeometry.test.ts`/`avatarColor.test.ts`).
 */

// --- buildWorkspaceNavItems: exactly 4 max, correct order, flag-dependent
const allFlags = buildWorkspaceNavItems({ writerEnabled: true, researchEnabled: true });
assert.deepEqual(allFlags.map((item) => item.label), ["Home", "Read", "Research", "Write"]);

const noFlags = buildWorkspaceNavItems({ writerEnabled: false, researchEnabled: false });
assert.deepEqual(noFlags.map((item) => item.label), ["Home", "Read"]);

const researchOnly = buildWorkspaceNavItems({ writerEnabled: false, researchEnabled: true });
assert.deepEqual(researchOnly.map((item) => item.label), ["Home", "Read", "Research"]);

const writerOnly = buildWorkspaceNavItems({ writerEnabled: true, researchEnabled: false });
assert.deepEqual(writerOnly.map((item) => item.label), ["Home", "Read", "Write"]);

// --- buildCommandPaletteNavItems: Upload keeps its "U" shortcut; flags gate
// Ask Library/Research/Write/Admin independently
const paletteAll = buildCommandPaletteNavItems({ writerEnabled: true, researchEnabled: true, ragEnabled: true, admin: true });
assert.equal(paletteAll.find((item) => item.href === "/upload")?.shortcut, "U");
assert.ok(paletteAll.some((item) => item.href === "/graph" && item.label === "Knowledge Map"));
assert.ok(paletteAll.some((item) => item.href === "/ask-library"));
assert.ok(paletteAll.some((item) => item.href === "/admin"));

const paletteNone = buildCommandPaletteNavItems({ writerEnabled: false, researchEnabled: false, ragEnabled: false, admin: false });
assert.ok(!paletteNone.some((item) => item.href === "/ask-library"));
assert.ok(!paletteNone.some((item) => item.href === "/research"));
assert.ok(!paletteNone.some((item) => item.href === "/writer"));
assert.ok(!paletteNone.some((item) => item.href === "/admin"));
// Reachability floor: Library/Upload/Trash always present regardless of flags.
assert.ok(paletteNone.some((item) => item.href === "/library"));
assert.ok(paletteNone.some((item) => item.href === "/upload"));
assert.ok(paletteNone.some((item) => item.href === "/works/trash"));

// --- isNavItemActive: exact + prefix match, /dashboard exact-only
assert.equal(isNavItemActive("/dashboard", "/dashboard"), true);
assert.equal(isNavItemActive("/dashboard/anything", "/dashboard"), false);
assert.equal(isNavItemActive("/works", "/works"), true);
assert.equal(isNavItemActive("/works/abc-123", "/works"), true);
assert.equal(isNavItemActive("/worksxyz", "/works"), false);

// --- isReadSectionActive: covers both /works* and /library*
assert.equal(isReadSectionActive("/works"), true);
assert.equal(isReadSectionActive("/works/abc-123"), true);
assert.equal(isReadSectionActive("/library"), true);
assert.equal(isReadSectionActive("/library/some-record"), true);
assert.equal(isReadSectionActive("/dashboard"), false);
assert.equal(isReadSectionActive("/research"), false);

console.log("navItems.test.ts: all assertions passed");
