import { NextResponse } from "next/server";
import { getOwnedWriterDocument, restoreWriterDocumentRevision } from "@/lib/writer/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writer/writerApi";
import { notFound } from "@/lib/api/apiResponse";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; documentId: string; revisionId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId, documentId, revisionId } = await params;
  if (!await getOwnedWriterDocument(userId, projectId, documentId)) return notFound();
  const document = await restoreWriterDocumentRevision(documentId, revisionId);
  return document ? NextResponse.json(document) : notFound();
}
