import { NextResponse } from "next/server";
import type { Expertise, RoadmapMode } from "@ice/roadmap";
import { getApiUserId } from "@/lib/auth";
import { computeRoadmap } from "@/lib/roadmap";
import { getOwnedDocument } from "@/lib/works";

/**
 * Computes the reading roadmap for a work on demand (plan §13) — a graph
 * traversal + ranking, recomputed each request so it always reflects the
 * latest analysis, ratings, and overrides. Query params: mode
 * (concise|comprehensive), expertise (beginner|intermediate|advanced),
 * maxMinutes (time budget). IDOR-safe (404 for a work you don't own).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const url = new URL(request.url);
  const mode = url.searchParams.get("mode");
  const expertise = url.searchParams.get("expertise");
  const maxMinutesRaw = url.searchParams.get("maxMinutes");

  const options = {
    mode: mode === "concise" || mode === "comprehensive" ? (mode as RoadmapMode) : undefined,
    expertise:
      expertise === "beginner" || expertise === "intermediate" || expertise === "advanced"
        ? (expertise as Expertise)
        : undefined,
    maxMinutes: maxMinutesRaw && Number.isFinite(Number(maxMinutesRaw)) ? Number(maxMinutesRaw) : undefined,
  };

  const result = await computeRoadmap(userId, workId, options);
  return NextResponse.json({
    title: doc.title,
    analysisStatus: doc.analysisStatus,
    ...result,
  });
}
