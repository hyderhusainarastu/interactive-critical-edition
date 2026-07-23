import { db, documents, enqueueAnalyzeWork, processingRuns, works } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/auth";

const schema = z.object({
  title: z.string().min(1).max(500),
  authorName: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { workId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const [work] = await db
    .select({ id: works.id })
    .from(works)
    .where(and(eq(works.id, workId), eq(works.userId, userId)))
    .limit(1);
  if (!work) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db
    .update(works)
    .set({
      title: parsed.data.title,
      authorName: parsed.data.authorName || null,
      updatedAt: new Date(),
    })
    .where(eq(works.id, workId));

  const readied = await db
    .update(documents)
    .set({
      processingStatus: "ready",
      analysisStatus: "not_started",
      // D-20-52: the durable fact of a real user confirmation, distinct from
      // the mutable processingStatus proxy the worker's autoReady used to
      // rely on alone. Set once; idempotent on a later reprocess-triggered
      // re-confirmation (only needs to be non-null, not track which one).
      confirmedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(documents.workId, workId), eq(documents.processingStatus, "needs_review")),
    )
    .returning({ id: documents.id });

  // Kick off scholarly analysis now that the work is ready and its
  // metadata is user-confirmed (plan §23 Phase 4). Best-effort: a queue
  // hiccup must not fail the confirm itself — the user can re-trigger
  // analysis from the work page.
  //
  // Citation-wipe guard (D-23-3): ONLY enqueue the legacy analyze-work path
  // for legacy (v1) documents. A document processed by the edition pipeline
  // (v2/v3/v4) already ran its analysis inside handleEditionExtraction and
  // owns a richer, run-scoped, provider-resolved citation set; the legacy
  // analyzeWork() unconditionally deletes and re-extracts citations, which
  // would silently destroy that set. We detect "edition pipeline owns this"
  // data-driven — the presence of a `processing_run` for the document —
  // rather than reading ANALYSIS_PIPELINE, so this holds even if the web
  // env and worker env disagree. A true v1 document has no run and still
  // gets legacy analysis, exactly as before. (Defense in depth: analyzeWork
  // itself carries the same guard for stale queued jobs and env drift.)
  if (readied[0]) {
    const [editionRun] = await db
      .select({ id: processingRuns.id })
      .from(processingRuns)
      .where(eq(processingRuns.documentId, readied[0].id))
      .limit(1);
    if (!editionRun) {
      try {
        await enqueueAnalyzeWork(readied[0].id);
      } catch (err) {
        console.error("[confirm] failed to enqueue analysis", err);
      }
    } else {
      // The edition pipeline already produced the authoritative analysis, so
      // no analyze-work job is enqueued above. The `readied` UPDATE reset
      // analysisStatus to "not_started" for the legacy (v1) path; for an
      // edition document nothing would ever re-drive it, leaving the reader
      // polling forever (ReaderShell polls while status is "not_started") and
      // the roadmap/analysis badge stuck as "Not analyzed". Record the honest
      // terminal status — the same "complete" that extraction set and that
      // analyzeWork's own guard would set — so the UI settles. Idempotent.
      await db
        .update(documents)
        .set({ analysisStatus: "complete", updatedAt: new Date() })
        .where(eq(documents.id, readied[0].id));
    }
  }

  return NextResponse.json({ ok: true });
}
