import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { getDeletionCleanup, purgeWorkNow } from "@/lib/trash";
import { getOwnedWork } from "@/lib/works";

/**
 * "Delete permanently now" (plan §34.4 9.7, hardened in Phase 20.3) — an
 * explicit user choice on the trash page, never something the system does on
 * its own. Only ever acts on an already-trashed work, so this can't be used
 * as a shortcut around the trash step itself.
 *
 * Runs the `@ice/deletion` state machine and reports its HONEST outcome:
 * `ok: true` only when every private Storage object and DB row is confirmed
 * gone. A partial failure returns `ok: false` with the persisted, retryable
 * state (HTTP 200 — the request itself was processed; the operation's state
 * is the body's contract, and the admin cleanup queue shows the same row).
 * Idempotent: repeating the request after completion reports the completed
 * deletion instead of failing.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ workId: string }> },
) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workId } = await params;
  const work = await getOwnedWork(workId, userId);
  if (!work) {
    // The work row may be gone because a prior request already deleted it —
    // answer a repeat request from the owner-scoped cleanup record instead
    // of 404ing on an operation that in fact succeeded (or is retryable).
    const cleanup = await getDeletionCleanup(userId, workId);
    if (cleanup?.status === "completed") {
      return NextResponse.json({ ok: true, outcome: "completed", alreadyCompleted: true });
    }
    if (cleanup) {
      return NextResponse.json({ ok: false, outcome: cleanup.status, message: "Deletion has not finished; it will be retried." });
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!work.deletedAt) return NextResponse.json({ error: "Not in trash" }, { status: 400 });

  const result = await purgeWorkNow(userId, workId, work.title);
  switch (result.outcome) {
    case "completed":
      return NextResponse.json({ ok: true, outcome: "completed", alreadyCompleted: result.alreadyCompleted });
    case "storage_failed":
      return NextResponse.json({
        ok: false,
        outcome: "storage_failed",
        pendingStorageObjects: result.pendingStoragePaths.length,
        message: "The work's uploaded file could not be fully removed. The deletion is recorded and will be retried.",
      });
    case "failed":
      return NextResponse.json({
        ok: false,
        outcome: "failed",
        stage: result.stage,
        message: "Deletion could not finish. It is recorded and will be retried.",
      });
  }
}
