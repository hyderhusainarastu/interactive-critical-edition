import { NextResponse } from "next/server";
import { getEvidenceChamberView } from "@/lib/research/chambers";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

export async function GET(_request: Request, { params }: { params: Promise<{ chamberId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const { chamberId } = await params;
  const chamber = await getEvidenceChamberView(userId, chamberId);
  return chamber ? NextResponse.json({ chamber }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
