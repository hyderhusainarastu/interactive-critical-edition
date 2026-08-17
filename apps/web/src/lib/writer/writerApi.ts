import { phase12FeatureEnabled, phase25FeatureEnabled } from "@ice/config";
import { NextResponse } from "next/server";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";

/** Writer routes fail closed while the feature flag is off. */
export async function requireWriterApiUser(scope = "writer"): Promise<string | NextResponse> {
  return requireApiUser({
    featureCheck: () => phase12FeatureEnabled("writer"),
    rateLimit: { scope },
  });
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
  return requireApiUser({
    featureCheck: () => phase12FeatureEnabled("writer") && phase25FeatureEnabled("writerEvidence"),
    rateLimit: { scope },
  });
}

export const isWriterApiError = isApiAuthError;
