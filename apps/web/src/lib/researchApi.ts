import { phase25FeatureEnabled } from "@ice/config";
import { NextResponse } from "next/server";
import { getApiUserId } from "./auth";
import { enforceUserRateLimit } from "./apiRateLimit";
import { rateLimitResponse } from "./apiResponse";

/**
 * Research workspace routes fail closed while `PHASE_25_RESEARCH_ENABLED`
 * is off (404, matching `phase25FeatureEnabled`'s own doc comment: flags are
 * release controls, not authorization controls) — but every route still
 * does its own auth+ownership check regardless of what the flag says, the
 * same `requireWriterApiUser` precedent this mirrors.
 */
export async function requireResearchApiUser(scope = "research"): Promise<string | NextResponse> {
  if (!phase25FeatureEnabled("research")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = await enforceUserRateLimit({ userId, scope, limit: 120, windowMs: 60_000 });
  return limit.allowed ? userId : rateLimitResponse(limit);
}

export function isResearchApiError(value: string | NextResponse): value is NextResponse {
  return typeof value !== "string";
}
