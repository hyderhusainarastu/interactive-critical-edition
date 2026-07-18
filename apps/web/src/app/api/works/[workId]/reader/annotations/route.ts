import { NextResponse } from "next/server";
import { getAnnotationsForDocument } from "@/lib/annotations";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/**
 * Lists a document's annotations plus current analysis status — used by
 * the reader to poll while analysis runs and to refresh after a
 * re-analysis, without re-fetching the whole document/text payload.
 * IDOR-safe: 404 (not 403) for a work the caller doesn't own.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const annotations = await getAnnotationsForDocument(doc.documentId);
  return NextResponse.json({
    analysisStatus: doc.analysisStatus,
    analysisError: doc.analysisError,
    annotations,
  });
}
