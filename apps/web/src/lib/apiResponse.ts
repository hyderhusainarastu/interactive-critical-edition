import { NextResponse } from "next/server";
import type { enforceUserRateLimit } from "./apiRateLimit";

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
