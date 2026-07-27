import { NextResponse } from "next/server";
import { phase12FeatureEnabled } from "@ice/config";
import { CURRICULUM_ROUTES, type CurriculumRoute } from "@ice/curriculum";
import { READER_LEVELS, type ReaderLevelFilter } from "@ice/roadmap";
import { getApiUserId } from "@/lib/auth";
import { computeCurriculum } from "@/lib/curriculum";
import { getOwnedDocument } from "@/lib/works";

/**
 * Computes the curriculum/study guide for a work on demand (plan §34.4
 * 9.6) — recomputed each request from `resource_role`/`learning_resource`
 * (9.5) so it always reflects the latest Library data. Query param: route
 * (minimal|university|graduate). Also returns `routeCounts` so the client
 * can show per-route counts without a second request. IDOR-safe (404 for a
 * work you don't own).
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
  const routeParam = url.searchParams.get("route");
  const readerLevelParam = url.searchParams.get("readerLevel");
  const route: CurriculumRoute = (CURRICULUM_ROUTES as string[]).includes(routeParam ?? "")
    ? (routeParam as CurriculumRoute)
    : "university";
  const levelOptions = phase12FeatureEnabled("libraryIdentity")
    ? {
        readerLevel:
          readerLevelParam === "all" || (READER_LEVELS as string[]).includes(readerLevelParam ?? "")
            ? (readerLevelParam as ReaderLevelFilter)
            : "all",
      }
    : {};

  const result = await computeCurriculum(userId, workId, route, levelOptions);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ title: doc.title, ...result });
}
