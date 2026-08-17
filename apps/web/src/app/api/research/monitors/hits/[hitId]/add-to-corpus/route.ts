import { NextResponse } from "next/server";
import { addMonitorHitToCorpus } from "@/lib/research/monitors";
import { isResearchApiError, requireMonitoringApiUser } from "@/lib/research/researchApi";
import { notFound } from "@/lib/api/apiResponse";

export async function POST(_request: Request, { params }: { params: Promise<{ hitId: string }> }) {
  const userId = await requireMonitoringApiUser();
  if (isResearchApiError(userId)) return userId;
  const { hitId } = await params;
  const result = await addMonitorHitToCorpus(userId, hitId);
  if (result.action === "not_found") return notFound();
  if (result.action === "unresolvable") return NextResponse.json({ error: result.reason }, { status: 409 });
  return NextResponse.json(result);
}
