/**
 * Workstream H (v.5): a bounded, in-process dedupe window for
 * `api/usage-event/route.ts` — the same "fixed window in a module-level
 * Map, pruned when it grows large" shape `preAuthRateLimit.ts` already
 * established, reused here for a different purpose (suppressing duplicate
 * beacon posts, not throttling abuse).
 *
 * Keyed by `${userId}:${eventType}:${path}`, not just `userId`+`path` —
 * `TelemetryBeacon.tsx` fires BOTH a `session_start` and a `page_view` for
 * the exact same path on a fresh page load (deliberately, per its own doc
 * comment), and a key that dropped `eventType` would let whichever of the
 * two loses the race silently suppress the other. Keying on all three is
 * the safe reading of the plan's "per-user+path dedupe": it still catches
 * the actual failure mode a client beacon can produce (a double-fired
 * effect — e.g. React StrictMode's dev-only double-invoke — posting the
 * SAME event type for the SAME path twice in quick succession) without
 * that false-positive risk.
 *
 * Honest limitation, same as `preAuthRateLimit.ts`: this Map lives in a
 * single process. On Vercel, each warm lambda instance keeps its own
 * window, so a request landing on a different instance within the 30s
 * window is not deduped against this one. Acceptable here specifically
 * because the cost of an occasional undeduped duplicate is one extra
 * content-free analytics row, not a security or correctness issue.
 */

const DEDUPE_WINDOW_MS = 30_000;
const MAX_TRACKED_KEYS = 10_000;

const recentlySeen = new Map<string, number>(); // key -> expiresAt (ms epoch)

function pruneIfLarge(now: number) {
  if (recentlySeen.size < MAX_TRACKED_KEYS) return;
  for (const [key, expiresAt] of recentlySeen) {
    if (expiresAt <= now) recentlySeen.delete(key);
  }
  if (recentlySeen.size < MAX_TRACKED_KEYS) return;
  // A burst of >MAX_TRACKED_KEYS distinct keys inside one window leaves
  // nothing stale to drop — evict the soonest-to-expire entries until back
  // under the cap, same trade-off `preAuthRateLimit.ts` documents for its
  // own hard cap (an early reset under flood conditions, never unbounded
  // memory growth).
  const target = Math.floor(MAX_TRACKED_KEYS * 0.9);
  const soonestFirst = [...recentlySeen.entries()].sort((a, b) => a[1] - b[1]);
  for (const [key] of soonestFirst) {
    if (recentlySeen.size <= target) break;
    recentlySeen.delete(key);
  }
}

/**
 * Returns true the first time this (userId, eventType, path) combination is
 * seen within the current 30s window (and records it), false for a repeat
 * within that same window. Side-effecting by design, same as
 * `checkPreAuthLimit`.
 */
export function shouldRecordUsageEvent(userId: string, eventType: string, path: string | null): boolean {
  const now = Date.now();
  pruneIfLarge(now);
  const key = `${userId}:${eventType}:${path ?? ""}`;
  const expiresAt = recentlySeen.get(key);
  if (expiresAt !== undefined && expiresAt > now) return false;
  recentlySeen.set(key, now + DEDUPE_WINDOW_MS);
  return true;
}

/** Test-only: current number of tracked keys, to prove the memory bound. */
export function _dedupeMapSizeForTests(): number {
  return recentlySeen.size;
}

/** Test-only: reset between test cases so timing assumptions don't leak. */
export function _clearDedupeForTests(): void {
  recentlySeen.clear();
}
