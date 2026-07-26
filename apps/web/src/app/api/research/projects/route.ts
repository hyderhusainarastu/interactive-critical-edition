import { NextResponse } from "next/server";
import { z } from "zod";
import { createResearchProject, listResearchProjects } from "@/lib/research/projects";
import { isResearchApiError, requireResearchApiUser } from "@/lib/researchApi";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(2000).optional(),
});

export async function GET(request: Request) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const archived = new URL(request.url).searchParams.get("archived") === "true";
  return NextResponse.json({ projects: await listResearchProjects(userId, archived) });
}

export async function POST(request: Request) {
  const userId = await requireResearchApiUser();
  if (isResearchApiError(userId)) return userId;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid project." }, { status: 400 });
  const project = await createResearchProject(userId, parsed.data.title, parsed.data.summary ?? null);
  return NextResponse.json({ project }, { status: 201 });
}
