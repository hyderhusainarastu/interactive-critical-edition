import { db, deletionCleanups, works } from "@ice/db";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getOwnedWork } from "@/lib/works";

/**
 * Restores a trashed work (plan §34.4 9.7) — clears `deletedAt`. Idempotent:
 * restoring an already-live work is a no-op, not an error.
 *
 * Phase 20.3: restoring also cancels any unfinished permanent-deletion
 * record for the work. Without this, a `storage_failed` cleanup row left by
 * a partial permanent delete would be "retried" on the next trash visit and
 * silently delete the work the user just restored. (The restore can only
 * win this race while the work row still exists — the state machine deletes
 * Storage bytes first and DB rows last, so a restorable work is by
 * definition one whose DB data is fully intact; at most an uploaded file
 * may already be gone, which reprocessing/upload can repair.)
 */
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
    await db
      .delete(deletionCleanups)
      .where(and(eq(deletionCleanups.userId, userId), eq(deletionCleanups.workId, workId)));
  }
  return NextResponse.json({ ok: true });
}
