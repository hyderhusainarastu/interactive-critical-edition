import { NextResponse } from "next/server";
import { getDebateClusterById, listRecentDebateClusters } from "@/lib/research/debates";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

/**
 * Backs the Knowledge Map context chooser's "Debate" tab (spec §2.1/§2.3) —
 * an owner-scoped, CROSS-PROJECT recency listing of `debate_cluster` rows.
 * The existing debate-cluster surface (`lib/research/debates.ts`'s
 * `listDebateClustersForProject`, `/research/debates/[clusterId]`) is
 * per-project, not an owner-scoped cross-project listing — this route is
 * the genuinely-additive gap the spec identifies, no new table/migration.
 *
 * `?id=<clusterId>` resolves a single cluster by id instead (URL-state
 * reconstruction / deep-link resolution, for an id that may be older than
 * the "recent" window this route's default listing caps at).
 */
export async function GET(request: Request) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const cluster = await getDebateClusterById(userId, id);
    return cluster ? NextResponse.json({ cluster }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(50, Math.max(1, Number.parseInt(limitParam, 10) || 20)) : 20;
  const debates = await listRecentDebateClusters(userId, limit);
  return NextResponse.json({ debates });
}
