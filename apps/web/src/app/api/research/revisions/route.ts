import { NextResponse } from "next/server";
import { z } from "zod";
import { listResearchRevisions } from "@/lib/research/corrections";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

/** The revision-history drawer's read path — one object's chronological
 *  correction history, owner-scoped (see `listResearchRevisions`'s own doc
 *  comment for why no separate ownership join is needed here). */
const querySchema = z.object({
  objectType: z.enum(["claim", "relationship", "cluster", "chamber", "hypothesis", "gap"]),
  objectId: z.string().uuid(),
});

export async function GET(request: Request) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ objectType: url.searchParams.get("objectType"), objectId: url.searchParams.get("objectId") });
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  const revisions = await listResearchRevisions(userId, parsed.data.objectType, parsed.data.objectId);
  return NextResponse.json({ revisions });
}
