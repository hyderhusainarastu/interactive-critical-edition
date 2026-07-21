import { db, writerProjects } from "@ice/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getOwnedWriterProject, getWriterProjectWorkspace } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
  archived: z.boolean().optional(),
  confirmArchive: z.literal(true).optional(),
}).refine((input) => Object.keys(input).some((key) => key !== "confirmArchive"))
  .refine((input) => input.archived !== true || input.confirmArchive === true, { message: "Archiving requires explicit confirmation." });

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId } = await params;
  const workspace = await getWriterProjectWorkspace(userId, projectId);
  return workspace ? NextResponse.json(workspace) : NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid project update." }, { status: 400 });
  const { projectId } = await params;
  const project = await getOwnedWriterProject(userId, projectId, true);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [updated] = await db.update(writerProjects).set({
    ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
    ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
    ...(parsed.data.archived !== undefined ? { archivedAt: parsed.data.archived ? new Date() : null } : {}),
    updatedAt: new Date(),
  }).where(eq(writerProjects.id, project.id)).returning();
  return NextResponse.json(updated);
}
