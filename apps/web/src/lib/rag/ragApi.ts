import { phase18RagEnabled } from "@ice/config";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { enforceUserRateLimit } from "@/lib/api/apiRateLimit";
import { rateLimitResponse } from "@/lib/api/apiResponse";

/** Phase 18 stays unavailable outside explicitly enabled local environments. */
export async function requireRagApiUser(scope: "rag-conversations" | "rag-answer" | "rag-competency-undo"): Promise<string | NextResponse> {
  if (!phase18RagEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rate = await enforceUserRateLimit({ userId, scope, limit: scope === "rag-answer" ? 20 : 60, windowMs: 60 * 60_000 });
  return rate.allowed ? userId : rateLimitResponse(rate);
}

export function isRagApiError(value: string | NextResponse): value is NextResponse {
  return typeof value !== "string";
}
