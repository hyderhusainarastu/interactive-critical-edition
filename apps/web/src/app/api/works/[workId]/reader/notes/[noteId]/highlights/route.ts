import { db, highlights, noteHighlights, notes } from "@ice/db";
import { phase12FeatureEnabled } from "@ice/config";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { getOwnedDocument } from "@/lib/library/works";
import { notFound } from "@/lib/api/apiResponse";

const schema = z.object({ highlightId: z.string().uuid() });

/** Attach an existing note to another user-owned selection without replacing its other links. */
export async function POST(request: Request, { params }: { params: Promise<{ workId: string; noteId: string }> }) {
  if (!phase12FeatureEnabled("interactiveReader")) return notFound();
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const { workId, noteId } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const document = await getOwnedDocument(workId, userId);
  if (!document) return notFound();
  const [[note], [highlight]] = await Promise.all([
    db.select({ id: notes.id }).from(notes).where(and(eq(notes.id, noteId), eq(notes.userId, userId), eq(notes.documentId, document.documentId))).limit(1),
    db.select({ id: highlights.id }).from(highlights).where(and(eq(highlights.id, parsed.data.highlightId), eq(highlights.userId, userId), eq(highlights.documentId, document.documentId))).limit(1),
  ]);
  if (!note || !highlight) return NextResponse.json({ error: "Note or highlight not found" }, { status: 404 });

  await db.insert(noteHighlights).values({ noteId, highlightId: highlight.id }).onConflictDoNothing();
  return NextResponse.json({ ok: true, noteId, highlightId: highlight.id });
}
