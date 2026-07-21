import { NextResponse } from "next/server";
import { getOwnedWriterProject, listOwnedLibrarySources } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId } = await params;
  if (!await getOwnedWriterProject(userId, projectId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ sources: await listOwnedLibrarySources(userId) });
}
