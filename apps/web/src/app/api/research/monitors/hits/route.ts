import { NextResponse } from "next/server";
import { listHitsForUser } from "@/lib/research/monitors";
import { isResearchApiError, requireMonitoringApiUser } from "@/lib/researchApi";

/** Every hit across every monitor the caller owns — the global
 *  `/research/monitors` view's feed (as opposed to
 *  `[monitorId]/hits`, one monitor's own feed). */
export async function GET(request: Request) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const url = new URL(request.url);
  const includeDismissed = url.searchParams.get("includeDismissed") === "true";
  const projectId = url.searchParams.get("projectId") ?? undefined;
  return NextResponse.json({ hits: await listHitsForUser(userId, { includeDismissed, projectId }) });
}
