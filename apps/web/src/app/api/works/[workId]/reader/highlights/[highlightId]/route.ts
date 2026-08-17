import { db, highlights } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { notFound } from "@/lib/api/apiResponse";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workId: string; highlightId: string }> },
) {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const { highlightId } = await params;

  const deleted = await db
    .delete(highlights)
    .where(and(eq(highlights.id, highlightId), eq(highlights.userId, userId)))
    .returning({ id: highlights.id });

  if (deleted.length === 0) {
    return notFound();
  }

  return NextResponse.json({ ok: true });
}
