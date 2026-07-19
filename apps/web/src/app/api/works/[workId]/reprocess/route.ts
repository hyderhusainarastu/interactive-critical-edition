import { db, enqueueExtractText, processingJobs, processingRuns } from "@ice/db";
import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/** Starts a fresh, isolated v2 run. Existing published runs remain readable
 * until the new run is fully persisted and published by the worker. Returns 202
 * with the projected version; the worker authoritatively allocates the run
 * version under a per-document advisory lock, so this is a best-effort preview
 * (surface the real run/version via the status endpoint). */
export async function POST(_request: Request, { params }: { params: Promise<{ workId: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (process.env.ANALYSIS_PIPELINE !== "v2") {
    return NextResponse.json({ error: "Edition reprocessing is not enabled on this deployment." }, { status: 409 });
  }
  const { workId } = await params;
  const document = await getOwnedDocument(workId, userId);
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ nextVersion }] = await db
    .select({ nextVersion: sql<number>`coalesce(max(${processingRuns.version}), 0) + 1` })
    .from(processingRuns)
    .where(eq(processingRuns.documentId, document.documentId));
  const jobId = await enqueueExtractText(document.documentId);
  await db.insert(processingJobs).values({ documentId: document.documentId, jobType: "edition-reprocess", status: "pending", pgBossJobId: jobId });
  return NextResponse.json({ status: "queued", projectedVersion: Number(nextVersion), jobId }, { status: 202 });
}
