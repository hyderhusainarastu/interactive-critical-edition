import type { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { enforceUserRateLimit } from "@/lib/api/apiRateLimit";
import { notFound, rateLimitResponse, unauthorized } from "@/lib/api/apiResponse";

/**
 * Either the authenticated user's id, or the `NextResponse` a route should
 * return instead (404 for a disabled release flag, 401 for no session, 429
 * for a tripped rate limit). Narrow with `isApiAuthError` before using.
 */
export type ApiAuthResult = string | NextResponse;

export function isApiAuthError(value: ApiAuthResult): value is NextResponse {
  return typeof value !== "string";
}

/**
 * The one API guard. Order of operations is load-bearing and matches what
 * the per-surface wrappers (`requireResearchApiUser`, `requireWriterApiUser`,
 * …) did independently before they became callers of this: feature check
 * first (404, NEVER 403 — flags are release controls, not authorization
 * controls), then auth (401), then rate limit (429).
 *
 * `rateLimit` is opt-in: when it is omitted `enforceUserRateLimit` is never
 * called at all, matching the routes that do not rate-limit today.
 */
export async function requireApiUser(opts?: {
  featureCheck?: () => boolean;
  rateLimit?: { scope: string; limit?: number; windowMs?: number };
}): Promise<ApiAuthResult> {
  if (opts?.featureCheck && !opts.featureCheck()) return notFound();
  const userId = await getApiUserId();
  if (!userId) return unauthorized();
  if (!opts?.rateLimit) return userId;
  const limit = await enforceUserRateLimit({
    userId,
    scope: opts.rateLimit.scope,
    limit: opts.rateLimit.limit ?? 120,
    windowMs: opts.rateLimit.windowMs ?? 60_000,
  });
  return limit.allowed ? userId : rateLimitResponse(limit);
}
