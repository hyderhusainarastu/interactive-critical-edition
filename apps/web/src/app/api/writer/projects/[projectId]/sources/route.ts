import { NextResponse } from "next/server";
import { getOwnedWriterProject, listOwnedLibrarySources } from "@/lib/writer/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writer/writerApi";
import { notFound } from "@/lib/api/apiResponse";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId } = await params;
  if (!await getOwnedWriterProject(userId, projectId)) return notFound();
  return NextResponse.json({ sources: await listOwnedLibrarySources(userId) });
}
