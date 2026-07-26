import { NextResponse } from "next/server";
import { dismissMonitorHit } from "@/lib/research/monitors";
import { isResearchApiError, requireMonitoringApiUser } from "@/lib/researchApi";

export async function POST(_request: Request, { params }: { params: Promise<{ hitId: string }> }) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const { hitId } = await params;
  const dismissed = await dismissMonitorHit(userId, hitId);
  return dismissed ? NextResponse.json({ dismissed: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
