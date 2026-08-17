import { apiRateLimits, db } from "@ice/db";
import { sql } from "drizzle-orm";

type RateLimitOptions = {
  userId: string;
  scope: string;
  limit: number;
  windowMs: number;
};

type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  backend: "database" | "memory-fallback";
};

type MemoryBucket = { windowStartedAt: number; count: number };
const memoryBuckets = new Map<string, MemoryBucket>();
const warnedSchemaFallbacks = new Set<string>();

function windowStart(now: number, windowMs: number) {
  return Math.floor(now / windowMs) * windowMs;
}

function memoryLimit(input: RateLimitOptions, now: number): RateLimitResult {
  const start = windowStart(now, input.windowMs);
  const key = `${input.userId}:${input.scope}`;
  const current = memoryBuckets.get(key);
  const bucket = !current || current.windowStartedAt !== start ? { windowStartedAt: start, count: 0 } : current;
  bucket.count += 1;
  memoryBuckets.set(key, bucket);
  return {
    allowed: bucket.count <= input.limit,
    limit: input.limit,
    remaining: Math.max(0, input.limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((start + input.windowMs - now) / 1000)),
    backend: "memory-fallback",
  };
}

function isMissingMigration(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /api_rate_limit|relation .* does not exist|undefined table/i.test(message);
}

/**
 * Shared fixed-window rate limit. The temporary memory fallback makes a
 * rolling deploy safe: old production databases never turn an authenticated
 * route into a 500 while the additive migration awaits rollout.
 */
export async function enforceUserRateLimit(input: RateLimitOptions): Promise<RateLimitResult> {
  const now = Date.now();
  const start = windowStart(now, input.windowMs);
  const startedAt = new Date(start);
  try {
    const [row] = await db
      .insert(apiRateLimits)
      .values({ userId: input.userId, scope: input.scope, windowStartedAt: startedAt, count: 1 })
      .onConflictDoUpdate({
        target: [apiRateLimits.userId, apiRateLimits.scope],
        set: {
          count: sql`case when ${apiRateLimits.windowStartedAt} < ${startedAt} then 1 else ${apiRateLimits.count} + 1 end`,
          windowStartedAt: sql`case when ${apiRateLimits.windowStartedAt} < ${startedAt} then ${startedAt} else ${apiRateLimits.windowStartedAt} end`,
          updatedAt: new Date(),
        },
      })
      .returning({ count: apiRateLimits.count, windowStartedAt: apiRateLimits.windowStartedAt });
    const effectiveStart = row.windowStartedAt.getTime();
    return {
      allowed: row.count <= input.limit,
      limit: input.limit,
      remaining: Math.max(0, input.limit - row.count),
      retryAfterSeconds: Math.max(1, Math.ceil((effectiveStart + input.windowMs - now) / 1000)),
      backend: "database",
    };
  } catch (error) {
    if (!isMissingMigration(error)) throw error;
    if (!warnedSchemaFallbacks.has(input.scope)) {
      warnedSchemaFallbacks.add(input.scope);
      console.warn(JSON.stringify({ level: "warn", event: "rate_limit_memory_fallback", scope: input.scope }));
    }
    return memoryLimit(input, now);
  }
}
