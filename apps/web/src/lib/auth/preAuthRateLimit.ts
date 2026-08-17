import { NextResponse } from "next/server";

/**
 * In-memory fixed-window rate limiter for PRE-SESSION routes (register,
 * password-reset request, reset-password) — the ones that send email or
 * accept a reset token before any user is authenticated.
 *
 * Why not `enforceUserRateLimit` (the shared DB limiter in `apiRateLimit.ts`)?
 * That limiter's `api_rate_limit.user_id` is a NOT NULL uuid with an FK to
 * `users.id`, so it can only key a limit by a real authenticated user. A
 * pre-session request has no user to key on (the whole point of these routes),
 * so it needs a keyless mechanism.
 *
 * Honest limitation (stated, not hidden): this Map lives in a single process.
 * On a serverless platform (Vercel) each warm lambda instance keeps its own
 * counters, so the effective global limit is `perKeyLimit × liveInstances`,
 * not a hard cluster-wide cap. It still raises the cost of email-bombing one
 * victim or mass-registering by a large constant, with zero schema change and
 * zero cross-request state to get wrong. The durable, cluster-wide version is
 * a text-keyed rate-limit table (a migration, owner-gated) — tracked as a
 * register finding, not built here.
 */

type Bucket = { windowStartedAt: number; count: number };

const buckets = new Map<string, Bucket>();
// Bound memory: if the map grows past this, drop entries whose window is
// already stale. Fixed-window keys are `${scope}:${identity}:${windowStart}`,
// so stale ones are never revisited and are always safe to evict.
const MAX_TRACKED_KEYS = 10_000;

function windowStart(now: number, windowMs: number) {
  return Math.floor(now / windowMs) * windowMs;
}

function pruneIfLarge(now: number) {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  // First pass: drop windows old enough to never be counted against again.
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStartedAt > 2 * 60 * 60 * 1000) buckets.delete(key);
  }
  // Hard cap. A burst of >MAX_TRACKED_KEYS DISTINCT identities inside a single
  // window leaves nothing stale to drop, so the stale pass alone cannot bound
  // the map — it would grow without limit (and every later call would then do
  // an O(n) full scan). Evict the oldest-window entries until we are back under
  // the cap. Under such a flood a legitimate counter may reset early; that is
  // an acceptable trade against unbounded memory — this limiter is a
  // best-effort abuse throttle, and the durable cluster-wide table is the real
  // cap (see the header comment).
  if (buckets.size < MAX_TRACKED_KEYS) return;
  const target = Math.floor(MAX_TRACKED_KEYS * 0.9);
  const oldestFirst = [...buckets.entries()].sort(
    (a, b) => a[1].windowStartedAt - b[1].windowStartedAt,
  );
  for (const [key] of oldestFirst) {
    if (buckets.size <= target) break;
    buckets.delete(key);
  }
}

/** Test-only: current number of tracked buckets, to prove the memory bound. */
export function _bucketCountForTests(): number {
  return buckets.size;
}

export type PreAuthLimit = { scope: string; identity: string; limit: number; windowMs: number };

/**
 * Returns whether this call is allowed and, when not, how long to wait.
 * `identity` is any non-secret string (a client IP, or a lowercased email for
 * per-target throttling). Increments the counter as a side effect.
 */
export function checkPreAuthLimit(input: PreAuthLimit): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  pruneIfLarge(now);
  const start = windowStart(now, input.windowMs);
  const key = `${input.scope}:${input.identity}:${start}`;
  const current = buckets.get(key);
  const bucket: Bucket = current ?? { windowStartedAt: start, count: 0 };
  bucket.count += 1;
  buckets.set(key, bucket);
  return {
    allowed: bucket.count <= input.limit,
    retryAfterSeconds: Math.max(1, Math.ceil((start + input.windowMs - now) / 1000)),
  };
}

/**
 * Best-effort client identity for keying. Prefer the header the PLATFORM sets
 * and the client cannot forge: on Vercel `x-real-ip` is the true client IP
 * (Vercel overwrites it), whereas the LEFT-most `x-forwarded-for` hop is
 * client-supplied and spoofable — trusting it would let an attacker send a
 * fresh random value on every request, minting a new bucket each time and
 * defeating the per-IP throttle completely (and feeding unbounded map growth).
 * Fall back to the XFF left-most hop only when the platform header is absent
 * (local dev / other proxies), then to "unknown". Never used for
 * authorization, only for throttling; a determined attacker rotating REAL IPs
 * is the residual the durable cluster-wide table would also only partly catch.
 */
export function clientIdentity(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || "unknown";
  return "unknown";
}

/**
 * Enforces one or more pre-auth limits and returns a 429 response if ANY is
 * exceeded, otherwise null. The response mirrors `rateLimitResponse` so
 * clients see the same shape as authenticated throttling.
 */
export function preAuthRateLimit(...limits: PreAuthLimit[]): NextResponse | null {
  let worst = 0;
  for (const limit of limits) {
    const result = checkPreAuthLimit(limit);
    if (!result.allowed) worst = Math.max(worst, result.retryAfterSeconds);
  }
  if (worst === 0) return null;
  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    { status: 429, headers: { "Retry-After": String(worst) } },
  );
}
