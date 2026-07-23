import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { buildGraph } from "@/lib/graph";
import {
  buildRoadmapGraph,
  isRoadmapLayoutRequested,
  parseRoadmapRankOptions,
  parseRoadmapRootParams,
} from "@/lib/roadmapGraph";
import { getOwnedDocument } from "@/lib/works";

/**
 * Work-scoped knowledge graph: the root work and everything it references,
 * with per-user read/unread/missing state (plan §9/§16). IDOR-safe.
 *
 * Roadmap layout (Phase 22.7): `?layout=roadmap` returns the roadmap
 * projection, defaulting the roadmap root to THIS work; additional uploads can
 * be folded in via repeatable `?roadmapRoot=work:<id>` params (the "incorporate
 * any additional uploads" dropdown). Without `layout=roadmap` the response is
 * byte-identical to before, so the committed `graph.spec.ts` stays green until
 * the client opts in (the roadmap-is-default decision lives in `GraphView`).
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

  const { searchParams } = new URL(request.url);
  if (isRoadmapLayoutRequested(searchParams)) {
    const extraRoots = parseRoadmapRootParams(searchParams);
    const roots = extraRoots.includes(workId) ? extraRoots : [workId, ...extraRoots];
    const graph = await buildRoadmapGraph(userId, roots, parseRoadmapRankOptions(searchParams));
    return NextResponse.json({ title: doc.title, analysisStatus: doc.analysisStatus, ...graph });
  }

  const graph = await buildGraph(userId, workId);
  return NextResponse.json({ title: doc.title, analysisStatus: doc.analysisStatus, ...graph });
}
