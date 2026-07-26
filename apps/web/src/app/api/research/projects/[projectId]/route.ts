import { NextResponse } from "next/server";
import { z } from "zod";
import { archiveResearchProject, getResearchProjectDetail, updateResearchProject } from "@/lib/research/projects";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().max(2000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
    archived: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: "Nothing to update." });

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const { projectId } = await params;
  const detail = await getResearchProjectDetail(userId, projectId);
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid project update." }, { status: 400 });
  const { projectId } = await params;
  const updated = await updateResearchProject(userId, projectId, parsed.data);
  return updated ? NextResponse.json({ project: updated }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Soft-archive only (see `archiveResearchProject`'s doc comment) — a
 *  research project's claims/jobs/revisions are real paid work product, so
 *  DELETE here is the same effect as `PATCH { archived: true }`, never a
 *  cascading hard delete. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const { projectId } = await params;
  const archived = await archiveResearchProject(userId, projectId);
  return archived ? NextResponse.json({ project: archived }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
