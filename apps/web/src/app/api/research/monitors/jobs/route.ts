import { NextResponse } from "next/server";
import { listResearchJobRequestsForUserMonitors } from "@/lib/research/monitors";
import { isResearchApiError, requireMonitoringApiUser } from "@/lib/researchApi";

/** Backs the Monitors view's job-status polling (Item 1(b)/3 of the
 *  Research-workspace fix lane) — `run_monitor` request rows for the
 *  caller's own monitors, optionally narrowed to one project. */
export async function GET(request: Request) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  return NextResponse.json({ requests: await listResearchJobRequestsForUserMonitors(userId, projectId) });
}
