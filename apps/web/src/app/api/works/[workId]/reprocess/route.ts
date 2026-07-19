import { db, enqueueExtractText, processingJobs } from "@ice/db";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/** Starts a fresh, isolated v2 run. Existing published runs remain readable
 * until the new run is fully persisted and published by the worker. */
export async function POST(_request: Request, { params }: { params: Promise<{ workId: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.ANALYSIS_PIPELINE !== "v2") {
    return NextResponse.json({ error: "Edition reprocessing is not enabled on this deployment." }, { status: 409 });
  }
  const { workId } = await params;
  const document = await getOwnedDocument(workId, userId);
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const jobId = await enqueueExtractText(document.documentId);
  await db.insert(processingJobs).values({ documentId: document.documentId, jobType: "edition-reprocess", status: "pending", pgBossJobId: jobId });
  return NextResponse.json({ ok: true });
}
