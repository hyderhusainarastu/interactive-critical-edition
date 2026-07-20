import { db, works } from "@ice/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getOwnedWork } from "@/lib/works";

/** Restores a trashed work (plan §34.4 9.7) — clears `deletedAt`. Idempotent: restoring an already-live work is a no-op, not an error. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const work = await getOwnedWork(workId, userId);
  if (!work) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (work.deletedAt) {
    await db.update(works).set({ deletedAt: null, updatedAt: new Date() }).where(eq(works.id, workId));
  }
  return NextResponse.json({ ok: true });
}
