import { db, documents, processingRuns, works } from "@ice/db";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workId } = await params;

  const [row] = await db
    .select({
      title: works.title,
      documentId: documents.id,
      authorName: works.authorName,
      status: documents.processingStatus,
      extractedTitle: documents.extractedTitle,
      extractedAuthor: documents.extractedAuthor,
      processingError: documents.processingError,
      deletedAt: works.deletedAt,
    })
    .from(works)
    .innerJoin(documents, eq(documents.workId, works.id))
    .where(and(eq(works.id, workId), eq(works.userId, userId)))
    .limit(1);

  // 404, not 403 — don't reveal whether a work id exists for another user.
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [run] = await db.select({
    version: processingRuns.version,
    pipelineVersion: processingRuns.pipelineVersion,
    stage: processingRuns.stage,
    structureState: processingRuns.structureState,
    runStatus: processingRuns.status,
    published: processingRuns.isPublished,
    note: processingRuns.note,
  }).from(processingRuns).where(eq(processingRuns.documentId, row.documentId)).orderBy(desc(processingRuns.version)).limit(1);
  return NextResponse.json({ ...row, processingRun: run ?? null });
}
