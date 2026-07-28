/**
 * Pure snap-point math for the mobile Inspector bottom sheet (charter §10
 * "Graph workspace layout" Mobile bullet: "Inspector bottom sheet with snap
 * points near 28%, 70%, and 95%", spec §1.1's `InspectorDrawer.tsx` row —
 * "a bottom sheet on mobile"). Kept separate from `InspectorDrawer.tsx`
 * itself so the snapping arithmetic is testable without React/DOM, matching
 * this directory's existing convention (`arrangeStore.ts`/`recentContexts.ts`
 * are pure-and-tested; the DOM-driving component around them is not — see
 * `useKnowledgeMapCamera.ts`'s own doc comment for why that split exists).
 *
 * The sheet supports two interaction shapes over the same three snap
 * points: an explicit "cycle" affordance (a button /keyboard action that
 * always lands on a de-jure named snap point, for users who don't want to
 * drag) and a live drag gesture that can rest anywhere between the bounds
 * while dragging, then snaps to the NEAREST of the three points on release.
 */

/** Fractions of the viewport height, smallest (peek) to largest (nearly
 *  full-screen) — charter's literal "near 28%, 70%, and 95%". */
export const INSPECTOR_SHEET_SNAP_FRACTIONS = [0.28, 0.7, 0.95] as const;

export type InspectorSheetSnapIndex = 0 | 1 | 2;

/** The fraction a fresh selection opens to — charter doesn't mandate a
 *  specific default; the middle snap point ("70%") shows a useful amount of
 *  the inspector's content without covering the graph entirely, matching
 *  this file's own judgment-call discipline (documented, not silent). */
export const INSPECTOR_SHEET_DEFAULT_SNAP_INDEX: InspectorSheetSnapIndex = 1;

/** How far a live drag may travel past the smallest/largest snap point
 *  before release — a small give so the gesture doesn't feel like it hits a
 *  hard wall, without ever fully closing (0%) or exceeding the viewport
 *  (100%). Release-time snapping (`nearestSnapFraction`) always pulls back
 *  inside the real snap points regardless of how far a drag stretched. */
const DRAG_OVERSHOOT_FRACTION = 0.06;
export const INSPECTOR_SHEET_MIN_DRAG_FRACTION = Math.max(0.01, INSPECTOR_SHEET_SNAP_FRACTIONS[0] - DRAG_OVERSHOOT_FRACTION);
export const INSPECTOR_SHEET_MAX_DRAG_FRACTION = Math.min(0.99, INSPECTOR_SHEET_SNAP_FRACTIONS[2] + DRAG_OVERSHOOT_FRACTION);

/** Clamps a fraction to the draggable range — used on every `pointermove`
 *  while a drag is live, before any snapping decision. */
export function clampDragFraction(fraction: number): number {
  return Math.max(INSPECTOR_SHEET_MIN_DRAG_FRACTION, Math.min(INSPECTOR_SHEET_MAX_DRAG_FRACTION, fraction));
}

/** The index into `INSPECTOR_SHEET_SNAP_FRACTIONS` closest to `fraction` —
 *  used on `pointerup`/`pointercancel` to resolve a live drag position back
 *  to one of the three named snap points. Ties (equidistant from two
 *  points) resolve to the SMALLER (earlier) index, a stable, deterministic
 *  rule rather than depending on floating-point comparison order. */
export function nearestSnapIndex(fraction: number, points: readonly number[] = INSPECTOR_SHEET_SNAP_FRACTIONS): InspectorSheetSnapIndex {
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < points.length; i++) {
    const distance = Math.abs(points[i] - fraction);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return bestIndex as InspectorSheetSnapIndex;
}

/** Converts a snap fraction into a concrete pixel height for the given
 *  viewport height, floored at a small minimum so a degenerate (0 or
 *  negative) viewport height reading never yields a negative/zero-height
 *  sheet that content can't scroll inside. */
export function sheetHeightPx(fraction: number, viewportHeightPx: number): number {
  return Math.max(80, fraction * Math.max(0, viewportHeightPx));
}

/** Pure conversion from a live drag's vertical pointer delta to the next
 *  drag fraction, given the fraction the drag started from. Dragging the
 *  handle UP (negative `deltaY`, screen Y decreases upward) must INCREASE
 *  the sheet's height fraction — this is the one sign-convention detail a
 *  caller could get backwards, so it is centralized and tested here rather
 *  than re-derived inline in a pointer-move handler. */
export function dragFractionFromDelta(startFraction: number, deltaYPx: number, viewportHeightPx: number): number {
  if (viewportHeightPx <= 0) return startFraction;
  return clampDragFraction(startFraction - deltaYPx / viewportHeightPx);
}
