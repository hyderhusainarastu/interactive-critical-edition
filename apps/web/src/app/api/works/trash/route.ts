import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/auth";
import { listTrashedWorks, purgeExpiredTrash } from "@/lib/trash";

/** Lists the caller's trashed works. Opportunistically purges anything past its 30-day window first (plan §34.4 9.7 — see lib/trash.ts for why this isn't a scheduled job). */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await purgeExpiredTrash(userId);
  const items = await listTrashedWorks(userId);
  return NextResponse.json({ items });
}
