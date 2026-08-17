import { describe, expect, it } from "vitest";
import { _clearDedupeForTests, _dedupeMapSizeForTests, shouldRecordUsageEvent } from "@/lib/telemetry/usageEventDedupe";

/**
 * Workstream H (v.5) usage-event dedupe — pure in-memory Map logic, no DB
 * import (same convention as `preAuthRateLimit.test.ts`).
 *
 * Run: cd apps/web && ../worker/node_modules/.bin/tsx src/lib/usageEventDedupe.test.ts
 */

_clearDedupeForTests();

describe("shouldRecordUsageEvent", () => {
  // These assertions share one in-memory dedupe map and depend on running in
  // this exact order, so they stay in a single `it()` rather than being split.
  it("dedupes on the full (userId, eventType, path) triple", () => {
    // First occurrence of a (userId, eventType, path) triple is always allowed.
    expect(shouldRecordUsageEvent("u1", "page_view", "/library")).toBe(true);

    // A repeat within the window is suppressed.
    expect(shouldRecordUsageEvent("u1", "page_view", "/library")).toBe(false);

    // A DIFFERENT event type for the SAME user+path is NOT suppressed — this is
    // the exact collision `TelemetryBeacon.tsx` produces on every fresh page
    // load (session_start + page_view, same path, same instant), and the key
    // deliberately includes eventType to avoid one silently swallowing the other.
    expect(shouldRecordUsageEvent("u1", "session_start", "/library")).toBe(true);

    // A different path for the same user+eventType is its own key.
    expect(shouldRecordUsageEvent("u1", "page_view", "/dashboard")).toBe(true);

    // A different user is never deduped against another user's identical event.
    expect(shouldRecordUsageEvent("u2", "page_view", "/library")).toBe(true);

    // null path is its own valid key, independent of a real path.
    expect(shouldRecordUsageEvent("u1", "page_view", null)).toBe(true);
    expect(shouldRecordUsageEvent("u1", "page_view", null)).toBe(false);
  });

  // ADVERSARIAL: flooding with far more distinct keys than the cap must not
  // grow the map without bound (same shape as preAuthRateLimit.ts's own
  // adversarial test).
  it("dedupe map must stay bounded under a distinct-key flood", () => {
    _clearDedupeForTests();
    for (let i = 0; i < 25_000; i += 1) {
      shouldRecordUsageEvent(`flood-${i}`, "page_view", "/x");
    }
    const size = _dedupeMapSizeForTests();
    // `dedupe map must stay bounded under a distinct-key flood, got ${size}`
    expect(size <= 10_000).toBeTruthy();
  });
});
