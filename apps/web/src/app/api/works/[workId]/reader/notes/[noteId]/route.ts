import { db, notes } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { notFound } from "@/lib/api/apiResponse";

const schema = z.object({ body: z.string().min(1).max(10000) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workId: string; noteId: string }> },
) {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const { noteId } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const updated = await db
    .update(notes)
    .set({ body: parsed.data.body, updatedAt: new Date() })
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning();

  if (updated.length === 0) {
    return notFound();
  }

  return NextResponse.json(updated[0]);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workId: string; noteId: string }> },
) {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const { noteId } = await params;

  const deleted = await db
    .delete(notes)
    .where(and(eq(notes.id, noteId), eq(notes.userId, userId)))
    .returning({ id: notes.id });

  if (deleted.length === 0) {
    return notFound();
  }

  return NextResponse.json({ ok: true });
}
