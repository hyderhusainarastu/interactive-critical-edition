import { NextResponse } from "next/server";
import { listRecentResearchClaims } from "@/lib/research/claims";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

/**
 * Backs the Knowledge Map context chooser's "Claim" tab (spec §2.1) — an
 * owner-scoped, CROSS-PROJECT recency listing of `research_claim` rows.
 *
 * Correction to `docs/design/knowledge-map-spec.md` §2.1: that section
 * assumed `GET /api/research/claims` (existing) could back this tab
 * "as-is". Reading that route's actual handler at implementation time (as
 * the spec's own methodology requires — §2.1's "verified against its own
 * handler at implementation time, not assumed") shows it REQUIRES a
 * `projectId` query param (`apps/web/src/app/api/research/claims/route.ts`)
 * — it is a per-project listing, not a cross-project one, so it cannot back
 * a flat "Claim" tab without first knowing which project. This route is
 * therefore a third genuinely-additive, owner-scoped, no-new-table read,
 * under the exact same charter §3 allowance the spec's own §2.3 already
 * uses for `/api/passages/recent`/`/api/research/debates` — not a silent
 * workaround, an explicit, documented correction.
 */
export async function GET(request: Request) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;

  const url = new URL(request.url);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(50, Math.max(1, Number.parseInt(limitParam, 10) || 20)) : 20;
  const claims = await listRecentResearchClaims(userId, limit);
  return NextResponse.json({ claims });
}
