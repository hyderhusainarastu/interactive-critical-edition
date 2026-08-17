import { describe, expect, it } from "vitest";
import {
  _bucketCountForTests,
  checkPreAuthLimit,
  clientIdentity,
  preAuthRateLimit,
} from "@/lib/auth/preAuthRateLimit";

/**
 * Phase 23.4 (backend hardening): pre-session email-abuse throttle.
 * Run via `pnpm --filter worker exec tsx <absolute-path>` (same convention as
 * `graphEdgeCategory.test.ts` — no DB import, so no DATABASE_URL needed).
 */

describe("preAuthRateLimit", () => {
  // Allows up to the limit, then blocks within the same fixed window.
  it("allows up to the limit, then blocks within the same fixed window", () => {
    const opts = { scope: "t-allow", identity: "1.1.1.1", limit: 3, windowMs: 60_000 };
    expect(checkPreAuthLimit(opts).allowed).toBe(true);
    expect(checkPreAuthLimit(opts).allowed).toBe(true);
    expect(checkPreAuthLimit(opts).allowed).toBe(true);
    const blocked = checkPreAuthLimit(opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds > 0).toBeTruthy();
  });

  // Keys independently by identity — one client's flood never blocks another.
  it("keys independently by identity — one client's flood never blocks another", () => {
    const base = { scope: "t-identity", limit: 1, windowMs: 60_000 };
    expect(checkPreAuthLimit({ ...base, identity: "a" }).allowed).toBe(true);
    expect(checkPreAuthLimit({ ...base, identity: "b" }).allowed).toBe(true);
    expect(checkPreAuthLimit({ ...base, identity: "a" }).allowed).toBe(false);
  });

  // preAuthRateLimit returns a 429 when ANY of the supplied limits is exceeded —
  // here the per-email limit trips while the per-IP one is still fine (the
  // targeted-victim case the request-reset route relies on).
  it("returns a 429 when ANY of the supplied limits is exceeded (per-email trips while per-IP is fine)", () => {
    const ip = { scope: "t-multi-ip", identity: "3.3.3.3", limit: 5, windowMs: 60_000 };
    const email = { scope: "t-multi-email", identity: "victim@example.test", limit: 1, windowMs: 60_000 };
    expect(preAuthRateLimit(ip, email)).toBe(null);
    const res = preAuthRateLimit(ip, email);
    expect(res !== null).toBeTruthy();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toBeTruthy();
  });

  // clientIdentity: left-most x-forwarded-for hop, then x-real-ip, then unknown.
  it("clientIdentity: left-most x-forwarded-for hop, then x-real-ip, then unknown", () => {
    expect(
      clientIdentity(new Request("http://localhost/api", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } })),
    ).toBe("9.9.9.9");
    expect(clientIdentity(new Request("http://localhost/api", { headers: { "x-real-ip": "8.8.8.8" } }))).toBe("8.8.8.8");
    expect(clientIdentity(new Request("http://localhost/api"))).toBe("unknown");
  });

  // ADVERSARIAL (attack b): a client-supplied left-most x-forwarded-for must NOT
  // override the platform-set x-real-ip — otherwise the per-IP throttle is
  // bypassable by spraying a fresh spoofed XFF value every request.
  it("ADVERSARIAL (attack b): a client-supplied x-forwarded-for must not override the platform-set x-real-ip", () => {
    expect(
      clientIdentity(
        new Request("http://localhost/api", {
          headers: { "x-forwarded-for": "6.6.6.6", "x-real-ip": "8.8.8.8" },
        }),
      ),
    ).toBe("8.8.8.8");
  });

  // ADVERSARIAL (attack a): spraying far more distinct identities than the cap
  // must NOT grow the bucket map without bound. Fixed-window keys are unique per
  // identity, so a naive stale-only prune would never evict inside one window;
  // the map must stay bounded regardless.
  it("ADVERSARIAL (attack a): the bucket map stays bounded under a distinct-key flood", () => {
    const before = _bucketCountForTests();
    for (let i = 0; i < 25_000; i++) {
      checkPreAuthLimit({ scope: "flood", identity: `spoof-${i}`, limit: 1, windowMs: 60_000 });
    }
    const after = _bucketCountForTests();
    expect(
      after <= 10_000,
      `bucket map must stay bounded under a distinct-key flood, got ${after} (was ${before})`,
    ).toBeTruthy();
  });
});
