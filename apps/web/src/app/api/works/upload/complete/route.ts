import { db, documents, enqueueExtractText, processingJobs } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";

const schema = z.object({ workId: z.string().uuid(), documentId: z.string().uuid() });
export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Invalid upload completion." }, { status: 400 });
  const [document] = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, input.data.documentId), eq(documents.workId, input.data.workId), eq(documents.userId, userId))).limit(1);
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
    console.error("[upload/complete] could not queue extraction", error);
    return NextResponse.json({ error: "Upload succeeded but processing could not be started. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ workId: input.data.workId });
}
