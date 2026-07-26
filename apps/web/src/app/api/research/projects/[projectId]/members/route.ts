import { NextResponse } from "next/server";
import { z } from "zod";
import { addResearchProjectWorkMember, removeResearchProjectMember } from "@/lib/research/projects";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

/**
 * Adds/removes a project member. Scoped to `memberType = "work"` this lane
 * (28.1) — see `lib/research/projects.ts`'s doc comment on
 * `addResearchProjectWorkMember` for why corpus/writer/RAG members aren't
 * exposed here yet.
 */
const postSchema = z.object({
  workId: z.string().uuid(),
  role: z.enum(["central", "supporting", "background"]).default("supporting"),
});

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid member." }, { status: 400 });
  const { projectId } = await params;
  const result = await addResearchProjectWorkMember(userId, projectId, parsed.data.workId, parsed.data.role);
  if (result === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ member: result }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const memberId = new URL(request.url).searchParams.get("memberId");
  if (!memberId) return NextResponse.json({ error: "memberId is required." }, { status: 400 });
  const { projectId } = await params;
  const removed = await removeResearchProjectMember(userId, projectId, memberId);
  return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
