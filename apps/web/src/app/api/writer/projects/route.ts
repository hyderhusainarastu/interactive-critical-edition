import { NextResponse } from "next/server";
import { z } from "zod";
import { createWriterProject, listWriterProjects } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";

const createSchema = z.object({ title: z.string().trim().min(1).max(200) });

export async function GET(request: Request) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const archived = new URL(request.url).searchParams.get("archived") === "true";
  return NextResponse.json({ projects: await listWriterProjects(userId, archived) });
}

export async function POST(request: Request) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid project." }, { status: 400 });
  return NextResponse.json(await createWriterProject(userId, parsed.data.title), { status: 201 });
}
