import { NextResponse } from "next/server";
import { getResearchClaimDetail } from "@/lib/research/claims";
import { isResearchApiError, requireResearchApiUser } from "@/lib/research/researchApi";
import { notFound } from "@/lib/api/apiResponse";

export async function GET(_request: Request, { params }: { params: Promise<{ claimId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const { claimId } = await params;
  const claim = await getResearchClaimDetail(userId, claimId);
  return claim ? NextResponse.json({ claim }) : notFound();
}
