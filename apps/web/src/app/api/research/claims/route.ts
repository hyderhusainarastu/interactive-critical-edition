import { NextResponse } from "next/server";
import { z } from "zod";
import { listResearchClaims } from "@/lib/research/claims";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

const querySchema = z.object({
  projectId: z.string().uuid(),
  workId: z.string().uuid().optional(),
  claimNature: z.enum(["empirical", "textual", "interpretive", "historical", "conceptual", "normative", "definitional", "methodological"]).optional(),
  anchorState: z.enum(["anchored", "rebound", "unanchored"]).optional(),
  verificationStatus: z.enum(["unreviewed", "user_verified", "source_verified", "disputed", "rejected"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(request: Request) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid claims query." }, { status: 400 });
  const { projectId, page, pageSize, ...filters } = parsed.data;
  const result = await listResearchClaims(userId, projectId, filters, { page, pageSize });
  return NextResponse.json(result);
}
