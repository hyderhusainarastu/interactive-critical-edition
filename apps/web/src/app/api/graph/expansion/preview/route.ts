import { phase12FeatureEnabled } from "@ice/config";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { enforceUserRateLimit } from "@/lib/api/apiRateLimit";
import { notFound, rateLimitResponse } from "@/lib/api/apiResponse";
import { getGraphExpansionPreview, MANUAL_GRAPH_CANDIDATE_CAP } from "@/lib/graph/graphExpansion";

const querySchema = z.object({ workId: z.string().uuid(), candidates: z.coerce.number().int().min(1).max(MANUAL_GRAPH_CANDIDATE_CAP).optional() });

export async function GET(request: Request) {
  if (!phase12FeatureEnabled("crossLibraryGraph")) return notFound();
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const rate = await enforceUserRateLimit({ userId, scope: "graph-expansion-preview", limit: 60, windowMs: 60_000 });
  if (!rate.allowed) return rateLimitResponse(rate);
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid graph expansion preview." }, { status: 400 });
  const preview = await getGraphExpansionPreview(userId, parsed.data.workId, parsed.data.candidates);
  if (!preview) return notFound();
  return NextResponse.json({
    availableCandidates: preview.availableCandidates,
    hasGroundedClaims: preview.hasGroundedClaims,
    manual: {
      candidateCount: preview.manual.candidateCount,
      requiresConfirmation: preview.manual.requiresConfirmation,
    },
  });
}
