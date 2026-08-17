import { NextResponse } from "next/server";
import type { enforceUserRateLimit } from "@/lib/api/apiRateLimit";

/**
 * The error responses API routes actually share.
 *
 * Only these three exist because only these three had a shared body worth
 * naming. 94 of the 98 hand-rolled 404s used the identical `"Not found"`
 * literal, and every 401 used the identical `"Unauthorized"` one — so both
 * collapse cleanly. The 400s, the 409s and the single 403, by contrast, each
 * carry a distinct message; a helper for them would only move a unique string
 * from one line to another, so those routes still build their own response.
 */

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

export function rateLimitResponse(result: Awaited<ReturnType<typeof enforceUserRateLimit>>) {
  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}
