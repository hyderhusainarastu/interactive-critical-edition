import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getPassageContextById, listRecentPassageContexts } from "@/lib/passages";

/**
 * Backs the Knowledge Map context chooser's "Passage" tab (spec §2.1/§2.3) —
 * an owner-scoped, cross-work recency listing of `passage_annotation` rows.
 * No feature-flag gate: passage annotations are core reader data (Phase 9.3),
 * not a Phase 25 research-workspace surface, matching the ungated pattern
 * `GET /api/works` (the chooser's own "Work" tab data source) already uses.
 *
 * `?id=<passageAnnotationId>` resolves a single context by id instead (URL-
 * state reconstruction / deep-link resolution, for an id that may be older
 * than the "recent" window this route's default listing caps at).
 */
export async function GET(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const passage = await getPassageContextById(userId, id);
    return passage ? NextResponse.json({ passage }) : NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(50, Math.max(1, Number.parseInt(limitParam, 10) || 20)) : 20;
  const passages = await listRecentPassageContexts(userId, limit);
  return NextResponse.json({ passages });
}
