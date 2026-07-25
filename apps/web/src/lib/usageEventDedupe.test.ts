import assert from "node:assert/strict";
import { _clearDedupeForTests, _dedupeMapSizeForTests, shouldRecordUsageEvent } from "./usageEventDedupe";

/**
 * Workstream H (v.5) usage-event dedupe — pure in-memory Map logic, no DB
 * import (same convention as `preAuthRateLimit.test.ts`).
 *
 * Run: cd apps/web && ../worker/node_modules/.bin/tsx src/lib/usageEventDedupe.test.ts
 */

_clearDedupeForTests();

// First occurrence of a (userId, eventType, path) triple is always allowed.
assert.equal(shouldRecordUsageEvent("u1", "page_view", "/library"), true);

// A repeat within the window is suppressed.
assert.equal(shouldRecordUsageEvent("u1", "page_view", "/library"), false);

// A DIFFERENT event type for the SAME user+path is NOT suppressed — this is
// the exact collision `TelemetryBeacon.tsx` produces on every fresh page
// load (session_start + page_view, same path, same instant), and the key
// deliberately includes eventType to avoid one silently swallowing the other.
assert.equal(shouldRecordUsageEvent("u1", "session_start", "/library"), true);

// A different path for the same user+eventType is its own key.
assert.equal(shouldRecordUsageEvent("u1", "page_view", "/dashboard"), true);

// A different user is never deduped against another user's identical event.
assert.equal(shouldRecordUsageEvent("u2", "page_view", "/library"), true);

// null path is its own valid key, independent of a real path.
assert.equal(shouldRecordUsageEvent("u1", "page_view", null), true);
assert.equal(shouldRecordUsageEvent("u1", "page_view", null), false);

// ADVERSARIAL: flooding with far more distinct keys than the cap must not
// grow the map without bound (same shape as preAuthRateLimit.ts's own
// adversarial test).
{
  _clearDedupeForTests();
  for (let i = 0; i < 25_000; i += 1) {
    shouldRecordUsageEvent(`flood-${i}`, "page_view", "/x");
  }
  const size = _dedupeMapSizeForTests();
  assert.ok(size <= 10_000, `dedupe map must stay bounded under a distinct-key flood, got ${size}`);
}

console.log("usageEventDedupe.test.ts: all assertions passed");
