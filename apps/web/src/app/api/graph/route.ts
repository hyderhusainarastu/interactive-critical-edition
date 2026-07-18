import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { buildGraph } from "@/lib/graph";

/**
 * Global knowledge graph: the user's whole library — every work and every
 * reference across all of them, with per-user read/unread/missing state
 * (plan §16 GlobalGraphView).
 */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const graph = await buildGraph(userId);
  return NextResponse.json({ title: "Your library", ...graph });
}
