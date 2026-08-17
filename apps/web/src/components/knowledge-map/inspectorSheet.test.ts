import { describe, expect, it } from "vitest";
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

// --- tie-breaking is deterministic (the smaller/earlier index wins) ---
const midpoint = (INSPECTOR_SHEET_SNAP_FRACTIONS[0] + INSPECTOR_SHEET_SNAP_FRACTIONS[1]) / 2;

describe("inspectorSheet", () => {
  // --- the three snap points match the charter's literal 28/70/95 ---
  it("the three snap points match the charter's literal 28/70/95", () => {
    expect([...INSPECTOR_SHEET_SNAP_FRACTIONS]).toEqual([0.28, 0.7, 0.95]);
    expect(INSPECTOR_SHEET_DEFAULT_SNAP_INDEX).toBe(1);
  });

  // --- nearestSnapIndex picks the closest point ---
  it("nearestSnapIndex picks the closest point", () => {
    expect(nearestSnapIndex(0.28)).toBe(0);
    expect(nearestSnapIndex(0.29)).toBe(0);
    expect(nearestSnapIndex(0.5)).toBe(1); // closer to 0.7 (0.2) than 0.28 (0.22)
    expect(nearestSnapIndex(0.4)).toBe(0); // closer to 0.28 (0.12) than 0.7 (0.3)
    expect(nearestSnapIndex(0.7)).toBe(1);
    expect(nearestSnapIndex(0.9)).toBe(2);
    expect(nearestSnapIndex(0.95)).toBe(2);
    // far past the top snaps to the largest point, never out of range
    expect(nearestSnapIndex(2)).toBe(2);
    // far past the bottom snaps to the smallest point, never out of range
    expect(nearestSnapIndex(-5)).toBe(0);
  });

  // --- tie-breaking is deterministic (the smaller/earlier index wins) ---
  it("nearestSnapIndex tie-break is deterministic (the smaller/earlier index wins)", () => {
    expect(nearestSnapIndex(midpoint)).toBe(0);
  });

  // --- clampDragFraction bounds a live drag with a small overshoot allowance,
  // never fully closing (0) or exceeding the viewport (1) ---
  it("clampDragFraction bounds a live drag, never fully closing (0) or exceeding the viewport (1)", () => {
    expect(clampDragFraction(-5)).toBe(INSPECTOR_SHEET_MIN_DRAG_FRACTION);
    expect(clampDragFraction(5)).toBe(INSPECTOR_SHEET_MAX_DRAG_FRACTION);
    // never allows a fully-closed (0%) sheet
    expect(INSPECTOR_SHEET_MIN_DRAG_FRACTION > 0).toBeTruthy();
    // never allows a sheet taller than the viewport
    expect(INSPECTOR_SHEET_MAX_DRAG_FRACTION < 1).toBeTruthy();
    // a fraction already inside range is returned unchanged
    expect(clampDragFraction(0.5)).toBe(0.5);
  });

  // --- sheetHeightPx converts a fraction to pixels, floored at a sane minimum ---
  it("sheetHeightPx converts a fraction to pixels, floored at a sane minimum", () => {
    expect(sheetHeightPx(0.5, 1000)).toBe(500);
    expect(Math.abs(sheetHeightPx(0.28, 800) - 224) < 1e-9).toBeTruthy();
    // a degenerate zero viewport height never yields a zero/negative sheet
    expect(sheetHeightPx(0.5, 0)).toBe(80);
    // a negative viewport height reading is clamped, not propagated
    expect(sheetHeightPx(0.5, -100)).toBe(80);
  });

  // --- dragFractionFromDelta: dragging the handle UP (negative deltaY)
  // increases the height fraction; dragging DOWN decreases it ---
  it("dragFractionFromDelta sign convention: up increases, down decreases", () => {
    const start = 0.5;
    const viewportHeight = 1000;
    const draggedUp = dragFractionFromDelta(start, -200, viewportHeight); // moved 200px up
    const draggedDown = dragFractionFromDelta(start, 200, viewportHeight); // moved 200px down
    // dragging up must increase the sheet fraction
    expect(draggedUp > start).toBeTruthy();
    // dragging down must decrease the sheet fraction
    expect(draggedDown < start).toBeTruthy();
    expect(draggedUp).toBe(0.7);
    expect(draggedDown).toBe(0.3);
  });

  // --- dragFractionFromDelta stays clamped even for a huge delta ---
  it("dragFractionFromDelta stays clamped even for a huge delta", () => {
    expect(dragFractionFromDelta(0.5, -100000, 1000)).toBe(INSPECTOR_SHEET_MAX_DRAG_FRACTION);
    expect(dragFractionFromDelta(0.5, 100000, 1000)).toBe(INSPECTOR_SHEET_MIN_DRAG_FRACTION);
  });

  // --- dragFractionFromDelta tolerates a degenerate viewport height (no NaN/Infinity) ---
  it("an unknown (0) viewport height leaves the fraction unchanged rather than dividing by zero", () => {
    expect(dragFractionFromDelta(0.5, -50, 0)).toBe(0.5);
  });
});
