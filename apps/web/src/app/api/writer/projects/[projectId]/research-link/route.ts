import { NextResponse } from "next/server";
import { z } from "zod";
import { listResearchProjects } from "@/lib/research/projects";
import { getLinkedResearchProject, linkWriterProjectToResearchProject, unlinkWriterProjectFromResearchProject } from "@/lib/research/writerEvidence";
import { getOwnedWriterProject } from "@/lib/writerData";
import { isWriterApiError, requireWriterEvidenceApiUser } from "@/lib/writerApi";

/**
 * Phase 28.5: links/unlinks this writer project to one of the caller's own
 * research projects (`research_project_member`, `member_type =
 * "writer_project"`). GET also returns the caller's research-project list so
 * the Writer's own picker never has to depend on `PHASE_25_RESEARCH_ENABLED`
 * being on too — `writerEvidence` is its own independent gate (see
 * `requireWriterEvidenceApiUser`'s doc comment).
 */
const postSchema = z.object({ researchProjectId: z.string().uuid() });

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterEvidenceApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId } = await params;
  if (!await getOwnedWriterProject(userId, projectId, true)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [linked, options] = await Promise.all([
    getLinkedResearchProject(userId, projectId),
    listResearchProjects(userId),
  ]);
  return NextResponse.json({ linked, options: options.map((project) => ({ id: project.id, title: project.title })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterEvidenceApiUser();
  if (isWriterApiError(userId)) return userId;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid research project." }, { status: 400 });
  const { projectId } = await params;
  const linked = await linkWriterProjectToResearchProject(userId, projectId, parsed.data.researchProjectId);
  if (linked === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ linked }, { status: 201 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterEvidenceApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId } = await params;
  const removed = await unlinkWriterProjectFromResearchProject(userId, projectId);
  return removed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
