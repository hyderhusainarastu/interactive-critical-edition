import { bookmarks, db } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isApiAuthError, requireApiUser } from "@/lib/api/apiAuth";
import { notFound } from "@/lib/api/apiResponse";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workId: string; bookmarkId: string }> },
) {
  const userId = await requireApiUser();
  if (isApiAuthError(userId)) return userId;
  const { bookmarkId } = await params;

  const deleted = await db
    .delete(bookmarks)
    .where(and(eq(bookmarks.id, bookmarkId), eq(bookmarks.userId, userId)))
    .returning({ id: bookmarks.id });

  if (deleted.length === 0) {
    return notFound();
  }

  return NextResponse.json({ ok: true });
}
