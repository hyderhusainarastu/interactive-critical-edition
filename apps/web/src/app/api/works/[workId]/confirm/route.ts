import { db, documents, enqueueAnalyzeWork, works } from "@ice/db";
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
  if (readied[0]) {
    try {
      await enqueueAnalyzeWork(readied[0].id);
    } catch (err) {
      console.error("[confirm] failed to enqueue analysis", err);
    }
  }

  return NextResponse.json({ ok: true });
}
