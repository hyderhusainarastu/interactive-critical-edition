import { phase25FeatureEnabled } from "@ice/config";
import { NextResponse } from "next/server";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";

/**
 * Research workspace routes fail closed while `PHASE_25_RESEARCH_ENABLED`
 * is off (404, matching `phase25FeatureEnabled`'s own doc comment: flags are
 * release controls, not authorization controls) — but every route still
 * does its own auth+ownership check regardless of what the flag says, the
 * same `requireWriterApiUser` precedent this mirrors.
 */
export async function requireResearchApiUser(scope = "research"): Promise<string | NextResponse> {
  return requireApiUser({
    featureCheck: () => phase25FeatureEnabled("research"),
    rateLimit: { scope },
  });
}

export const isResearchApiError = isApiAuthError;

/**
 * Monitoring (Phase 29.1) lives under the `/research` workspace but is its
 * OWN independently-gated surface (`phase25FeatureEnabled("monitoring")`,
 * default off — "a scheduled job is the one surface here that can act
 * without a user present", `packages/config/src/phase25.ts`'s own doc
 * comment). Gated on BOTH flags: `research` (the whole workspace's own
 * gate — every `/research/*` page already 404s without it) AND
 * `monitoring` specifically, so monitoring can be pulled independently of
 * the rest of the research workspace without a second flag check
 * scattered across every monitor route.
 */
export async function requireMonitoringApiUser(scope = "research-monitoring"): Promise<string | NextResponse> {
  return requireApiUser({
    featureCheck: () => phase25FeatureEnabled("research") && phase25FeatureEnabled("monitoring"),
    rateLimit: { scope },
  });
}
