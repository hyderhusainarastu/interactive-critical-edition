import assert from "node:assert/strict";
import {
  clampDragFraction,
  dragFractionFromDelta,
  INSPECTOR_SHEET_DEFAULT_SNAP_INDEX,
  INSPECTOR_SHEET_MAX_DRAG_FRACTION,
  INSPECTOR_SHEET_MIN_DRAG_FRACTION,
  INSPECTOR_SHEET_SNAP_FRACTIONS,
  nearestSnapIndex,
  sheetHeightPx,
} from "./inspectorSheet";

/** `npx tsx apps/web/src/components/knowledge-map/inspectorSheet.test.ts` */

// --- the three snap points match the charter's literal 28/70/95 ---
assert.deepEqual([...INSPECTOR_SHEET_SNAP_FRACTIONS], [0.28, 0.7, 0.95]);
assert.equal(INSPECTOR_SHEET_DEFAULT_SNAP_INDEX, 1);
console.log("snap fractions: OK");

// --- nearestSnapIndex picks the closest point ---
assert.equal(nearestSnapIndex(0.28), 0);
assert.equal(nearestSnapIndex(0.29), 0);
assert.equal(nearestSnapIndex(0.5), 1); // closer to 0.7 (0.2) than 0.28 (0.22)
assert.equal(nearestSnapIndex(0.4), 0); // closer to 0.28 (0.12) than 0.7 (0.3)
assert.equal(nearestSnapIndex(0.7), 1);
assert.equal(nearestSnapIndex(0.9), 2);
assert.equal(nearestSnapIndex(0.95), 2);
assert.equal(nearestSnapIndex(2), 2, "far past the top snaps to the largest point, never out of range");
assert.equal(nearestSnapIndex(-5), 0, "far past the bottom snaps to the smallest point, never out of range");
console.log("nearestSnapIndex: OK");

// --- tie-breaking is deterministic (the smaller/earlier index wins) ---
const midpoint = (INSPECTOR_SHEET_SNAP_FRACTIONS[0] + INSPECTOR_SHEET_SNAP_FRACTIONS[1]) / 2;
assert.equal(nearestSnapIndex(midpoint), 0);
console.log("nearestSnapIndex tie-break: OK");

// --- clampDragFraction bounds a live drag with a small overshoot allowance,
// never fully closing (0) or exceeding the viewport (1) ---
assert.equal(clampDragFraction(-5), INSPECTOR_SHEET_MIN_DRAG_FRACTION);
assert.equal(clampDragFraction(5), INSPECTOR_SHEET_MAX_DRAG_FRACTION);
assert.ok(INSPECTOR_SHEET_MIN_DRAG_FRACTION > 0, "never allows a fully-closed (0%) sheet");
assert.ok(INSPECTOR_SHEET_MAX_DRAG_FRACTION < 1, "never allows a sheet taller than the viewport");
assert.equal(clampDragFraction(0.5), 0.5, "a fraction already inside range is returned unchanged");
console.log("clampDragFraction: OK");

// --- sheetHeightPx converts a fraction to pixels, floored at a sane minimum ---
assert.equal(sheetHeightPx(0.5, 1000), 500);
assert.ok(Math.abs(sheetHeightPx(0.28, 800) - 224) < 1e-9);
assert.equal(sheetHeightPx(0.5, 0), 80, "a degenerate zero viewport height never yields a zero/negative sheet");
assert.equal(sheetHeightPx(0.5, -100), 80, "a negative viewport height reading is clamped, not propagated");
console.log("sheetHeightPx: OK");

// --- dragFractionFromDelta: dragging the handle UP (negative deltaY)
// increases the height fraction; dragging DOWN decreases it ---
{
  const start = 0.5;
  const viewportHeight = 1000;
  const draggedUp = dragFractionFromDelta(start, -200, viewportHeight); // moved 200px up
  const draggedDown = dragFractionFromDelta(start, 200, viewportHeight); // moved 200px down
  assert.ok(draggedUp > start, "dragging up must increase the sheet fraction");
  assert.ok(draggedDown < start, "dragging down must decrease the sheet fraction");
  assert.equal(draggedUp, 0.7);
  assert.equal(draggedDown, 0.3);
}
console.log("dragFractionFromDelta sign convention: OK");

// --- dragFractionFromDelta stays clamped even for a huge delta ---
assert.equal(dragFractionFromDelta(0.5, -100000, 1000), INSPECTOR_SHEET_MAX_DRAG_FRACTION);
assert.equal(dragFractionFromDelta(0.5, 100000, 1000), INSPECTOR_SHEET_MIN_DRAG_FRACTION);
console.log("dragFractionFromDelta clamping: OK");

// --- dragFractionFromDelta tolerates a degenerate viewport height (no NaN/Infinity) ---
assert.equal(dragFractionFromDelta(0.5, -50, 0), 0.5, "an unknown (0) viewport height leaves the fraction unchanged rather than dividing by zero");
console.log("dragFractionFromDelta degenerate viewport: OK");

console.log("ALL inspectorSheet TESTS PASSED");
