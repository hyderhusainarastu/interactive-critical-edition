import { NextResponse } from "next/server";
import { z } from "zod";
import { createWriterDocument, getOwnedWriterProject } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";

const schema = z.object({ title: z.string().trim().min(1).max(200) });

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid document." }, { status: 400 });
  const { projectId } = await params;
  if (!await getOwnedWriterProject(userId, projectId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await createWriterDocument(projectId, parsed.data.title), { status: 201 });
}
