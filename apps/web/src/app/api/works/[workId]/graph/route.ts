import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { buildGraph } from "@/lib/graph";
import { getOwnedDocument } from "@/lib/works";

/**
 * Work-scoped knowledge graph: the root work and everything it references,
 * with per-user read/unread/missing state (plan §9/§16). IDOR-safe.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const graph = await buildGraph(userId, workId);
  return NextResponse.json({ title: doc.title, analysisStatus: doc.analysisStatus, ...graph });
}
