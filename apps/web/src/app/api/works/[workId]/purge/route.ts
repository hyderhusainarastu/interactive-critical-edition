import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { purgeWorkNow } from "@/lib/trash";
import { getOwnedWork } from "@/lib/works";

/**
 * "Delete permanently now" (plan §34.4 9.7) — an explicit user choice on
 * the trash page to skip the rest of the 30-day wait, never something the
 * system does on its own. Only ever acts on an already-trashed work, so
 * this can't be used as a shortcut around the trash step itself.
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
  if (!work.deletedAt) return NextResponse.json({ error: "Not in trash" }, { status: 400 });

  await purgeWorkNow(workId);
  return NextResponse.json({ ok: true });
}
