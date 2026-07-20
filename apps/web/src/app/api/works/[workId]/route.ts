import { db, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getOwnedWork } from "@/lib/works";

/**
 * Soft-deletes a work (plan §34.4 9.7: "30-day work trash"). Sets
 * `deletedAt` only — no cascade, no Storage touch. Every reader/analysis/
 * roadmap/curriculum/graph route for this work becomes inaccessible
 * immediately after this (they all go through `getOwnedDocument()`, which
 * excludes trashed works); the work's own detail page and the trash
 * routes keep working via `getOwnedWork()`, which doesn't.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const work = await getOwnedWork(workId, userId);
  if (!work) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!work.deletedAt) {
    await db.update(works).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(works.id, workId));
  }
  return NextResponse.json({ ok: true });
}
