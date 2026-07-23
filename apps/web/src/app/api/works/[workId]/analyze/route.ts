import { db, documents, enqueueAnalyzeWork } from "@ice/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { enforceUserRateLimit } from "@/lib/apiRateLimit";
import { rateLimitResponse } from "@/lib/apiResponse";
import { getOwnedDocument } from "@/lib/works";

/**
 * Manually (re-)trigger scholarly analysis for a ready work — used by the
 * "Analyze" / "Re-analyze" control on the work page and reader, and as
 * the recovery path if the automatic enqueue on confirm didn't fire.
 * Re-analysis is idempotent in the worker (clears prior system output,
 * keeps user edits — see apps/worker/src/analyze.ts).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Each enqueue starts a paid worker run. The `analyzing`-status guard below
  // blocks a concurrent double-run, but not a scripted sequential loop that
  // re-triggers once the prior run completes — this per-user cap is the cost
  // backstop against that, matching the money-bearing graph-expansion route.
  const rate = await enforceUserRateLimit({ userId, scope: "analyze-work", limit: 20, windowMs: 60 * 60_000 });
  if (!rate.allowed) return rateLimitResponse(rate);

  const { workId } = await params;
  const doc = await getOwnedDocument(workId, userId);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (doc.processingStatus !== "ready") {
    return NextResponse.json({ error: "This work isn't ready to analyze yet." }, { status: 409 });
  }
  if (doc.analysisStatus === "analyzing") {
    return NextResponse.json({ error: "Analysis is already running." }, { status: 409 });
  }

  await db
    .update(documents)
    .set({ analysisStatus: "analyzing", analysisError: null, updatedAt: new Date() })
    .where(eq(documents.id, doc.documentId));

  try {
    await enqueueAnalyzeWork(doc.documentId);
  } catch (err) {
    console.error("[analyze] enqueue failed", err);
    await db
      .update(documents)
      .set({ analysisStatus: "failed", analysisError: "Failed to queue analysis.", updatedAt: new Date() })
      .where(eq(documents.id, doc.documentId));
    return NextResponse.json({ error: "Failed to queue analysis." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, analysisStatus: "analyzing" });
}
