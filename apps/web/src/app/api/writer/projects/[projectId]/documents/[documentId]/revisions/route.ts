import { NextResponse } from "next/server";
import { getOwnedWriterDocument, listWriterDocumentRevisions } from "@/lib/writerData";
import { isWriterApiError, requireWriterApiUser } from "@/lib/writerApi";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; documentId: string }> }) {
  const userId = await requireWriterApiUser();
  if (isWriterApiError(userId)) return userId;
  const { projectId, documentId } = await params;
  if (!await getOwnedWriterDocument(userId, projectId, documentId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ revisions: await listWriterDocumentRevisions(documentId) });
}
