/**
 * Extracted verbatim from `adminDashData.ts` (Workstream H, v.5). The pure,
 * DB-free half of that file: the day-axis helpers shared by the overview
 * series and the per-user usage-event series. `adminDashData.ts` re-exports
 * nothing from here — these were, and remain, module-internal to the
 * admin-dash query layer; they are exported only so the two query modules
 * that were split out of the same file can still reach them.
 */

export const DAILY_SERIES_DAYS = 30;

// ---------------------------------------------------------------------------
// Shared day-axis helpers (same technique as accountUsage.ts's dayBuckets,
// generalized to arbitrary date_trunc('day', ...) query results).
// ---------------------------------------------------------------------------

export function dayAxis(daysBack: number, now: Date = new Date()): Date[] {
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const axis: Date[] = [];
  for (let i = daysBack - 1; i >= 0; i -= 1) {
    axis.push(new Date(endOfToday.getFullYear(), endOfToday.getMonth(), endOfToday.getDate() - i));
  }
  return axis;
}

function isoDay(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

export function fillDailySeries(rows: Array<{ day: Date | string; value: number | string }>, axis: Date[]): number[] {
  const byDay = new Map<string, number>();
  for (const row of rows) byDay.set(isoDay(row.day), Number(row.value));
  return axis.map((d) => byDay.get(isoDay(d)) ?? 0);
}

export function dayLabels(axis: Date[]): string[] {
  return axis.map((d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
}
