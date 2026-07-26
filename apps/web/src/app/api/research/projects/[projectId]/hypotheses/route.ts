import { NextResponse } from "next/server";
import { listResearchGaps, listResearchHypotheses } from "@/lib/research/hypotheses";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const { projectId } = await params;
  const [hypotheses, gaps] = await Promise.all([listResearchHypotheses(userId, projectId), listResearchGaps(userId, projectId)]);
  return NextResponse.json({ hypotheses, gaps });
}
