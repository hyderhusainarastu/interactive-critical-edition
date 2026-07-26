import { phase12FeatureEnabled, phase25FeatureEnabled } from "@ice/config";
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

/**
 * Phase 28.5: the Writer evidence surfaces (project linking, the Evidence
 * panel, claim insertion) sit at the intersection of two independently
 * addressable release flags — Writer itself, and the evidence feature
 * specifically (`PHASE_25_WRITER_EVIDENCE_ENABLED`, off by default until the
 * humanities/claims pipeline is ready for this surface). Both must be on;
 * either being off 404s, matching `requireWriterApiUser`'s own "flags are
 * release controls, not authorization controls" posture — the auth+ownership
 * check below still always runs regardless of what either flag says.
 */
export async function requireWriterEvidenceApiUser(scope = "writer_evidence"): Promise<string | NextResponse> {
  if (!phase12FeatureEnabled("writer") || !phase25FeatureEnabled("writerEvidence")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const limit = await enforceUserRateLimit({ userId, scope, limit: 120, windowMs: 60_000 });
  return limit.allowed ? userId : rateLimitResponse(limit);
}

export function isWriterApiError(value: string | NextResponse): value is NextResponse {
  return typeof value !== "string";
}
