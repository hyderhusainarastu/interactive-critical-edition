import { describe, expect, it } from "vitest";
import { hasReaderLevelSignal, rolesHaveReaderLevelSignal } from "@/lib/library/librarySearch";

/**
 * Owner-reported defect regression (register-tentative D-23-50): "the
 * library's reader level selection does nothing: all sources are shown for
 * all reader levels." Investigation found the control/state/filter wiring
 * itself is correct (`matchesReaderLevel` in `@ice/roadmap` deliberately
 * treats a null `resource_role.reader_level` as "applies at every level"),
 * but BOTH current write paths into `resource_role`
 * (`apps/worker/src/analyze.ts`'s `ensureCitationRole` and its v3/v4
 * promotion insert) hardcode `readerLevel: null` — confirmed in production:
 * `select reader_level, count(*) from resource_role group by 1` returns a
 * single row, `{reader_level: null, count: 406}`. With every row null, a
 * level filter is a mathematically correct no-op over the real data, not a
 * bug — every option returns the identical set. `hasReaderLevelSignal` is
 * the pure check `LibraryView.tsx` uses to only offer the filter when the
 * data can actually differentiate, and to show an honest inline note
 * otherwise, rather than a control that visibly changes nothing.
 *
 * Run via `pnpm --filter web exec tsx <path>` (same convention as
 * `matchNoteToBlock.test.ts`/`edgeTypeForRelationshipCategory.test.ts` — this
 * module has no DB import, so it needs no DATABASE_URL).
 */

function itemWithRoles(readerLevels: Array<string | null>) {
  return {
    roles: readerLevels.map((readerLevel) => ({
      relationship: "explicit_reference",
      readerLevel: readerLevel as never,
      rationale: null,
      confidence: 0,
      recommendedFor: [],
    })),
  };
}

const role = (readerLevel: string | null) => ({ readerLevel });

describe("hasReaderLevelSignal", () => {
  // The exact production shape (2026-07-23): every role on every item is
  // null-level. No signal — the filter must not be offered.
  it("reports no signal for the exact production shape, where every role on every item is null-level", () => {
    expect(hasReaderLevelSignal([itemWithRoles([null]), itemWithRoles([null, null])])).toBe(false);
  });

  // No items at all — vacuously no signal, not a crash.
  it("reports no signal for no items at all, vacuously rather than crashing", () => {
    expect(hasReaderLevelSignal([])).toBe(false);
  });

  // An item with no roles at all (shouldn't happen in practice, but must not
  // throw) still yields no signal.
  it("still yields no signal for an item with no roles at all, without throwing", () => {
    expect(hasReaderLevelSignal([{ roles: [] }])).toBe(false);
  });

  // The moment even ONE role anywhere carries a real level, the signal must
  // flip true — this is what lets the filter reappear automatically the day a
  // write path actually classifies by level, with no code change here.
  it("flips true the moment even one role anywhere carries a real level", () => {
    expect(hasReaderLevelSignal([itemWithRoles([null]), itemWithRoles(["undergraduate"])])).toBe(true);
  });

  // A single item mixing a universal role with a level-tagged one still
  // counts as a signal.
  it("counts a single item mixing a universal role with a level-tagged one as a signal", () => {
    expect(hasReaderLevelSignal([itemWithRoles([null, "advanced"])])).toBe(true);
  });
});

// --- rolesHaveReaderLevelSignal (D-23-8, Curriculum twin of D-23-12) ---
// The flat-roles sibling `computeCurriculum` uses over one work's
// `resource_role` rows directly. Mirrors the item-shaped cases above.
describe("rolesHaveReaderLevelSignal", () => {
  // The exact production shape: every role is null-level. No signal — the
  // Curriculum page must show the honest note, not the filter.
  it("reports no signal for the exact production shape, where every role is null-level", () => {
    expect(rolesHaveReaderLevelSignal([role(null), role(null)])).toBe(false);
  });

  // No roles at all — vacuously no signal, not a crash.
  it("reports no signal for no roles at all, vacuously rather than crashing", () => {
    expect(rolesHaveReaderLevelSignal([])).toBe(false);
  });

  // One real level anywhere flips the signal true, so the filter reappears
  // automatically the day a write path classifies by level.
  it("flips true when one real level appears anywhere", () => {
    expect(rolesHaveReaderLevelSignal([role(null), role("undergraduate")])).toBe(true);
  });

  // Mixed universal + level-tagged roles still count as a signal.
  it("counts mixed universal and level-tagged roles as a signal", () => {
    expect(rolesHaveReaderLevelSignal([role(null), role("advanced"), role(null)])).toBe(true);
  });
});
