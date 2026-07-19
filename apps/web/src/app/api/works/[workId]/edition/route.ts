import { db, docFootnotes, generatedNotes, pages, processingRuns, textBlocks } from "@ice/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getOwnedDocument } from "@/lib/works";

/** The edition API intentionally reads only the published v2 run. Callers can
 * fall back to legacy reader endpoints when this returns `edition: null`. */
export async function GET(_request: Request, { params }: { params: Promise<{ workId: string }> }) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workId } = await params;
  const document = await getOwnedDocument(workId, userId);
  if (!document) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [run] = await db.select().from(processingRuns).where(and(eq(processingRuns.documentId, document.documentId), eq(processingRuns.isPublished, true))).limit(1);
  if (!run) return NextResponse.json({ edition: null });
  const editionPages = await db.select().from(pages).where(eq(pages.runId, run.id)).orderBy(asc(pages.pageIndex));
  const pageIds = editionPages.map((page) => page.id);
  const blocks = pageIds.length ? await db.select().from(textBlocks).where(inArray(textBlocks.pageId, pageIds)).orderBy(asc(textBlocks.blockOrder)) : [];
  const [authorialNotes, notes] = await Promise.all([
    db.select().from(docFootnotes).where(eq(docFootnotes.runId, run.id)).orderBy(asc(docFootnotes.createdAt)),
    db.select().from(generatedNotes).where(eq(generatedNotes.runId, run.id)).orderBy(asc(generatedNotes.createdAt)),
  ]);
  return NextResponse.json({ edition: { run, pages: editionPages, blocks, authorialNotes, generatedNotes: notes } });
}
