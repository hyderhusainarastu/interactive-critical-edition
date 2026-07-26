import { NextResponse } from "next/server";
import { listHitsForMonitor } from "@/lib/research/monitors";
import { isResearchApiError, requireMonitoringApiUser } from "@/lib/researchApi";

export async function GET(request: Request, { params }: { params: Promise<{ monitorId: string }> }) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const { monitorId } = await params;
  const includeDismissed = new URL(request.url).searchParams.get("includeDismissed") === "true";
  const hits = await listHitsForMonitor(userId, monitorId, { includeDismissed });
  return hits ? NextResponse.json({ hits }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
