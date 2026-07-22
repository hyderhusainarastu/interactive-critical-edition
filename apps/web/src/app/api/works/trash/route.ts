import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { listTrashedWorks, purgeExpiredTrash, retryPendingCleanups } from "@/lib/trash";

/**
 * Lists the caller's trashed works. Opportunistically resumes any unfinished
 * permanent deletions first (Phase 20.3 — a retryable `storage_failed`
 * cleanup must converge without a scheduler), then purges anything past its
 * 30-day window (plan §34.4 9.7 — see lib/trash.ts for why neither is a
 * scheduled job).
 */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await retryPendingCleanups(userId);
  await purgeExpiredTrash(userId);
  const items = await listTrashedWorks(userId);
  return NextResponse.json({ items });
}
