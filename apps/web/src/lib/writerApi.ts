import { phase12FeatureEnabled } from "@ice/config";
import { NextResponse } from "next/server";
import { getApiUserId } from "./auth";
import { enforceUserRateLimit } from "./apiRateLimit";
import { rateLimitResponse } from "./apiResponse";

/** Writer routes fail closed while the feature flag is off. */
export async function requireWriterApiUser(scope = "writer"): Promise<string | NextResponse> {
  if (!phase12FeatureEnabled("writer")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = await enforceUserRateLimit({ userId, scope, limit: 120, windowMs: 60_000 });
  return limit.allowed ? userId : rateLimitResponse(limit);
}

export function isWriterApiError(value: string | NextResponse): value is NextResponse {
  return typeof value !== "string";
}
