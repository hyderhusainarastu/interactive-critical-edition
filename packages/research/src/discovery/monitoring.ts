/**
 * Phase 29.1: pure cadence math for scheduled research monitors (plan
 * §Pipeline monitoring). Kept DB-independent and pure — like `@ice/roadmap`'s
 * ranking or `stageForRelationship()` — so "is this monitor due right now" is
 * a deterministic, directly-unit-testable function rather than logic buried
 * inside a SQL predicate or the worker's own control flow. The worker's
 * `apps/worker/src/research/repository.ts` fetches candidate monitor rows
 * (active, non-paused) and filters them through this function in application
 * code, the same "small per-user row count -> in-memory filter" precedent
 * `loadActiveClustersWithContradictions`'s own doc comment already applies.
 */

export type MonitorCadence = "daily" | "weekly" | "paused";

/** How long a monitor may go unscanned before it's due again, per cadence. */
export const CADENCE_WINDOW_MS: Record<Exclude<MonitorCadence, "paused">, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

export interface MonitorDueInput {
  cadence: MonitorCadence;
  isActive: boolean;
  lastScannedAt: Date | null;
}

/**
 * A monitor is due when it's active, its cadence isn't `paused`, and either
 * it has never been scanned or its cadence window has fully elapsed since
 * `lastScannedAt`. `paused` is the DB default (`research_monitor.cadence`)
 * and `isActive` defaults true — a brand-new monitor is therefore NOT due
 * until the user explicitly sets a cadence, matching the "off AND
 * cadence-paused by default" design decision.
 */
export function isMonitorDue(input: MonitorDueInput, now: Date = new Date()): boolean {
  if (!input.isActive || input.cadence === "paused") return false;
  if (!input.lastScannedAt) return true;
  const windowMs = CADENCE_WINDOW_MS[input.cadence];
  return now.getTime() - input.lastScannedAt.getTime() >= windowMs;
}
