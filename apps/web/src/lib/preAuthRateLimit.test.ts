import assert from "node:assert/strict";
import {
  _bucketCountForTests,
  checkPreAuthLimit,
  clientIdentity,
  preAuthRateLimit,
} from "./preAuthRateLimit";

/**
 * Phase 23.4 (backend hardening): pre-session email-abuse throttle.
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `graphEdgeCategory.test.ts` — no DB import, so no DATABASE_URL needed).
 */

// Allows up to the limit, then blocks within the same fixed window.
{
  const opts = { scope: "t-allow", identity: "1.1.1.1", limit: 3, windowMs: 60_000 };
  assert.equal(checkPreAuthLimit(opts).allowed, true);
  assert.equal(checkPreAuthLimit(opts).allowed, true);
  assert.equal(checkPreAuthLimit(opts).allowed, true);
  const blocked = checkPreAuthLimit(opts);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
}

// Keys independently by identity — one client's flood never blocks another.
{
  const base = { scope: "t-identity", limit: 1, windowMs: 60_000 };
  assert.equal(checkPreAuthLimit({ ...base, identity: "a" }).allowed, true);
  assert.equal(checkPreAuthLimit({ ...base, identity: "b" }).allowed, true);
  assert.equal(checkPreAuthLimit({ ...base, identity: "a" }).allowed, false);
}

// preAuthRateLimit returns a 429 when ANY of the supplied limits is exceeded —
// here the per-email limit trips while the per-IP one is still fine (the
// targeted-victim case the request-reset route relies on).
{
  const ip = { scope: "t-multi-ip", identity: "3.3.3.3", limit: 5, windowMs: 60_000 };
  const email = { scope: "t-multi-email", identity: "victim@example.test", limit: 1, windowMs: 60_000 };
  assert.equal(preAuthRateLimit(ip, email), null);
  const res = preAuthRateLimit(ip, email);
  assert.ok(res !== null);
  assert.equal(res!.status, 429);
  assert.ok(res!.headers.get("Retry-After"));
}

// clientIdentity: left-most x-forwarded-for hop, then x-real-ip, then unknown.
assert.equal(
  clientIdentity(new Request("http://localhost/api", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } })),
  "9.9.9.9",
);
assert.equal(
  clientIdentity(new Request("http://localhost/api", { headers: { "x-real-ip": "8.8.8.8" } })),
  "8.8.8.8",
);
assert.equal(clientIdentity(new Request("http://localhost/api")), "unknown");

// ADVERSARIAL (attack b): a client-supplied left-most x-forwarded-for must NOT
// override the platform-set x-real-ip — otherwise the per-IP throttle is
// bypassable by spraying a fresh spoofed XFF value every request.
assert.equal(
  clientIdentity(
    new Request("http://localhost/api", {
      headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "8.8.8.8" },
    }),
  ),
  "8.8.8.8",
);

// ADVERSARIAL (attack a): spraying far more distinct identities than the cap
// must NOT grow the bucket map without bound. Fixed-window keys are unique per
// identity, so a naive stale-only prune would never evict inside one window;
// the map must stay bounded regardless.
{
  const before = _bucketCountForTests();
  for (let i = 0; i < 25_000; i++) {
    checkPreAuthLimit({ scope: "flood", identity: `spoof-${i}`, limit: 1, windowMs: 60_000 });
  }
  const after = _bucketCountForTests();
  assert.ok(
    after <= 10_000,
    `bucket map must stay bounded under a distinct-key flood, got ${after} (was ${before})`,
  );
}

console.log("preAuthRateLimit.test.ts: all assertions passed");
