import { NextResponse } from "next/server";
import { z } from "zod";
import { addResearchProjectQuestion, deleteResearchProjectQuestion, updateResearchProjectQuestion } from "@/lib/research/projects";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

const postSchema = z.object({ question: z.string().trim().min(1).max(2000) });
const patchSchema = z
  .object({
    id: z.string().uuid(),
    question: z.string().trim().min(1).max(2000).optional(),
    sortOrder: z.number().int().min(0).max(100_000).optional(),
  })
  .refine((input) => input.question !== undefined || input.sortOrder !== undefined, { message: "Nothing to update." });
const deleteSchema = z.object({ id: z.string().uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid question." }, { status: 400 });
  const { projectId } = await params;
  const created = await addResearchProjectQuestion(userId, projectId, parsed.data.question);
  return created ? NextResponse.json({ question: created }, { status: 201 }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid question update." }, { status: 400 });
  const { projectId } = await params;
  const updated = await updateResearchProjectQuestion(userId, projectId, parsed.data.id, { question: parsed.data.question, sortOrder: parsed.data.sortOrder });
  return updated ? NextResponse.json({ question: updated }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { projectId } = await params;
  const deleted = await deleteResearchProjectQuestion(userId, projectId, parsed.data.id);
  return deleted ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
