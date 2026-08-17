import { NextResponse } from "next/server";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { buildGraph } from "@/lib/graph";
import {
  buildRoadmapGraph,
  isRoadmapLayoutRequested,
  parseRoadmapRankOptions,
  parseRoadmapRootParams,
} from "@/lib/roadmap/roadmapGraph";

/**
 * Global knowledge graph: the user's whole library — every work and every
 * reference across all of them, with per-user read/unread/missing state
 * (plan §16 GlobalGraphView).
 *
 * Roadmap layout (Phase 22.7): `?layout=roadmap` returns the SAME single
 * payload with a `roadmap` annotation layered onto the reached nodes plus a
 * composed `hiddenItems` restore list. Without `layout=roadmap` the response is
 * byte-identical to before — the roadmap-is-default decision lives in
 * `GraphView` (it URL-syncs `layout=roadmap`), not here, which keeps every
 * pre-existing caller (and the committed `graph.spec.ts`) unchanged. Roots
 * default to all analyzed works; `?roadmapRoot=work:<id>` (repeatable) scopes it.
 */
export async function GET(request: Request) {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;

  const { searchParams } = new URL(request.url);
  if (isRoadmapLayoutRequested(searchParams)) {
    const roots = parseRoadmapRootParams(searchParams);
    const graph = await buildRoadmapGraph(userId, roots, parseRoadmapRankOptions(searchParams));
    return NextResponse.json({ title: "Your library", ...graph });
  }

  const graph = await buildGraph(userId);
  return NextResponse.json({ title: "Your library", ...graph });
}
