import { NextResponse } from "next/server";
import { getOwnedWriterDocument, listWriterDocumentRevisions } from "@/lib/writer/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writer/writerApi";
import { notFound } from "@/lib/api/apiResponse";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId, documentId } = await params;
  if (!await getOwnedWriterDocument(userId, projectId, documentId)) return notFound();
  return NextResponse.json({ revisions: await listWriterDocumentRevisions(documentId) });
}
