import assert from "node:assert/strict";
import { hasReaderLevelSignal, rolesHaveReaderLevelSignal } from "./librarySearch";

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

// The exact production shape (2026-07-23): every role on every item is
// null-level. No signal — the filter must not be offered.
assert.equal(hasReaderLevelSignal([itemWithRoles([null]), itemWithRoles([null, null])]), false);

// No items at all — vacuously no signal, not a crash.
assert.equal(hasReaderLevelSignal([]), false);

// An item with no roles at all (shouldn't happen in practice, but must not
// throw) still yields no signal.
assert.equal(hasReaderLevelSignal([{ roles: [] }]), false);

// The moment even ONE role anywhere carries a real level, the signal must
// flip true — this is what lets the filter reappear automatically the day a
// write path actually classifies by level, with no code change here.
assert.equal(hasReaderLevelSignal([itemWithRoles([null]), itemWithRoles(["undergraduate"])]), true);

// A single item mixing a universal role with a level-tagged one still
// counts as a signal.
assert.equal(hasReaderLevelSignal([itemWithRoles([null, "advanced"])]), true);

// --- rolesHaveReaderLevelSignal (D-23-8, Curriculum twin of D-23-12) ---
// The flat-roles sibling `computeCurriculum` uses over one work's
// `resource_role` rows directly. Mirrors the item-shaped cases above.

const role = (readerLevel: string | null) => ({ readerLevel });

// The exact production shape: every role is null-level. No signal — the
// Curriculum page must show the honest note, not the filter.
assert.equal(rolesHaveReaderLevelSignal([role(null), role(null)]), false);

// No roles at all — vacuously no signal, not a crash.
assert.equal(rolesHaveReaderLevelSignal([]), false);

// One real level anywhere flips the signal true, so the filter reappears
// automatically the day a write path classifies by level.
assert.equal(rolesHaveReaderLevelSignal([role(null), role("undergraduate")]), true);

// Mixed universal + level-tagged roles still count as a signal.
assert.equal(rolesHaveReaderLevelSignal([role(null), role("advanced"), role(null)]), true);

console.log("librarySearch.test.ts: all assertions passed");
