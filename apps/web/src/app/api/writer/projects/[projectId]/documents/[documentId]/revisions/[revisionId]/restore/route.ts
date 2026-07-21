import { NextResponse } from "next/server";
import { getOwnedWriterDocument, restoreWriterDocumentRevision } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";

export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string; documentId: string; revisionId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId, documentId, revisionId } = await params;
  if (!await getOwnedWriterDocument(userId, projectId, documentId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const document = await restoreWriterDocumentRevision(documentId, revisionId);
  return document ? NextResponse.json(document) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
