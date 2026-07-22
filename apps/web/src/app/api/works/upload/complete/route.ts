import { db, documents, enqueueExtractText, processingJobs, works } from "@ice/db";
import { deleteDocumentFile, getDocumentFileSize } from "@ice/ingestion";
import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";
import { enforceUserRateLimit } from "@/lib/apiRateLimit";
import { rateLimitResponse } from "@/lib/apiResponse";
import { reportWebError } from "@/lib/telemetry";

const schema = z.object({ workId: z.string().uuid(), documentId: z.string().uuid() });
const USER_STORAGE_QUOTA_BYTES = 500 * 1024 * 1024;
export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rate = await enforceUserRateLimit({ userId, scope: "upload-complete", limit: 30, windowMs: 60 * 60_000 });
  if (!rate.allowed) return rateLimitResponse(rate);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid upload completion." }, { status: 400 });
  const [document] = await db
    .select({ id: documents.id, fileSize: documents.fileSize, storagePath: documents.storagePath })
    .from(documents)
    .where(and(eq(documents.id, input.data.documentId), eq(documents.workId, input.data.workId), eq(documents.userId, userId)))
    .limit(1);
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let storedSize: number | null;
  try {
    storedSize = await getDocumentFileSize(document.storagePath);
  } catch (error) {
    reportWebError(error, { scope: "api.upload.complete.metadata", userId, documentId: document.id, workId: input.data.workId });
    return NextResponse.json({ error: "Could not verify the uploaded file. Please retry shortly." }, { status: 502 });
  }
  if (storedSize === null) {
    // No object was ever PUT, so this reservation cannot be retried. Remove
    // it now rather than permanently consuming the user's quota.
    try {
      await db.delete(works).where(and(eq(works.id, input.data.workId), eq(works.userId, userId)));
    } catch (error) {
      reportWebError(error, { scope: "api.upload.complete.missing_cleanup", userId, documentId: document.id, workId: input.data.workId });
      return NextResponse.json({ error: "The missing upload could not be safely removed. Please retry shortly." }, { status: 502 });
    }
    return NextResponse.json({ error: "The upload was not found in Storage. Please upload the file again." }, { status: 400 });
  }
  if (storedSize !== document.fileSize) {
    try {
      await deleteDocumentFile(document.storagePath);
      await db.delete(works).where(and(eq(works.id, input.data.workId), eq(works.userId, userId)));
    } catch (error) {
      reportWebError(error, { scope: "api.upload.complete.mismatch_cleanup", userId, documentId: document.id, workId: input.data.workId });
      return NextResponse.json({ error: "The uploaded bytes could not be verified or safely removed. Please retry shortly." }, { status: 502 });
    }
    return NextResponse.json({ error: "Uploaded bytes do not match the selected file; the incomplete upload was removed." }, { status: 400 });
  }
  // The staged row already reserves its declared byte count, so the current
  // document is included once in this sum rather than added again.
  const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${documents.fileSize}), 0)` }).from(documents).where(eq(documents.userId, userId));
  const usedBytes = Number(used);
  if (!Number.isFinite(usedBytes) || usedBytes > USER_STORAGE_QUOTA_BYTES) return NextResponse.json({ error: "You've reached your storage quota (500MB). Remove an existing work and try again." }, { status: 413 });
  const [queued] = await db.update(documents)
    .set({ processingStatus: "processing", updatedAt: new Date() })
    .where(and(eq(documents.id, document.id), eq(documents.processingStatus, "uploaded")))
    .returning({ id: documents.id });
  if (!queued) return NextResponse.json({ error: "This upload has already been queued." }, { status: 409 });
  try {
    const jobId = await enqueueExtractText(document.id);
    await db.insert(processingJobs).values({ documentId: document.id, jobType: "extract-text", status: "pending", pgBossJobId: jobId });
  } catch (error) {
    await db.update(documents).set({ processingStatus: "uploaded", updatedAt: new Date() }).where(eq(documents.id, document.id));
    reportWebError(error, { scope: "api.upload.complete", userId, documentId: document.id, workId: input.data.workId });
    return NextResponse.json({ error: "Upload succeeded but processing could not be started. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ workId: input.data.workId });
}
